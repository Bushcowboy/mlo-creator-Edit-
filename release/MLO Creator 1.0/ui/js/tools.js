// Pointer / keyboard handling and the build tools (walls, rooms, floors, openings, stairs, roofs, lights, paint, eraser).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model, Mesher, TEX } = M, S = Model.state, bus = Model.bus;
    const C = { ghost: [0.31, 0.55, 1.0, 0.38], ghostEdge: [0.55, 0.75, 1.0, 0.9], erase: [0.92, 0.32, 0.32, 0.45], ok: [0.25, 0.78, 0.45, 0.42], bad: [0.92, 0.35, 0.3, 0.42], hi: [1, 1, 1, 0.22], amber: [1.0, 0.75, 0.25, 0.9] };

    let R = null, canvas = null, cam = null, labelEl = null;
    let hover = null, drag = null, camDrag = null, lastEvt = null;
    const keys = new Set();

    const cfg = () => S.project.settings;
    // projects built on a rectangle interior (existing house, imported model) use the shell tools instead of the grid tools
    const shellH = () => { const k = S.project.kind; return k === 'import' ? M.ImportTools : (k === 'vanilla' ? M.ShellTools : null); };
    const levelZ = (k) => k * cfg().storyHeight;
    const wallTop = () => { const c = cfg(), m = S.view.wallMode; return S.level * c.storyHeight + (m === 'up' ? c.storyHeight - c.slab : (m === 'half' ? 1.2 : 0.25)); };

    // ---------- picking ----------
    function pointerRay(e) {
        const r = canvas.getBoundingClientRect();
        return cam.ray(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    }
    function planeHit(ray, z) {
        if (Math.abs(ray.d[2]) < 1e-6) return null; const t = (z - ray.o[2]) / ray.d[2]; if (t < 0) return null;
        return { x: ray.o[0] + ray.d[0] * t, y: ray.o[1] + ray.d[1] * t, t };
    }
    function rayBox(ray, mn, mx) {
        let t0 = 0, t1 = 1e9;
        for (let a = 0; a < 3; a++) {
            const d = ray.d[a], o = ray.o[a];
            if (Math.abs(d) < 1e-9) { if (o < mn[a] || o > mx[a]) return null; continue; }
            let ta = (mn[a] - o) / d, tb = (mx[a] - o) / d; if (ta > tb) { const t = ta; ta = tb; tb = t; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
        }
        return t0;
    }
    function pickWall(ray) {
        const T = cfg().wallThickness + 0.12, L = Model.cur(), k = S.level, z0 = levelZ(k) - 0.05, z1 = wallTop();
        let best = null;
        for (const key in L.walls) {
            const o = key[0], ij = M.parseKey(key.slice(2)), i = ij[0], j = ij[1];
            const mn = o === 'H' ? [i, j - T / 2, z0] : [i - T / 2, j, z0], mx = o === 'H' ? [i + 1, j + T / 2, z1] : [i + T / 2, j + 1, z1];
            const t = rayBox(ray, mn, mx);
            if (t != null && (!best || t < best.t)) {
                const px = ray.o[0] + ray.d[0] * t, py = ray.o[1] + ray.d[1] * t;
                best = { key, o, i, j, t, side: o === 'H' ? (py < j ? 'a' : 'b') : (px < i ? 'a' : 'b'), u: o === 'H' ? px : py };
            }
        }
        return best;
    }
    function computeHover(e) {
        const ray = pointerRay(e), ph = planeHit(ray, levelZ(S.level));
        hover = { ray, ph, wall: pickWall(ray) };
        if (ph) { hover.vx = Math.round(ph.x); hover.vy = Math.round(ph.y); hover.cx = Math.floor(ph.x); hover.cy = Math.floor(ph.y); }
        return hover;
    }

    // ---------- helpers ----------
    function toast(text, kind) { bus.emit('toast', { text, kind }); }
    function edgesAlong(v0, v1) {
        const out = [];
        if (v0[1] === v1[1]) { for (let i = Math.min(v0[0], v1[0]); i < Math.max(v0[0], v1[0]); i++) out.push('H:' + i + ',' + v0[1]); }
        else if (v0[0] === v1[0]) { for (let j = Math.min(v0[1], v1[1]); j < Math.max(v0[1], v1[1]); j++) out.push('V:' + v0[0] + ',' + j); }
        return out;
    }
    function snapAxis(v0, v) {
        return Math.abs(v[0] - v0[0]) >= Math.abs(v[1] - v0[1]) ? [v[0], v0[1]] : [v0[0], v[1]];
    }
    function cellRect(c0, c1) {
        const x0 = Math.min(c0[0], c1[0]), x1 = Math.max(c0[0], c1[0]), y0 = Math.min(c0[1], c1[1]), y1 = Math.max(c0[1], c1[1]), cells = [];
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) cells.push([i, j]);
        return { x0, y0, x1, y1, cells };
    }
    // cells connected to (i,j) without crossing a wall (arches are open)
    function roomCells(L, i, j) {
        const seen = new Set([i + ',' + j]), q = [[i, j]], blocked = (key) => { const w = L.walls[key]; return w && w.open !== 'arch'; };
        while (q.length && seen.size < 4000) {
            const [ci, cj] = q.pop();
            [[ci + 1, cj, 'V:' + (ci + 1) + ',' + cj], [ci - 1, cj, 'V:' + ci + ',' + cj], [ci, cj + 1, 'H:' + ci + ',' + (cj + 1)], [ci, cj - 1, 'H:' + ci + ',' + cj]].forEach(n => {
                const k2 = n[0] + ',' + n[1];
                if (seen.has(k2) || blocked(n[2]) || L.floor[k2] === undefined) return; seen.add(k2); q.push([n[0], n[1]]);
            });
        }
        return [...seen].map(M.parseKey);
    }
    function stairFits(P, k, s) {
        const si = Mesher.stairInfo(P.settings, s), L = P.levels[k], set = new Set(si.cells.map(c => c[0] + ',' + c[1]));
        for (const o of L.stairs) { const oi = Mesher.stairInfo(P.settings, o); if (oi.cells.some(c => set.has(c[0] + ',' + c[1]))) return 'Overlaps another staircase'; }
        for (const c of si.cells) {
            const [i, j] = c;
            if (set.has((i + 1) + ',' + j) && L.walls['V:' + (i + 1) + ',' + j]) return 'A wall is in the way';
            if (set.has(i + ',' + (j + 1)) && L.walls['H:' + i + ',' + (j + 1)]) return 'A wall is in the way';
        }
        return null;
    }
    function makeStair(i, j) {
        const st = S.stair; return { id: Math.random().toString(36).slice(2, 7), i, j, dir: st.dir, wid: st.wid, steps: st.steps, run: st.run, style: st.style, rail: st.rail };
    }

    // ---------- pointer events ----------
    function down(e) {
        lastEvt = e;
        if (e.button === 1 || e.button === 2) {
            // like Blender: right-click cancels a drag in progress; the middle button orbits (Shift pans, Ctrl zooms); the right button still orbits (Shift pans)
            const sh0 = shellH(); if (e.button === 2 && sh0 && sh0.cancelTransform && sh0.cancelTransform()) return;
            camDrag = { x: e.clientX, y: e.clientY, mode: e.shiftKey ? 'pan' : ((e.ctrlKey && e.button === 1) ? 'zoom' : 'orbit') }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { } return;
        }
        if (e.button !== 0) return;
        const sh = shellH(); if (sh) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { } sh.down(e); return; }
        computeHover(e); try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
        const h = hover, t = S.tool;
        if (t === 'wall' || t === 'room') { if (h.vx != null) drag = { tool: t, v0: [h.vx, h.vy], v1: [h.vx, h.vy] }; }
        else if (t === 'floor' || t === 'roof') { if (h.cx != null) drag = { tool: t, c0: [h.cx, h.cy], c1: [h.cx, h.cy] }; }
        else if (t === 'eraser') {
            if (h.wall) drag = { tool: t, mode: 'wall', walls: new Set([h.wall.key]) };
            else if (h.cx != null) drag = { tool: t, mode: 'rect', c0: [h.cx, h.cy], c1: [h.cx, h.cy] };
        }
        else if (t === 'door' || t === 'window' || t === 'arch') {
            if (!h.wall) return; const type = t;
            Model.edit(P => { const w = P.levels[S.level].walls[h.wall.key]; if (w.open === type) Model.ops.setOpening(P, S.level, h.wall.key, null); else Model.ops.setOpening(P, S.level, h.wall.key, type); });
        }
        else if (t === 'entrance') {
            if (!h.wall) return;
            if (S.level !== 0) { toast('Set the entrance on level 0 (ground floor).', 'warn'); return; }
            Model.edit(P => { const w = P.levels[0].walls[h.wall.key]; if (w.open !== 'door' && w.open !== 'arch') w.open = 'door'; P.entrance = { level: 0, key: h.wall.key }; });
            toast('Entrance set. Export tab: paste the game coordinates of this door.', 'ok');
        }
        else if (t === 'stairs') {
            if (h.cx == null) return;
            const s = makeStair(h.cx, h.cy), why = stairFits(S.project, S.level, s);
            if (why) { toast(why, 'warn'); return; }
            Model.edit(P => {
                while (P.levels.length < S.level + 2) P.levels.push(Model.newLevel());
                const L = P.levels[S.level]; Mesher.stairInfo(P.settings, s).cells.forEach(c => { const k2 = c[0] + ',' + c[1]; if (L.floor[k2] === undefined) L.floor[k2] = P.defaults.floor; });
                L.stairs.push(s);
            });
        }
        else if (t === 'light') {
            if (h.cx == null) return;
            Model.edit(P => {
                const L = P.levels[S.level], idx = L.lights.findIndex(l => Math.floor(l.x) === h.cx && Math.floor(l.y) === h.cy);
                if (idx >= 0) L.lights.splice(idx, 1); else L.lights.push({ x: h.cx + 0.5, y: h.cy + 0.5 });
            });
        }
        else if (t === 'paint') paintAt(h);
    }

    function paintAt(h) {
        const tgt = S.paintTarget, L = Model.cur();
        if (tgt === 'wall') {
            if (!h.wall) return; const tex = S.brush.wall, w = h.wall;
            Model.edit(P => {
                const LL = P.levels[S.level];
                if (!S.paintRoom) { LL.walls[w.key][w.side] = tex; return; }
                // all wall faces looking into the same room
                const cellKey = w.o === 'H' ? (w.side === 'a' ? [w.i, w.j - 1] : [w.i, w.j]) : (w.side === 'a' ? [w.i - 1, w.j] : [w.i, w.j]);
                const comp = roomCells(LL, cellKey[0], cellKey[1]);
                if (!comp.length || LL.floor[cellKey[0] + ',' + cellKey[1]] === undefined) { LL.walls[w.key][w.side] = tex; return; }
                const inComp = new Set(comp.map(c => c[0] + ',' + c[1]));
                comp.forEach(([i, j]) => {
                    const faces = [['V:' + i + ',' + j, 'b'], ['V:' + (i + 1) + ',' + j, 'a'], ['H:' + i + ',' + j, 'b'], ['H:' + i + ',' + (j + 1), 'a']];
                    faces.forEach(f => { if (LL.walls[f[0]]) LL.walls[f[0]][f[1]] = tex; });
                });
            });
        } else if (h.cx != null) {
            const key = h.cx + ',' + h.cy;
            if (tgt === 'floor') {
                if (L.floor[key] === undefined) return;
                Model.edit(P => { const LL = P.levels[S.level]; const cells = S.paintRoom ? roomCells(LL, h.cx, h.cy) : [[h.cx, h.cy]]; cells.forEach(c => { LL.floor[c[0] + ',' + c[1]] = S.brush.floor; }); });
            } else if (tgt === 'ceil') {
                if (L.floor[key] === undefined) return;
                Model.edit(P => { const LL = P.levels[S.level]; const cells = S.paintRoom ? roomCells(LL, h.cx, h.cy) : [[h.cx, h.cy]]; cells.forEach(c => { LL.ceil[c[0] + ',' + c[1]] = S.brush.ceil; }); });
            } else if (tgt === 'roof') {
                if (L.roof[key] === undefined) return;
                Model.edit(P => { P.levels[S.level].roof[key] = S.brush.roof; });
            }
        }
    }

    function move(e) {
        lastEvt = e;
        if (camDrag) {
            const dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y; camDrag.x = e.clientX; camDrag.y = e.clientY;
            if (camDrag.mode === 'pan') cam.pan(dx, dy); else if (camDrag.mode === 'zoom') cam.zoom(Math.exp(dy * 0.01)); else cam.orbit(dx, dy); return;
        }
        const sh = shellH(); if (sh) { sh.move(e); return; }
        computeHover(e); const h = hover;
        if (!drag) return;
        if (drag.tool === 'wall' && h.vx != null) drag.v1 = snapAxis(drag.v0, [h.vx, h.vy]);
        else if (drag.tool === 'room' && h.vx != null) drag.v1 = [h.vx, h.vy];
        else if ((drag.tool === 'floor' || drag.tool === 'roof') && h.cx != null) drag.c1 = [h.cx, h.cy];
        else if (drag.tool === 'eraser') { if (drag.mode === 'wall') { if (h.wall) drag.walls.add(h.wall.key); } else if (h.cx != null) drag.c1 = [h.cx, h.cy]; }
    }

    function up(e) {
        if (camDrag) { camDrag = null; return; }
        const sh = shellH(); if (sh) { sh.up(e); return; }
        if (!drag) return; const d = drag; drag = null;
        if (d.tool === 'wall') {
            const edges = edgesAlong(d.v0, d.v1); if (!edges.length) return;
            Model.edit(P => { edges.forEach(k2 => Model.ops.addWall(P.levels[S.level], k2)); });
        } else if (d.tool === 'room') {
            const x0 = Math.min(d.v0[0], d.v1[0]), x1 = Math.max(d.v0[0], d.v1[0]), y0 = Math.min(d.v0[1], d.v1[1]), y1 = Math.max(d.v0[1], d.v1[1]);
            if (x1 - x0 < 1 || y1 - y0 < 1) return;
            Model.edit(P => {
                const L = P.levels[S.level];
                for (let i = x0; i < x1; i++) for (let j = y0; j < y1; j++) L.floor[i + ',' + j] = S.brush.floor;
                for (let i = x0; i < x1; i++) { Model.ops.addWall(L, 'H:' + i + ',' + y0); Model.ops.addWall(L, 'H:' + i + ',' + y1); }
                for (let j = y0; j < y1; j++) { Model.ops.addWall(L, 'V:' + x0 + ',' + j); Model.ops.addWall(L, 'V:' + x1 + ',' + j); }
            });
        } else if (d.tool === 'floor') {
            const r = cellRect(d.c0, d.c1); Model.edit(P => Model.ops.fillFloor(P.levels[S.level], r.cells, S.brush.floor));
        } else if (d.tool === 'roof') {
            const r = cellRect(d.c0, d.c1); Model.edit(P => { const L = P.levels[S.level]; r.cells.forEach(c => { L.roof[c[0] + ',' + c[1]] = S.brush.roof; }); });
        } else if (d.tool === 'eraser') {
            if (d.mode === 'wall') Model.edit(P => { d.walls.forEach(k2 => Model.ops.removeWall(P, S.level, k2)); });
            else {
                const r = cellRect(d.c0, d.c1);
                Model.edit(P => {
                    r.cells.forEach(c => Model.ops.eraseCell(P, S.level, c[0], c[1]));
                    if (r.cells.length > 1) {
                        const L = P.levels[S.level];
                        Object.keys(L.walls).forEach(k2 => {
                            const o = k2[0], ij = M.parseKey(k2.slice(2)), i = ij[0], j = ij[1];
                            const inside = o === 'H' ? (i >= r.x0 && i + 1 <= r.x1 + 1 && j >= r.y0 && j <= r.y1 + 1) : (j >= r.y0 && j + 1 <= r.y1 + 1 && i >= r.x0 && i <= r.x1 + 1);
                            if (inside) Model.ops.removeWall(P, S.level, k2);
                        });
                    }
                });
            }
        }
    }

    function wheel(e) { e.preventDefault(); cam.zoom(Math.exp(e.deltaY * 0.0011)); }

    // ---------- keyboard ----------
    // the numeric keypad turns the view like in Blender: 1 front, 3 right, 7 top (Ctrl: the opposite side), 4 6 8 2 step the orbit, + - zoom, . or Home frame everything
    function numpadView(e) {
        const c = e.code || ''; if (e.key === 'Home') { M.App.frameAll(); return true; }
        if (c.indexOf('Numpad') !== 0) return false;
        const P = Math.PI, step = P / 12;
        switch (c) {
            case 'Numpad1': cam.yaw = e.ctrlKey ? P / 2 : -P / 2; cam.pitch = 0.08; break;
            case 'Numpad3': cam.yaw = e.ctrlKey ? P : 0; cam.pitch = 0.08; break;
            case 'Numpad7': cam.yaw = -P / 2; cam.pitch = 1.553; break;
            case 'Numpad4': cam.yaw += step; break;
            case 'Numpad6': cam.yaw -= step; break;
            case 'Numpad8': cam.pitch = M.clamp(cam.pitch + step, 0.08, 1.553); break;
            case 'Numpad2': cam.pitch = M.clamp(cam.pitch - step, 0.08, 1.553); break;
            case 'NumpadAdd': cam.zoom(0.8); break;
            case 'NumpadSubtract': cam.zoom(1.25); break;
            case 'NumpadDecimal': M.App.frameAll(); break;
            default: return false;
        }
        return true;
    }
    const TOOLKEYS = { '1': 'wall', '2': 'room', '3': 'floor', '4': 'door', '5': 'window', '6': 'arch', '7': 'stairs', '8': 'roof', '9': 'light', '0': 'entrance', x: 'eraser', p: 'paint' };
    function key(e, isDown) {
        const tag = (e.target && e.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (isDown) {
            if (numpadView(e)) { e.preventDefault(); return; }
            if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? Model.redo() : Model.undo(); return; }
            if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); Model.redo(); return; }
            if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); Model.save().then(() => toast('Saved', 'ok')); return; }
            { const kh = shellH(); if (kh && kh.keyEv && kh.keyEv(e, k)) { e.preventDefault(); return; } }       // a tool may use keys with Ctrl, Alt or Shift (Blender's)
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const sh = shellH(); if (sh && 'qet'.indexOf(k) < 0 && k !== 'PageUp' && k !== 'PageDown' && sh.key(k)) return;
            if (k === 'Escape') { drag = null; return; }
            if (k === 'r' && S.tool === 'stairs') { S.stair.dir = (S.stair.dir + 3) % 4; bus.emit('tooloptions'); return; }
            if (k === 'q') { cam.yaw += Math.PI / 2; return; }
            if (k === 'e' && !e.shiftKey) { cam.yaw -= Math.PI / 2; return; }
            if (k === 't') { M.App.toggleTopDown(); return; }
            if (k === 'PageUp' || k === ']') { M.App.setLevel(S.level + 1); return; }
            if (k === 'PageDown' || k === '[') { M.App.setLevel(S.level - 1); return; }
            if (TOOLKEYS[k]) { M.App.setTool(TOOLKEYS[k]); return; }
            keys.add(k);
        } else keys.delete(k);
    }
    function tick(dt) {
        let dx = 0, dy = 0;
        if (keys.has('w') || keys.has('ArrowUp')) dy -= 1; if (keys.has('s') || keys.has('ArrowDown')) dy += 1;
        if (keys.has('a') || keys.has('ArrowLeft')) dx -= 1; if (keys.has('d') || keys.has('ArrowRight')) dx += 1;
        if (dx || dy) cam.pan(-dx * dt * 420, -dy * dt * 420);
    }

    // ---------- overlay drawing ----------
    function wallBox(o, i, j, z0, z1, pad) {
        const T = cfg().wallThickness / 2 + (pad || 0);
        return o === 'H' ? [[i, j - T, z0], [i + 1, j + T, z1]] : [[i - T, j, z0], [i + T, j + 1, z1]];
    }
    function label(text, p) {
        if (!labelEl) return; if (!text || !p) { labelEl.style.display = 'none'; return; }
        const r = canvas.getBoundingClientRect(), s = cam.project(p, r.width, r.height);
        if (!s) { labelEl.style.display = 'none'; return; }
        labelEl.style.display = 'block'; labelEl.textContent = text; labelEl.style.left = s[0] + 'px'; labelEl.style.top = s[1] + 'px';
    }

    function openingBox(wall, type) {
        const spec = Mesher.OPEN[type], c = cfg(), k = S.level, base = wall.o === 'H' ? wall.i : wall.j, wc = wall.o === 'H' ? wall.j : wall.i;
        const u0 = base + 0.5 - spec.w / 2, u1 = base + 0.5 + spec.w / 2, z0 = k * c.storyHeight + spec.sill, z1 = k * c.storyHeight + spec.head, T = c.wallThickness / 2 + 0.02;
        return wall.o === 'H' ? [[u0, wc - T, z0], [u1, wc + T, z1]] : [[wc - T, u0, z0], [wc + T, u1, z1]];
    }

    function draw() {
        const sh = shellH(); if (sh) { R.ovClear(); sh.draw(R, label); return; }
        R.ovClear(); const z = levelZ(S.level) + 0.01, c = cfg(), h = hover, t = S.tool, L = Model.cur(), top = wallTop();
        let lbl = null, lblAt = null;
        const quadCells = (cells, col) => cells.forEach(cc => R.ovQuad([cc[0], cc[1], z], [cc[0] + 1, cc[1], z], [cc[0] + 1, cc[1] + 1, z], [cc[0], cc[1] + 1, z], col));
        // entrance marker (always)
        const built = M.App.built;
        if (built && built.entrance && built.entrance.level === S.level) {
            const e = built.entrance, ex = e.center[0], ey = e.center[1], ix = e.inward[0], iy = e.inward[1], lx = -iy, ly = ix, zz = levelZ(S.level) + 0.02;
            const col = e.ok ? [0.25, 0.85, 0.5, 0.85] : [1, 0.7, 0.2, 0.85];
            R.ovQuad([ex - ix * 0.55 + lx * 0.28, ey - iy * 0.55 + ly * 0.28, zz], [ex - ix * 0.55 - lx * 0.28, ey - iy * 0.55 - ly * 0.28, zz], [ex + ix * 0.05, ey + iy * 0.05, zz], [ex + ix * 0.05, ey + iy * 0.05, zz], col);
            R.ovQuad([ex - ix * 0.55 + lx * 0.1, ey - iy * 0.55 + ly * 0.1, zz], [ex - ix * 0.55 - lx * 0.1, ey - iy * 0.55 - ly * 0.1, zz], [ex - ix * 1.0 - lx * 0.1, ey - iy * 1.0 - ly * 0.1, zz], [ex - ix * 1.0 + lx * 0.1, ey - iy * 1.0 + ly * 0.1, zz], col);
        }
        // manual lights
        if (t === 'light') L.lights.forEach(l => R.ovBox([l.x - 0.12, l.y - 0.12, levelZ(S.level) + c.storyHeight - c.slab - 0.3], [l.x + 0.12, l.y + 0.12, levelZ(S.level) + c.storyHeight - c.slab - 0.1], C.amber));

        if (h && h.vx != null && (t === 'wall' || t === 'room') && !drag) R.ovBox([h.vx - 0.08, h.vy - 0.08, z], [h.vx + 0.08, h.vy + 0.08, z + 0.5], C.ghostEdge);
        if (drag && drag.tool === 'wall') {
            edgesAlong(drag.v0, drag.v1).forEach(k2 => { const b = wallBox(k2[0], ...M.parseKey(k2.slice(2)), levelZ(S.level), top); R.ovBox(b[0], b[1], C.ghost, C.ghostEdge); });
            const n = Math.abs(drag.v1[0] - drag.v0[0]) + Math.abs(drag.v1[1] - drag.v0[1]); if (n) { lbl = n + ' m'; lblAt = [(drag.v0[0] + drag.v1[0]) / 2, (drag.v0[1] + drag.v1[1]) / 2, top + 0.3]; }
        } else if (drag && drag.tool === 'room') {
            const x0 = Math.min(drag.v0[0], drag.v1[0]), x1 = Math.max(drag.v0[0], drag.v1[0]), y0 = Math.min(drag.v0[1], drag.v1[1]), y1 = Math.max(drag.v0[1], drag.v1[1]);
            if (x1 > x0 && y1 > y0) {
                R.ovQuad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], C.ghost);
                for (let i = x0; i < x1; i++) { [y0, y1].forEach(yy => { const b = wallBox('H', i, yy, levelZ(S.level), top); R.ovBox(b[0], b[1], [0.31, 0.55, 1, 0.22], C.ghostEdge); }); }
                for (let j = y0; j < y1; j++) { [x0, x1].forEach(xx => { const b = wallBox('V', xx, j, levelZ(S.level), top); R.ovBox(b[0], b[1], [0.31, 0.55, 1, 0.22], C.ghostEdge); }); }
                lbl = (x1 - x0) + ' x ' + (y1 - y0) + ' m'; lblAt = [(x0 + x1) / 2, (y0 + y1) / 2, z + 0.1];
            }
        } else if (drag && (drag.tool === 'floor' || drag.tool === 'roof')) {
            const r = cellRect(drag.c0, drag.c1); quadCells(r.cells, drag.tool === 'roof' ? [0.95, 0.6, 0.3, 0.4] : C.ghost);
            lbl = (r.x1 - r.x0 + 1) + ' x ' + (r.y1 - r.y0 + 1) + ' m'; lblAt = [(r.x0 + r.x1 + 1) / 2, (r.y0 + r.y1 + 1) / 2, z + 0.1];
        } else if (drag && drag.tool === 'eraser') {
            if (drag.mode === 'wall') drag.walls.forEach(k2 => { const b = wallBox(k2[0], ...M.parseKey(k2.slice(2)), levelZ(S.level), top, 0.02); R.ovBox(b[0], b[1], C.erase); });
            else quadCells(cellRect(drag.c0, drag.c1).cells, C.erase);
        } else if (h && !camDrag) {
            if (t === 'floor' || t === 'roof') { if (h.cx != null) quadCells([[h.cx, h.cy]], C.ghost); }
            else if (t === 'eraser') {
                if (h.wall) { const b = wallBox(h.wall.o, h.wall.i, h.wall.j, levelZ(S.level), top, 0.02); R.ovBox(b[0], b[1], C.erase); }
                else if (h.cx != null) quadCells([[h.cx, h.cy]], C.erase);
            } else if (t === 'door' || t === 'window' || t === 'arch' || t === 'entrance') {
                if (h.wall) { const b = openingBox(h.wall, t === 'entrance' ? 'door' : t); R.ovBox(b[0], b[1], t === 'entrance' ? [0.25, 0.85, 0.5, 0.55] : [1, 0.85, 0.35, 0.5], [1, 1, 1, 0.9]); }
            } else if (t === 'paint') {
                if (S.paintTarget === 'wall' && h.wall) {
                    const w = h.wall, T2 = c.wallThickness / 2 + 0.015, a = w.side === 'a' ? -T2 : T2, zz0 = levelZ(S.level), zz1 = top;
                    if (w.o === 'H') R.ovQuad([w.i, w.j + a, zz0], [w.i + 1, w.j + a, zz0], [w.i + 1, w.j + a, zz1], [w.i, w.j + a, zz1], C.ghost);
                    else R.ovQuad([w.i + a, w.j, zz0], [w.i + a, w.j + 1, zz0], [w.i + a, w.j + 1, zz1], [w.i + a, w.j, zz1], C.ghost);
                } else if (S.paintTarget !== 'wall' && h.cx != null) quadCells([[h.cx, h.cy]], C.ghost);
            } else if (t === 'light') { if (h.cx != null) R.ovBox([h.cx + 0.4, h.cy + 0.4, z], [h.cx + 0.6, h.cy + 0.6, z + 0.2], C.amber); }
            else if (t === 'stairs' && h.cx != null) {
                const s = makeStair(h.cx, h.cy), si = Mesher.stairInfo(c, s), why = stairFits(S.project, S.level, s), col = why ? C.bad : C.ok;
                quadCells(si.cells, col);
                const zb = levelZ(S.level), P = si.P;
                const pt = (tt, mm, zz) => { const p = P(tt, mm); return [p[0], p[1], zz]; };
                R.ovQuad(pt(0, si.m0, zb + 0.02), pt(si.len, si.m0, zb + c.storyHeight), pt(si.len, si.m1, zb + c.storyHeight), pt(0, si.m1, zb + 0.02), [col[0], col[1], col[2], 0.28]);
                const mid = (si.m0 + si.m1) / 2, a0 = pt(0.1, mid, zb + 0.06), a1 = pt(si.len - 0.1, mid, zb + 0.06);
                R.ovLine(a0, a1, [1, 1, 1, 0.9]); const ex = a1[0] - a0[0], ey = a1[1] - a0[1], el = Math.hypot(ex, ey) || 1;
                R.ovLine(a1, [a1[0] - (ex / el) * 0.4 + (-ey / el) * 0.25, a1[1] - (ey / el) * 0.4 + (ex / el) * 0.25, a1[2]], [1, 1, 1, 0.9]);
                R.ovLine(a1, [a1[0] - (ex / el) * 0.4 - (-ey / el) * 0.25, a1[1] - (ey / el) * 0.4 - (ex / el) * 0.25, a1[2]], [1, 1, 1, 0.9]);
                lbl = why || (si.n + ' steps, ' + (si.rise * 100).toFixed(0) + ' cm rise, ' + (si.tread * 100).toFixed(0) + ' cm run'); lblAt = [(si.rect[0] + si.rect[2]) / 2, (si.rect[1] + si.rect[3]) / 2, zb + c.storyHeight + 0.2];
            }
        }
        label(lbl, lblAt);
        // hint line
        if (h && h.cx != null) bus.emit('hint', { cx: h.cx, cy: h.cy });
    }

    function init(app) {
        R = app.renderer; canvas = app.canvas; cam = R.camera; labelEl = app.labelEl;
        if (M.ShellTools) M.ShellTools.setLabel(label);
        if (M.ImportTools) M.ImportTools.setLabel(label);
        canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('pointerleave', () => { if (!drag && !camDrag) hover = null; });
        canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('keydown', e => key(e, true)); window.addEventListener('keyup', e => key(e, false)); window.addEventListener('blur', () => keys.clear());
    }

    M.Tools = { api: { pointerRay, planeHit, rayBox }, init, draw, tick, roomCells, stairFits, makeStair, cancel() { drag = null; }, get hover() { return hover; }, get drag() { return drag; } };
})(window.MLO);



