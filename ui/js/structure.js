// Ceilings and structure: the ceiling of a room (flat, gable / cathedral, barrel, tray, shed) with its beams, and columns and beams you place yourself.
// Stored on the shell: ops[i].ceil, shell.columns [{ id, x, y, w, shape, tex, trim, h }], shell.beams [{ id, a: [x, y], b: [x, y], w, d, tex, z }]. Built by shell.js.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model, TEX } = M, S = Model.state, el = M.el, bus = Model.bus;
    const ST = M.Structure = {};
    const r3 = (v) => Math.round(v * 1000) / 1000, snap = (v) => r3(Math.round(v / 0.05) * 0.05);
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const id = () => Math.random().toString(36).slice(2, 9);
    const D = () => (S.structDefault = S.structDefault || { col: { w: 0.3, shape: 'square', tex: '', trim: true }, beam: { w: 0.2, d: 0.25, tex: 'wood_dark', z: 0 } });

    // ---- a texture picker that works on any tab: a list by category ----
    ST.texSelect = function (value, fallback, onchange) {
        const s = el('select', { class: 'grow', onchange: (e) => onchange(e.target.value) });
        s.append(el('option', { value: '' }, fallback));
        TEX.cats.forEach(c => { const g = el('optgroup', { label: c }); TEX.list.filter(t => t.cat === c).forEach(t => g.append(el('option', { value: t.id, selected: t.id === value ? true : null }, t.name))); s.append(g); });
        return s;
    };
    const num = (label, value, step, min, max, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: String(step), min: String(min), max: String(max), value: String(value), onchange: (e) => set(Math.min(max, Math.max(min, parseFloat(e.target.value) || 0))) }), unit ? el('span', { class: 'note' }, unit) : null);

    // ---- the ceiling of the selected room ----
    const SHAPES = [['flat', 'Flat'], ['gable', 'Vaulted'], ['barrel', 'Barrel'], ['tray', 'Tray'], ['shed', 'Shed']];
    ST.roomCeiling = function (root, oi) {
        const P = S.project, o = P.shell.ops[oi]; if (!o || o.op !== 'add') return;
        const C = o.ceil || { shape: 'flat' }, set = (fn) => { Model.edit(Q => { const q = Q.shell.ops[oi]; q.ceil = Object.assign({ shape: 'flat', rise: 1.2, axis: 'auto', margin: 0.45 }, q.ceil || {}); fn(q.ceil); }); M.UI.renderLeft(); };
        const kit = M.UI.kit, w = o.r[2] - o.r[0], d = o.r[3] - o.r[1];
        root.append(el('div', { class: 'h' }, 'Ceiling'));
        root.append(el('div', { class: 'row' }, kit.seg(SHAPES, C.shape || 'flat', v => set(c => { c.shape = v; if (v === 'tray' && (!c.rise || c.rise > 0.8)) c.rise = 0.3; if ((v === 'gable' || v === 'barrel' || v === 'shed') && (!c.rise || c.rise < 0.4)) c.rise = 1.2; }))));
        const shape = C.shape || 'flat';
        if (shape !== 'flat') {
            root.append(num(shape === 'tray' ? 'Raised by' : 'Rise', C.rise != null ? C.rise : 1.2, 0.05, 0.05, 8, v => set(c => { c.rise = v; }), 'm'));
            if (shape === 'tray') root.append(num('Border', C.margin != null ? C.margin : 0.45, 0.05, 0.1, Math.max(0.15, Math.min(w, d) / 2 - 0.15), v => set(c => { c.margin = v; }), 'm'));
            else root.append(el('div', { class: 'row' }, el('label', null, shape === 'shed' ? 'Slopes up' : 'Ridge'), kit.seg([['auto', 'Long side'], ['x', 'Along x'], ['y', 'Along y']], C.axis || 'auto', v => set(c => { c.axis = v; }))));
            const top = (P.settings.ceilH || 2.45) + (+C.rise || 0);
            root.append(el('div', { class: 'note' }, (shape === 'gable' ? 'Two slopes up to a ridge' : shape === 'barrel' ? 'A round vault' : shape === 'shed' ? 'One slope, with a wall on the high side' : 'A raised middle with a step all round') + ', ' + top.toFixed(2) + ' m at the top. The building\'s roof has to be higher than that, or the ceiling shows through it from outside.'));
        }
        root.append(el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(C.tex || '', 'the project\'s ceiling', v => set(c => { c.tex = v; }))));
        const B = C.beams || {};
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: B.on ? true : null, onchange: (e) => set(c => { c.beams = Object.assign({ on: false, dir: 'across', n: 4, w: 0.15, d: 0.18, tex: 'wood_dark' }, c.beams || {}); c.beams.on = e.target.checked; }) }), shape === 'flat' || shape === 'tray' ? 'Beams under the ceiling' : 'Beams (ribs, rafters, purlins)'));
        if (B.on) {
            const bs = (fn) => set(c => { c.beams = Object.assign({ on: true, dir: 'across', n: 4, w: 0.15, d: 0.18, tex: 'wood_dark' }, c.beams || {}); fn(c.beams); });
            root.append(el('div', { class: 'row' }, el('label', null, 'Run'), kit.seg([['across', 'Across'], ['along', 'Along'], ['grid', 'Both']], B.dir || 'across', v => bs(b => { b.dir = v; }))),
                num('How many', B.n || 4, 1, 1, 60, v => bs(b => { b.n = Math.round(v); })), num('Width', B.w || 0.15, 0.01, 0.04, 0.6, v => bs(b => { b.w = v; }), 'm'), num('Depth', B.d || 0.18, 0.01, 0.03, 0.8, v => bs(b => { b.d = v; }), 'm'),
                el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(B.tex || '', 'dark wood', v => bs(b => { b.tex = v; }))));
            root.append(el('div', { class: 'note' }, shape === 'flat' || shape === 'tray' ? 'Across: the short way, spaced along the room. Both: a coffered grid.' : 'Across: ribs or rafters that follow the ceiling. Along: purlins (and a ridge beam on a vault).'));
        }
    };

    // ---- the Column and Beam tools ----
    let hover = null, beamStart = null;
    ST.reset = function () { hover = null; beamStart = null; };
    ST.scan = function (e, g) { hover = g ? { x: snap(g.rx), y: snap(g.ry), rx: g.rx, ry: g.ry, shift: e.shiftKey } : null; if (hover && beamStart && !e.shiftKey) { const p = snapAngle(beamStart, hover); hover.x = p[0]; hover.y = p[1]; } };
    // beams snap to 0 / 45 / 90 degrees unless Shift is held
    function snapAngle(a, p) {
        const dx = p.x - a[0], dy = p.y - a[1], len = Math.hypot(dx, dy); if (len < 1e-6) return [p.x, p.y];
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.round(len / 0.05) * 0.05; return [r3(a[0] + Math.cos(ang) * l), r3(a[1] + Math.sin(ang) * l)];
    }
    const columns = () => S.project.shell.columns || [], beams = () => S.project.shell.beams || [];
    const colAt = (x, y) => columns().findIndex(c => Math.abs(c.x - x) < Math.max(0.2, (c.w || 0.3) / 2 + 0.05) && Math.abs(c.y - y) < Math.max(0.2, (c.w || 0.3) / 2 + 0.05));
    const segDist = (b, x, y) => { const ax = b.a[0], ay = b.a[1], dx = b.b[0] - ax, dy = b.b[1] - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); return Math.hypot(ax + dx * t - x, ay + dy * t - y); };
    const beamAt = (x, y) => beams().findIndex(b => segDist(b, x, y) < Math.max(0.2, (b.w || 0.2) / 2 + 0.05));
    ST.down = function (e, t) {
        if (!hover) return;
        if (t === 'column') {
            const i = colAt(hover.rx, hover.ry);
            if (i >= 0) { Model.edit(P => { P.shell.columns.splice(i, 1); }); toast('Column removed.', 'ok'); }
            else { const d = D().col; Model.edit(P => { (P.shell.columns = P.shell.columns || []).push({ id: id(), x: hover.x, y: hover.y, w: d.w, shape: d.shape, tex: d.tex, trim: d.trim }); }); }
            M.UI.renderLeft(); return;
        }
        if (t === 'beam') {
            if (!beamStart) { const i = beamAt(hover.rx, hover.ry); if (i >= 0 && e.altKey) { Model.edit(P => { P.shell.beams.splice(i, 1); }); toast('Beam removed.', 'ok'); M.UI.renderLeft(); return; } beamStart = [hover.x, hover.y]; return; }
            const a = beamStart, b = [hover.x, hover.y]; beamStart = null; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) return;
            const d = D().beam; Model.edit(P => { (P.shell.beams = P.shell.beams || []).push({ id: id(), a, b, w: d.w, d: d.d, tex: d.tex, z: d.z || 0 }); }); M.UI.renderLeft();
        }
    };
    ST.key = function (k, t) { if (k === 'Escape' && beamStart) { beamStart = null; return true; } return false; };
    // the eraser takes columns and beams too
    ST.erase = function (x, y) {
        const ci = colAt(x, y); if (ci >= 0) { Model.edit(P => { P.shell.columns.splice(ci, 1); }); return true; }
        const bi = beamAt(x, y); if (bi >= 0) { Model.edit(P => { P.shell.beams.splice(bi, 1); }); return true; }
        return false;
    };
    ST.draw = function (R, t) {
        const H = S.project.settings.ceilH || 2.45, Y = [1, 0.9, 0.4, 0.9]; if (!hover) return beamStart ? { text: 'Click where the beam ends (Esc cancels)', at: [beamStart[0], beamStart[1], H] } : null;
        if (t === 'column') {
            const i = colAt(hover.rx, hover.ry);
            if (i >= 0) { const c = columns()[i], h = (c.w || 0.3) / 2; R.ovBox([c.x - h - 0.04, c.y - h - 0.04, 0], [c.x + h + 0.04, c.y + h + 0.04, H], [1, 0.4, 0.4, 0.15], [1, 0.4, 0.4, 1]); return { text: 'Click: remove this column', at: [c.x, c.y, H] }; }
            const w = D().col.w / 2; R.ovBox([hover.x - w, hover.y - w, 0], [hover.x + w, hover.y + w, H], [1, 0.9, 0.4, 0.18], Y); return { text: 'Click: a column here (' + hover.x.toFixed(2) + ', ' + hover.y.toFixed(2) + ')', at: [hover.x, hover.y, H] };
        }
        if (t === 'beam') {
            const d = D().beam, z = d.z || H;
            if (!beamStart) { const i = beamAt(hover.rx, hover.ry); if (i >= 0) { const b = beams()[i]; R.ovTopLine([b.a[0], b.a[1], (b.z || H) - (b.d || 0.25) / 2], [b.b[0], b.b[1], (b.z || H) - (b.d || 0.25) / 2], [1, 0.4, 0.4, 1]); return { text: 'Alt+click: remove this beam · click: start a new one', at: [hover.x, hover.y, H] }; }
                R.ovBox([hover.x - 0.05, hover.y - 0.05, z - d.d], [hover.x + 0.05, hover.y + 0.05, z], [1, 0.9, 0.4, 0.3], Y); return { text: 'Click where the beam starts', at: [hover.x, hover.y, z] }; }
            R.ovTopLine([beamStart[0], beamStart[1], z - d.d / 2], [hover.x, hover.y, z - d.d / 2], Y);
            const len = Math.hypot(hover.x - beamStart[0], hover.y - beamStart[1]); return { text: len.toFixed(2) + ' m · click where it ends (Shift: any angle, Esc cancels)', at: [hover.x, hover.y, z] };
        }
        return null;
    };

    // ---- the tool panels: what a new column or beam looks like, and the ones placed ----
    ST.toolPanel = function (root, t) {
        const kit = M.UI.kit, d = D(), P = S.project, sh = P.shell;
        if (t === 'column') {
            const c = d.col;
            root.append(el('div', { class: 'h' }, 'New columns'), el('div', { class: 'row' }, el('label', null, 'Shape'), kit.seg([['square', 'Square'], ['round', 'Round']], c.shape, v => { c.shape = v; M.UI.renderLeft(); })),
                num('Width', c.w, 0.05, 0.08, 2, v => { c.w = v; }, 'm'), el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(c.tex, 'the trim colour', v => { c.tex = v; })),
                el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: c.trim ? true : null, onchange: (e) => { c.trim = e.target.checked; } }), 'Base and capital'));
            const L = sh.columns || [];
            root.append(el('div', { class: 'h' }, 'Columns (' + L.length + ')'));
            if (!L.length) root.append(el('div', { class: 'note' }, 'Click the floor to stand a column there. They reach the ceiling, also under a vault. Click a column again to remove it.'));
            L.forEach((cl, i) => {
                const ed = (fn) => { Model.edit(Q => { fn(Q.shell.columns[i]); }); M.UI.renderLeft(); };
                root.append(el('div', { class: 'route', style: { padding: '6px 8px', marginTop: '5px' } },
                    el('div', { class: 'row', style: { margin: 0 } }, el('b', { class: 'grow' }, 'Column ' + (i + 1)), el('span', { class: 'note', style: { margin: 0 } }, cl.x.toFixed(2) + ', ' + cl.y.toFixed(2)), el('button', { class: 'btn sm danger', style: { marginLeft: '6px' }, onclick: () => { Model.edit(Q => { Q.shell.columns.splice(i, 1); }); M.UI.renderLeft(); } }, '✕')),
                    el('div', { class: 'row' }, kit.seg([['square', 'Square'], ['round', 'Round']], cl.shape || 'square', v => ed(q => { q.shape = v; }))),
                    num('Width', cl.w || 0.3, 0.05, 0.08, 2, v => ed(q => { q.w = v; }), 'm'), num('x', cl.x, 0.05, -500, 500, v => ed(q => { q.x = r3(v); }), 'm'), num('y', cl.y, 0.05, -500, 500, v => ed(q => { q.y = r3(v); }), 'm'),
                    num('Height', cl.h || 0, 0.05, 0, 20, v => ed(q => { q.h = v || 0; }), '0 = to the ceiling'),
                    el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(cl.tex || '', 'the trim colour', v => ed(q => { q.tex = v; })))));
            });
        }
        if (t === 'beam') {
            const b = d.beam;
            root.append(el('div', { class: 'h' }, 'New beams'), num('Width', b.w, 0.01, 0.04, 1, v => { b.w = v; }, 'm'), num('Depth', b.d, 0.01, 0.04, 2, v => { b.d = v; }, 'm'),
                num('Top at', b.z || 0, 0.05, 0, 20, v => { b.z = v; }, '0 = the ceiling'), el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(b.tex, 'dark wood', v => { b.tex = v; })));
            const L = sh.beams || [];
            root.append(el('div', { class: 'h' }, 'Beams (' + L.length + ')'));
            if (!L.length) root.append(el('div', { class: 'note' }, 'Click where a beam starts, then where it ends: straight, or at 45 degrees (Shift: any angle). Its top is at the ceiling unless you give a height; a beam low enough to walk into gets collision. Alt+click a beam removes it.'));
            L.forEach((bm, i) => {
                const ed = (fn) => { Model.edit(Q => { fn(Q.shell.beams[i]); }); M.UI.renderLeft(); }, len = Math.hypot(bm.b[0] - bm.a[0], bm.b[1] - bm.a[1]);
                root.append(el('div', { class: 'route', style: { padding: '6px 8px', marginTop: '5px' } },
                    el('div', { class: 'row', style: { margin: 0 } }, el('b', { class: 'grow' }, 'Beam ' + (i + 1)), el('span', { class: 'note', style: { margin: 0 } }, len.toFixed(2) + ' m'), el('button', { class: 'btn sm danger', style: { marginLeft: '6px' }, onclick: () => { Model.edit(Q => { Q.shell.beams.splice(i, 1); }); M.UI.renderLeft(); } }, '✕')),
                    num('Width', bm.w || 0.2, 0.01, 0.04, 1, v => ed(q => { q.w = v; }), 'm'), num('Depth', bm.d || 0.25, 0.01, 0.04, 2, v => ed(q => { q.d = v; }), 'm'), num('Top at', bm.z || 0, 0.05, 0, 20, v => ed(q => { q.z = v || 0; }), '0 = the ceiling'),
                    el('div', { class: 'row' }, el('label', null, 'Texture'), ST.texSelect(bm.tex || '', 'dark wood', v => ed(q => { q.tex = v; })))));
            });
        }
    };
})(window.MLO);
