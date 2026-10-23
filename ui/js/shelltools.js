// Tools for the interior shell of a vanilla house: add / cut rooms, partitions, doors, windows, select, floor paint, eraser.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model, Shell } = M, S = Model.state, bus = Model.bus;
    const C = { ghost: [0.31, 0.55, 1.0, 0.36], cut: [0.92, 0.40, 0.30, 0.38], edge: [0.55, 0.75, 1.0, 0.95], hi: [1, 0.85, 0.35, 0.5], sel: [0.35, 0.9, 0.55, 0.55], cand: [0.4, 0.9, 0.5, 0.20], erase: [0.92, 0.32, 0.32, 0.45], paint: [0.95, 0.75, 0.3, 0.38] };
    const SNAP = 0.05, LINE_SNAP = 0.09;
    const randId = () => Math.random().toString(36).slice(2, 7);

    let hover = null, drag = null;
    const api = () => M.Tools.api;
    const cfg = () => S.project.settings;
    const shell = () => S.project.shell;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });

    function snapTo(v, list) {
        let best = Math.round(v / SNAP) * SNAP, bd = LINE_SNAP;
        (list || []).forEach(l => { const d = Math.abs(l - v); if (d < bd) { bd = d; best = l; } });
        return Math.round(best * 10000) / 10000;
    }
    function lines() {
        const b = M.App.built, xs = [], ys = [];
        if (b && b.shell) { b.shell.grid.X.forEach(v => xs.push(v)); b.shell.grid.Y.forEach(v => ys.push(v)); }
        shell().parts.forEach(pt => { if (pt.o === 'H') { ys.push(pt.c); xs.push(pt.u0, pt.u1); } else { xs.push(pt.c); ys.push(pt.u0, pt.u1); } });
        xs.push(0); ys.push(0);
        if (S.project.kind === 'import' && M.ImportModel) { const ml = M.ImportModel.snapLines(); ml.xs.forEach(v => xs.push(v)); ml.ys.forEach(v => ys.push(v)); }
        return { xs, ys };
    }
    function ground(e) {
        const ray = api().pointerRay(e), ph = api().planeHit(ray, 0); if (!ph) return null;
        const L = lines(); return { x: snapTo(ph.x, L.xs), y: snapTo(ph.y, L.ys), rx: ph.x, ry: ph.y, ray };
    }

    // wall under the pointer: boundary segment of the room or a partition
    function pick(ray) {
        const b = M.App.built; if (!b || !b.shell) return null; const H = cfg().ceilH, depth = cfg().wallDepth, PT = cfg().partT; let best = null;
        const test = (mn, mx, info) => { const t = api().rayBox(ray, mn, mx); if (t != null && (!best || t < best.t)) { info.t = t; info.px = ray.o[0] + ray.d[0] * t; info.py = ray.o[1] + ray.d[1] * t; best = info; } };
        b.shell.segs.forEach(sg => {
            const a = Math.min(sg.c, sg.c - sg.inward * depth) - 0.05, z = Math.max(sg.c, sg.c - sg.inward * depth) + 0.05;
            if (sg.o === 'H') test([sg.u0, a, 0], [sg.u1, z, H], { kind: 'seg', sg }); else test([a, sg.u0, 0], [z, sg.u1, H], { kind: 'seg', sg });
        });
        shell().parts.forEach(pt => {
            const a = pt.c - PT / 2 - 0.04, z = pt.c + PT / 2 + 0.04;
            if (pt.o === 'H') test([pt.u0, a, 0], [pt.u1, z, H], { kind: 'part', pt }); else test([a, pt.u0, 0], [z, pt.u1, H], { kind: 'part', pt });
        });
        if (best) { const o = best.kind === 'seg' ? best.sg.o : best.pt.o; best.u = o === 'H' ? best.px : best.py; best.n = o === 'H' ? best.py : best.px; }
        return best;
    }
    function openingAt(p) {
        if (!p) return null;
        if (p.kind === 'seg') return shell().openings.find(op => op.o === p.sg.o && Math.abs(op.c - p.sg.c) < 0.3 && p.u > op.u0 && p.u < op.u1 && p.u > p.sg.u0 - 0.01 && p.u < p.sg.u1 + 0.01) || null;
        return (p.pt.open || []).find(op => p.u > op.u0 && p.u < op.u1) || null;
    }

    // ---------------- actions ----------------
    function normRect(a, b) { return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]; }

    function addOpening(p, type) {
        const spec = Shell.OPEN[type], u = p.u;
        Model.edit(P => {
            const sh = P.shell;
            const ex = p.kind === 'seg' ? sh.openings.find(op => op.o === p.sg.o && Math.abs(op.c - p.sg.c) < 0.3 && u > op.u0 && u < op.u1) : (p.pt.open || []).find(op => u > op.u0 && u < op.u1);
            if (ex) {
                // click on an existing opening of the same kind removes it, another kind turns it into that kind
                if (ex.type === type) { if (p.kind === 'seg') sh.openings = sh.openings.filter(o => o !== ex && o.id !== ex.id); else { const pt = sh.parts.find(q => q.id === p.pt.id); pt.open = pt.open.filter(o => o.id !== ex.id); } }
                else { const t = p.kind === 'seg' ? sh.openings.find(o => o.id === ex.id) : sh.parts.find(q => q.id === p.pt.id).open.find(o => o.id === ex.id); t.type = type; t.z0 = spec.z0; t.z1 = spec.z1; }
                return;
            }
            let u0 = u - spec.w / 2, u1 = u + spec.w / 2, z0 = spec.z0, z1 = spec.z1;
            const lo = p.kind === 'seg' ? p.sg.u0 : p.pt.u0, hi = p.kind === 'seg' ? p.sg.u1 : p.pt.u1;
            if (type === 'window' && p.kind === 'seg') {
                const cn = sh.cands.find(c => !c.door && c.o === p.sg.o && Math.abs(c.c - p.sg.c) < 0.45 && u > c.u0 - 0.15 && u < c.u1 + 0.15);
                if (cn) { u0 = cn.u0 + 0.06; u1 = cn.u1 - 0.06; z0 = Math.max(0.2, cn.z0); z1 = cn.z1 - 0.1; }
            }
            u0 = Math.max(u0, lo + 0.08); u1 = Math.min(u1, hi - 0.08); if (u1 - u0 < 0.3) { toast('The wall is too short here.', 'warn'); return; }
            const op = { id: randId(), type, u0: Math.round(u0 * 100) / 100, u1: Math.round(u1 * 100) / 100, z0: Math.round(z0 * 100) / 100, z1: Math.round(z1 * 100) / 100 };
            if (p.kind === 'seg') { op.o = p.sg.o; op.c = p.sg.c; sh.openings.push(op); } else { const pt = sh.parts.find(q => q.id === p.pt.id); pt.open = pt.open || []; pt.open.push(op); }
            S.shellSel = { kind: 'open', id: op.id };
        });
        bus.emit('shellsel');
    }

    function down(e) {
        const t = S.shellTool, g = ground(e); hover = { g, pick: g ? pick(g.ray) : null };
        if (!g) return;
        if (t === 'room' || t === 'cut' || t === 'floor') drag = { tool: t, a: g, b: g };
        else if (t === 'part') drag = { tool: t, a: g, b: g };
        else if (t === 'door' || t === 'window' || t === 'arch') { const p = hover.pick; if (p) addOpening(p, t); }
        else if (t === 'select') {
            const p = hover.pick; const op = openingAt(p);
            if (op) S.shellSel = { kind: 'open', id: op.id }; else if (p && p.kind === 'part') S.shellSel = { kind: 'part', id: p.pt.id }; else S.shellSel = null;
            bus.emit('shellsel'); bus.emit('tooloptions');
        }
        else if (t === 'eraser') {
            const p = hover.pick; if (!p) return; const op = openingAt(p);
            Model.edit(P => {
                const sh = P.shell;
                if (op) { if (p.kind === 'seg') sh.openings = sh.openings.filter(o => o.id !== op.id); else { const pt = sh.parts.find(q => q.id === p.pt.id); pt.open = pt.open.filter(o => o.id !== op.id); } }
                else if (p.kind === 'part') sh.parts = sh.parts.filter(q => q.id !== p.pt.id);
            });
        }
        else if (t === 'paint') {
            const p = hover.pick; if (!p) return; const tex = S.brush.wall;
            Model.edit(P => {
                const sh = P.shell;
                if (p.kind === 'part') { const pt = sh.parts.find(q => q.id === p.pt.id); const side = p.n < pt.c ? 'texA' : 'texB'; pt[side] = tex; }
                else { sh.paint = sh.paint || []; sh.paint = sh.paint.filter(q => !(q.o === p.sg.o && Math.abs(q.c - p.sg.c) < 0.3 && q.inward === p.sg.inward && q.um > p.sg.u0 && q.um < p.sg.u1)); sh.paint.push({ o: p.sg.o, c: p.sg.c, inward: p.sg.inward, um: (p.sg.u0 + p.sg.u1) / 2, tex }); }
            });
        }
    }

    function move(e) {
        const g = ground(e); hover = { g, pick: g ? pick(g.ray) : null };
        if (!drag || !g) return;
        if (drag.tool === 'part') {
            // keep the line straight: along the dominant direction
            const dx = Math.abs(g.x - drag.a.x), dy = Math.abs(g.y - drag.a.y);
            drag.b = dx >= dy ? { x: g.x, y: drag.a.y } : { x: drag.a.x, y: g.y };
        } else drag.b = g;
    }

    function up(e) {
        if (!drag) return; const d = drag; drag = null;
        if (d.tool === 'room' || d.tool === 'cut') {
            const r = normRect(d.a, d.b); if (r[2] - r[0] < 0.2 || r[3] - r[1] < 0.2) return;
            Model.edit(P => { P.shell.ops.push({ op: d.tool === 'room' ? 'add' : 'cut', r }); });
        } else if (d.tool === 'floor') {
            const r = normRect(d.a, d.b); if (r[2] - r[0] < 0.2 || r[3] - r[1] < 0.2) return;
            Model.edit(P => { P.shell.floors.push({ r, tex: S.brush.floor }); });
        } else if (d.tool === 'part') {
            const horiz = Math.abs(d.b.x - d.a.x) >= Math.abs(d.b.y - d.a.y);
            const u0 = horiz ? Math.min(d.a.x, d.b.x) : Math.min(d.a.y, d.b.y), u1 = horiz ? Math.max(d.a.x, d.b.x) : Math.max(d.a.y, d.b.y);
            if (u1 - u0 < 0.3) return;
            Model.edit(P => { P.shell.parts.push({ id: randId(), o: horiz ? 'H' : 'V', c: horiz ? d.a.y : d.a.x, u0, u1, open: [] }); });
        }
    }

    // ---------------- overlays ----------------
    function draw(R, label) {
        const H = cfg().ceilH, depth = cfg().wallDepth, PT = cfg().partT, z = 0.012, b = M.App.built, sh = shell(), t = S.shellTool;
        const quad = (r, col) => R.ovQuad([r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z], col);
        // entrance arrow
        const legacy = S.project.kind === 'vanilla', ez = 0.02;
        if (legacy) { R.ovQuad([-0.28, -0.7, ez], [0.28, -0.7, ez], [0, -0.05, ez], [0, -0.05, ez], [0.25, 0.85, 0.5, 0.85]); R.ovQuad([-0.1, -1.2, ez], [0.1, -1.2, ez], [0.1, -0.7, ez], [-0.1, -0.7, ez], [0.25, 0.85, 0.5, 0.85]); }
        // detected windows while placing one
        if (legacy && (t === 'window' || t === 'select')) sh.cands.forEach(c => {
            const a = c.u0, bb = c.u1, o0 = c.c - 0.04, o1 = c.c + 0.04;
            if (c.o === 'H') R.ovBox([a, o0, c.z0], [bb, o1, c.z1], c.door ? [1, 0.7, 0.2, 0.14] : C.cand); else R.ovBox([o0, a, c.z0], [o1, bb, c.z1], c.door ? [1, 0.7, 0.2, 0.14] : C.cand);
        });
        // selection
        if (S.shellSel) {
            if (S.shellSel.kind === 'open') {
                let op = sh.openings.find(o => o.id === S.shellSel.id), host = null;
                if (!op) sh.parts.forEach(pt => { const f = (pt.open || []).find(o => o.id === S.shellSel.id); if (f) { op = f; host = pt; } });
                if (op) { const c = host ? host.c : op.c, h = host ? PT / 2 + 0.03 : 0.1; if ((host ? host.o : op.o) === 'H') R.ovBox([op.u0, c - h, op.z0], [op.u1, c + h, op.z1], C.sel, [1, 1, 1, 0.9]); else R.ovBox([c - h, op.u0, op.z0], [c + h, op.u1, op.z1], C.sel, [1, 1, 1, 0.9]); }
            } else if (S.shellSel.kind === 'part') {
                const pt = sh.parts.find(q => q.id === S.shellSel.id); if (pt) { const h = PT / 2 + 0.03; if (pt.o === 'H') R.ovBox([pt.u0, pt.c - h, 0], [pt.u1, pt.c + h, H], C.sel, [1, 1, 1, 0.9]); else R.ovBox([pt.c - h, pt.u0, 0], [pt.c + h, pt.u1, H], C.sel, [1, 1, 1, 0.9]); }
            }
        }
        if (S.hoverOp != null && sh.ops[S.hoverOp]) quad(sh.ops[S.hoverOp].r, [1, 1, 0.4, 0.3]);
        let lbl = null, at = null;
        if (drag && (drag.tool === 'room' || drag.tool === 'cut' || drag.tool === 'floor')) {
            const r = normRect(drag.a, drag.b); quad(r, drag.tool === 'cut' ? C.cut : (drag.tool === 'floor' ? C.paint : C.ghost));
            lbl = (r[2] - r[0]).toFixed(2) + ' x ' + (r[3] - r[1]).toFixed(2) + ' m'; at = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 0.15];
        } else if (drag && drag.tool === 'part') {
            const horiz = Math.abs(drag.b.x - drag.a.x) >= Math.abs(drag.b.y - drag.a.y), len = horiz ? Math.abs(drag.b.x - drag.a.x) : Math.abs(drag.b.y - drag.a.y);
            const x0 = Math.min(drag.a.x, drag.b.x), x1 = Math.max(drag.a.x, drag.b.x), y0 = Math.min(drag.a.y, drag.b.y), y1 = Math.max(drag.a.y, drag.b.y), h = PT / 2;
            if (horiz) R.ovBox([x0, drag.a.y - h, 0], [x1, drag.a.y + h, H], C.ghost, C.edge); else R.ovBox([drag.a.x - h, y0, 0], [drag.a.x + h, y1, H], C.ghost, C.edge);
            lbl = len.toFixed(2) + ' m'; at = [(x0 + x1) / 2, (y0 + y1) / 2, H + 0.1];
        } else if (hover && hover.g) {
            const p = hover.pick, g = hover.g;
            if (t === 'room' || t === 'cut' || t === 'part' || t === 'floor') R.ovBox([g.x - 0.05, g.y - 0.05, 0], [g.x + 0.05, g.y + 0.05, 0.5], C.edge);
            if (p && (t === 'door' || t === 'window' || t === 'arch' || t === 'select' || t === 'eraser' || t === 'paint')) {
                const op = openingAt(p), spec = Shell.OPEN[t] || Shell.OPEN.window, col = t === 'eraser' ? C.erase : C.hi;
                if (op && (t === 'select' || t === 'eraser' || t === 'door' || t === 'window' || t === 'arch')) {
                    const c = p.kind === 'seg' ? op.c : p.pt.c, h = p.kind === 'seg' ? 0.1 : PT / 2 + 0.03;
                    if ((p.kind === 'seg' ? op.o : p.pt.o) === 'H') R.ovBox([op.u0, c - h, op.z0], [op.u1, c + h, op.z1], col, [1, 1, 1, 0.9]); else R.ovBox([c - h, op.u0, op.z0], [c + h, op.u1, op.z1], col, [1, 1, 1, 0.9]);
                } else if (t === 'door' || t === 'window' || t === 'arch') {
                    const o = p.kind === 'seg' ? p.sg.o : p.pt.o, c = p.kind === 'seg' ? p.sg.c : p.pt.c, h = p.kind === 'seg' ? 0.1 : PT / 2 + 0.03;
                    if (o === 'H') R.ovBox([p.u - spec.w / 2, c - h, spec.z0], [p.u + spec.w / 2, c + h, spec.z1], C.hi, [1, 1, 1, 0.9]); else R.ovBox([c - h, p.u - spec.w / 2, spec.z0], [c + h, p.u + spec.w / 2, spec.z1], C.hi, [1, 1, 1, 0.9]);
                } else if (t === 'eraser' && p.kind === 'part') {
                    const pt = p.pt, h = PT / 2 + 0.03; if (pt.o === 'H') R.ovBox([pt.u0, pt.c - h, 0], [pt.u1, pt.c + h, H], C.erase); else R.ovBox([pt.c - h, pt.u0, 0], [pt.c + h, pt.u1, H], C.erase);
                } else if (t === 'paint') {
                    if (p.kind === 'seg') { const sg = p.sg, off = -sg.inward * 0 + sg.inward * 0.015; if (sg.o === 'H') R.ovQuad([sg.u0, sg.c + off, 0], [sg.u1, sg.c + off, 0], [sg.u1, sg.c + off, H], [sg.u0, sg.c + off, H], C.ghost); else R.ovQuad([sg.c + off, sg.u0, 0], [sg.c + off, sg.u1, 0], [sg.c + off, sg.u1, H], [sg.c + off, sg.u0, H], C.ghost); }
                    else { const pt = p.pt, side = p.n < pt.c ? -1 : 1, off = side * (PT / 2 + 0.015); if (pt.o === 'H') R.ovQuad([pt.u0, pt.c + off, 0], [pt.u1, pt.c + off, 0], [pt.u1, pt.c + off, H], [pt.u0, pt.c + off, H], C.ghost); else R.ovQuad([pt.c + off, pt.u0, 0], [pt.c + off, pt.u1, 0], [pt.c + off, pt.u1, H], [pt.c + off, pt.u0, H], C.ghost); }
                }
            }
            lbl = (t === 'room' || t === 'cut' || t === 'part' || t === 'floor') ? g.x.toFixed(2) + ', ' + g.y.toFixed(2) : null; at = lbl ? [g.x, g.y, 0.7] : null;
        }
        label(lbl, at);
    }

    function key(k) {
        const map = { '1': 'room', '2': 'cut', '3': 'part', '4': 'door', '5': 'window', '6': 'arch', '7': 'floor', v: 'select', x: 'eraser', p: 'paint' };
        if (map[k]) { M.App.setTool(map[k]); return true; }
        if (k === 'Escape') { drag = null; return true; }
        if ((k === 'Delete' || k === 'Backspace') && S.shellSel) { deleteSelected(); return true; }
        return false;
    }
    function deleteSelected() {
        const sel = S.shellSel; if (!sel) return;
        Model.edit(P => {
            if (sel.kind === 'open') { P.shell.openings = P.shell.openings.filter(o => o.id !== sel.id); P.shell.parts.forEach(pt => { pt.open = (pt.open || []).filter(o => o.id !== sel.id); }); }
            else if (sel.kind === 'part') P.shell.parts = P.shell.parts.filter(q => q.id !== sel.id);
        });
        S.shellSel = null; bus.emit('shellsel');
    }

    let labelFn = null;
    function label(text, at) { if (labelFn) labelFn(text, at); }

    M.ShellTools = { down, move, up, draw, key, deleteSelected, pick, ground, openingAt, snapTo, lines, cancel() { drag = null; }, setLabel(f) { labelFn = f; }, get hover() { return hover; }, get dragging() { return drag ? drag.tool : null; } };
})(window.MLO);
