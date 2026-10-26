// Server and world, in 3D: the game's buildings around a spot, your resources' MLOs and map entities there, and the collision of both, to see what clashes.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const W = M.World, el = M.el, $ = (id) => document.getElementById(id);
    const A = W.A = { on: false, data: null, show: { game: true, server: true, colGame: true, colServer: true }, hidden: {}, r: 80, loading: false, status: '' };
    let R = null, raf = 0;

    function f32(b64) { const s = atob(b64 || ''), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); }
    const hexRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
    // loose triangles (9 floats each) as renderer batches with flat colour and normals (at most 20000 triangles per batch: the index buffer is 16 bit)
    function batches(pos, flat, kind, alpha) {
        const out = [], nt = pos.length / 9, CH = 20000;
        for (let t0 = 0; t0 < nt; t0 += CH) {
            const n = Math.min(CH, nt - t0), p = pos.subarray(t0 * 9, (t0 + n) * 9), nrm = new Float32Array(n * 9), idx = new Uint16Array(n * 3);
            for (let t = 0; t < n; t++) {
                const o = t * 9, ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
                let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
                for (let k = 0; k < 3; k++) { nrm[o + k * 3] = nx; nrm[o + k * 3 + 1] = ny; nrm[o + k * 3 + 2] = nz; idx[t * 3 + k] = t * 3 + k; }
            }
            out.push({ kind, group: kind, tex: '', flat, alpha: alpha == null ? 1 : alpha, noCull: true, pos: new Float32Array(p), nrm, uv: new Float32Array(n * 6), idx });
        }
        return out;
    }
    // collision as lines: triangle edges and box edges
    function colLines(tris, boxes) {
        const l = [];
        for (let i = 0; i + 8 < tris.length; i += 9) for (let k = 0; k < 3; k++) { const a = i + k * 3, b = i + ((k + 1) % 3) * 3; l.push(tris[a], tris[a + 1], tris[a + 2], tris[b], tris[b + 1], tris[b + 2]); }
        for (let i = 0; i + 5 < boxes.length; i += 6) {
            const x0 = boxes[i], y0 = boxes[i + 1], z0 = boxes[i + 2], x1 = boxes[i + 3], y1 = boxes[i + 4], z1 = boxes[i + 5], cs = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
            [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => l.push(...cs[e[0]], ...cs[e[1]]));
        }
        return new Float32Array(l);
    }
    function colourOf(res) { const rs = W.S.data ? W.S.data.resources : []; const i = rs.findIndex(r => r.name === res); const C = ['#4f8cff', '#2fae62', '#e0a43a', '#c46bd6', '#4fc1c9', '#e06a5a', '#9fb24a', '#d68a4f', '#7a8cff', '#5ec7a0', '#d9b84f', '#b0709e']; return C[(i < 0 ? 0 : i) % C.length]; }

    function build() {
        const d = A.data; if (!d || !R) return; const all = [];
        (d.game || []).forEach(g => { const c = g.color || [0.6, 0.6, 0.6], grey = [0.45 + c[0] * 0.25, 0.45 + c[1] * 0.25, 0.47 + c[2] * 0.25]; all.push(...batches(f32(g.pos), grey, 'game')); });
        (d.server || []).forEach(s => all.push(...batches(f32(s.pos), hexRgb(colourOf(s.resource)), 'srv:' + s.resource)));
        R.setBatches(all);
        // the grid at the lowest floor in view (the spot's height is the middle of the MLOs, which would cut through the rooms)
        let zmin = 1e9; all.forEach(b => { for (let i = 2; i < b.pos.length; i += 3) if (b.pos[i] < zmin) zmin = b.pos[i]; }); if (zmin < 1e8) R.setGrid(zmin - 0.02, Math.min(150, A.r), 0, 0);
        Object.keys(R.statics || {}).forEach(k => R.setStaticLines(k, null, [0, 0, 0, 0], false));
        (d.collision || []).forEach(c => {
            const game = c.source === 'the game', col = game ? [1.0, 0.55, 0.25, 0.65] : hexRgb(colourOf(c.source)).map(v => Math.min(1, v * 0.6 + 0.45)).concat([0.9]);
            let tris = f32(c.tris), boxes = f32(c.boxes);
            if (A.fix && A.fix.res === c.source && A.fix.del.size) { const k = kept(c); tris = k.tris; boxes = k.boxes; }
            R.setStaticLines('col:' + c.source, colLines(tris, boxes), col, true);
        });
        applyVisibility();
    }
    function applyVisibility() {
        if (!R || !A.data) return;
        (A.data.collision || []).forEach(c => R.staticOn('col:' + c.source, (c.source === 'the game' ? A.show.colGame : A.show.colServer) && !A.hidden[c.source]));
    }
    // ---- fixing a resource's collision: pick pieces, take them out, add boxes; the fixed copies are written to the output folder ----
    function i32(b64) { const s = atob(b64 || ''), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int32Array(u.buffer); }
    const refKey = (r, i) => r[i] + '|' + r[i + 1] + '|' + r[i + 2];
    function pieces(c) { if (!c._p) c._p = { tris: f32(c.tris), boxes: f32(c.boxes), trefs: i32(c.trefs), brefs: i32(c.brefs) }; return c._p; }
    // the pieces still there (those not taken out): a whole child taken out takes its polygons with it
    function kept(c) {
        const p = pieces(c), del = A.fix.del, gone = (r, i) => del.has(refKey(r, i)) || del.has(r[i] + '|' + r[i + 1] + '|-1'), t = [], b = [];
        for (let i = 0; i * 9 < p.tris.length; i++) if (!gone(p.trefs, i * 3)) for (let k = 0; k < 9; k++) t.push(p.tris[i * 9 + k]);
        for (let i = 0; i * 6 < p.boxes.length; i++) if (!gone(p.brefs, i * 3)) for (let k = 0; k < 6; k++) b.push(p.boxes[i * 6 + k]);
        return { tris: new Float32Array(t), boxes: new Float32Array(b) };
    }
    // the nearest piece of the resource's collision under the mouse (ray through triangles and boxes)
    function pick(ray, c) {
        const p = pieces(c), o = ray.o, d = ray.d, del = A.fix.del; let best = null;
        const gone = (r, i) => del.has(refKey(r, i)) || del.has(r[i] + '|' + r[i + 1] + '|-1');
        for (let i = 0; i * 9 < p.tris.length; i++) {
            if (gone(p.trefs, i * 3)) continue; const q = i * 9, ax = p.tris[q], ay = p.tris[q + 1], az = p.tris[q + 2];
            const e1 = [p.tris[q + 3] - ax, p.tris[q + 4] - ay, p.tris[q + 5] - az], e2 = [p.tris[q + 6] - ax, p.tris[q + 7] - ay, p.tris[q + 8] - az];
            const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(a) < 1e-9) continue;
            const f = 1 / a, sv = [o[0] - ax, o[1] - ay, o[2] - az], u = f * (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]); if (u < 0 || u > 1) continue;
            const qv = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]], v = f * (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]); if (v < 0 || u + v > 1) continue;
            const t = f * (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]); if (t > 0.01 && (!best || t < best.t)) best = { t, kind: 'tri', i, ref: [p.trefs[i * 3], p.trefs[i * 3 + 1], p.trefs[i * 3 + 2]] };
        }
        for (let i = 0; i * 6 < p.boxes.length; i++) {
            if (gone(p.brefs, i * 3)) continue; const q = i * 6; let t0 = -1e9, t1 = 1e9, okb = true;
            for (let k = 0; k < 3; k++) { const mn = p.boxes[q + k], mx = p.boxes[q + 3 + k]; if (Math.abs(d[k]) < 1e-12) { if (o[k] < mn || o[k] > mx) { okb = false; break; } continue; } let a = (mn - o[k]) / d[k], b = (mx - o[k]) / d[k]; if (a > b) { const tt = a; a = b; b = tt; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
            if (okb && t0 <= t1 && t1 > 0.01) { const t = t0 > 0.01 ? t0 : t1; if (!best || t < best.t) best = { t, kind: 'box', i, ref: [p.brefs[i * 3], p.brefs[i * 3 + 1], p.brefs[i * 3 + 2]] }; }
        }
        if (best) best.point = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
        return best;
    }
    function overlay() {
        if (!R) return; R.ovClear(); const F = A.fix; if (!F || !A.data) return;
        const c = (A.data.collision || []).find(x => x.source === F.res); if (!c) return; const p = pieces(c);
        if (F.sel) {
            const col = [1, 1, 0.35, 1];
            if (F.sel.kind === 'tri') { const q = F.sel.i * 9, v = (k) => [p.tris[q + k * 3], p.tris[q + k * 3 + 1], p.tris[q + k * 3 + 2]]; R.ovTopLine(v(0), v(1), col); R.ovTopLine(v(1), v(2), col); R.ovTopLine(v(2), v(0), col); }
            else { const q = F.sel.i * 6; R.ovBox([p.boxes[q], p.boxes[q + 1], p.boxes[q + 2]], [p.boxes[q + 3], p.boxes[q + 4], p.boxes[q + 5]], [1, 1, 0.35, 0.18], col); }
            // the rest of its part, dimmer (what "the whole part" takes out)
            for (let i = 0; i * 9 < p.tris.length && i < 60000; i++) if (p.trefs[i * 3] === F.sel.ref[0] && p.trefs[i * 3 + 1] === F.sel.ref[1] && i !== F.sel.i) { const q = i * 9; R.ovLine([p.tris[q], p.tris[q + 1], p.tris[q + 2]], [p.tris[q + 3], p.tris[q + 4], p.tris[q + 5]], [1, 1, 0.4, 0.35]); }
        }
        F.adds.forEach(b => R.ovBox(b.min.map((v, k) => v - A.data.centre[k]), b.max.map((v, k) => v - A.data.centre[k]), [0.37, 0.88, 0.56, 0.22], [0.37, 0.88, 0.56, 1]));
    }
    W.fixCollision = function (res) {
        A.fix = { res, sel: null, del: new Set(), adds: [], size: [1, 1, 2.5], written: [] }; A.show.colServer = true; A.hidden[res] = false; build(); render3dPanel();
    };
    function takeOut(whole) {
        const F = A.fix; if (!F || !F.sel) return; const r = F.sel.ref; F.del.add(whole ? r[0] + '|' + r[1] + '|-1' : r.join('|')); F.history = (F.history || []).concat([{ del: whole ? r[0] + '|' + r[1] + '|-1' : r.join('|') }]); F.sel = null; build(); render3dPanel();
    }
    function addBox() {
        const F = A.fix; if (!F || !F.sel) return; const c = A.data.centre, pt = F.sel.point.map((v, k) => v + c[k]), s = F.size;
        const file = F.sel.ref[0], b = { file, min: [pt[0] - s[0] / 2, pt[1] - s[1] / 2, pt[2]], max: [pt[0] + s[0] / 2, pt[1] + s[1] / 2, pt[2] + s[2]] };
        F.adds.push(b); F.history = (F.history || []).concat([{ add: b }]); render3dPanel();
    }
    function undoFix() { const F = A.fix; if (!F || !F.history || !F.history.length) return; const h = F.history.pop(); if (h.del) F.del.delete(h.del); if (h.add) F.adds = F.adds.filter(x => x !== h.add); build(); render3dPanel(); }
    async function writeFix() {
        const F = A.fix, c = (A.data.collision || []).find(x => x.source === F.res); if (!c) return; const files = c.fileList || [];
        const byFile = {}; F.del.forEach(k => { const p = k.split('|').map(Number); (byFile[p[0]] = byFile[p[0]] || { deletes: [], add: [] }).deletes.push([p[1], p[2]]); });
        F.adds.forEach(b => { (byFile[b.file] = byFile[b.file] || { deletes: [], add: [] }).add.push({ min: b.min, max: b.max }); });
        const out = [];
        for (const fi of Object.keys(byFile)) {
            const f = files[+fi]; if (!f) continue;
            try { const r = await W.api('area/fix', 'POST', { resource: F.res, file: f.rel, deletes: byFile[fi].deletes, add: byFile[fi].add }); if (r.ok === false) throw new Error(r.error); out.push(r); }
            catch (e) { W.toast(f.name + ': ' + e.message, 'err'); }
        }
        if (out.length) { F.written = out; W.toast('Fixed ' + out.length + ' collision file(s): ' + out[0].dir, 'ok'); }
        render3dPanel();
    }
    W.fixKeys = function (e) {
        if (!A.fix) return false;
        if (e.key === 'Delete' || e.key === 'Backspace') { takeOut(e.shiftKey); return true; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undoFix(); return true; }
        if (e.key === 'b') { addBox(); return true; }
        return false;
    };

    const visible = (b) => b.kind === 'game' ? A.show.game : (b.kind.indexOf('srv:') === 0 ? A.show.server && !A.hidden[b.kind.slice(4)] : true);
    function frame() { raf = requestAnimationFrame(frame); if (A.on && R) { overlay(); R.render(visible); } }

    function bind(c) {
        let drag = null;
        c.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }; e.preventDefault(); });
        window.addEventListener('mousemove', e => {
            if (!drag || !A.on) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.dist = (drag.dist || 0) + Math.abs(dx) + Math.abs(dy); drag.moved = drag.dist > 3;          // (a click picks, a drag turns or pans)
            if (drag.b === 0 && !drag.shift) R.camera.orbit(dx, dy); else R.camera.pan(dx, dy);
        });
        window.addEventListener('mouseup', (e) => {
            const d0 = drag; drag = null; if (!d0 || !A.on || !A.fix || d0.b !== 0 || d0.moved) return;
            const r = c.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2;
            const col = (A.data && A.data.collision || []).find(x => x.source === A.fix.res); if (!col) return;
            A.fix.sel = pick(R.camera.ray(nx, ny), col); render3dPanel();
        });
        c.addEventListener('contextmenu', e => e.preventDefault());
        c.addEventListener('wheel', e => { e.preventDefault(); R.camera.zoom(Math.pow(1.0012, e.deltaY)); }, { passive: false });
        window.addEventListener('keydown', e => {
            const ae = document.activeElement, typing = ae && ((ae.tagName === 'INPUT' && /^(text|number|search|)$/.test(ae.type)) || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
            if (!A.on || typing) return; if (W.fixKeys(e)) { e.preventDefault(); return; } const cam = R.camera, s = cam.dist * 0.04, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
            if (e.key === 'w') { cam.target[0] -= cy * s; cam.target[1] -= sy * s; } if (e.key === 's') { cam.target[0] += cy * s; cam.target[1] += sy * s; }
            if (e.key === 'a') { cam.target[0] += sy * s; cam.target[1] -= cy * s; } if (e.key === 'd') { cam.target[0] -= sy * s; cam.target[1] += cy * s; }
            if (e.key === 'q') cam.target[2] -= s; if (e.key === 'e') cam.target[2] += s; if (e.key === 'Escape') W.close3d();
        });
    }

    W.init3d = function () { };
    // open the 3D view on a spot: load the area (a background job on the host), then draw it
    W.open3d = async function (x, y, z, r) {
        A.r = Math.round(Math.max(20, Math.min(300, r || A.r))); A.spot = { x, y, z }; W.S.area = { x, y, r: A.r };
        $('map').style.display = 'none'; $('view3d').style.display = 'block'; $('tip').style.display = 'none'; $('maphud').style.display = 'none'; A.on = true;
        if (!R) {
            try { R = new M.Renderer($('view3d')); } catch (e) { W.toast('WebGL is not available: ' + e.message, 'err'); W.close3d(); return; }
            R.camera.zoom = function (f) { this.dist = Math.max(2, Math.min(1500, this.dist * f)); };
            bind($('view3d')); frame();
        }
        R.camera.target = [0, 0, 0]; R.camera.dist = A.r * 1.6; R.camera.pitch = 0.75; R.setGrid(-0.02, Math.min(150, A.r), 0, 0); R.showGrid = true;
        A.data = null; R.setBatches([]); render3dPanel(); await load();
    };
    async function load() {
        A.loading = true; A.status = 'Starting...'; render3dPanel();
        try {
            const r0 = await W.api('area/load', 'POST', { x: A.spot.x, y: A.spot.y, z: A.spot.z == null ? undefined : A.spot.z, r: A.r, game: A.show.game || A.show.colGame, server: true, collision: true });
            if (r0 && r0.ok === false) throw new Error(r0.error);
            for (;;) {
                await new Promise(res => setTimeout(res, 500)); const st = await W.api('area/status'); A.status = st.status || A.status; render3dStatus();
                if (!st.busy) { if (st.error) throw new Error(st.error); break; }
            }
            A.data = await W.api('area/result'); if (A.data && A.data.ok === false) throw new Error(A.data.error);
            build();
        } catch (e) { W.toast(e.message, 'err'); A.err = e.message; }
        A.loading = false; render3dPanel(); W.draw();
    }
    W.close3d = function () { A.on = false; $('view3d').style.display = 'none'; $('map').style.display = 'block'; $('maphud').style.display = 'flex'; W.S.area = null; W.renderAll(); };

    function render3dStatus() { const s = $('a3status'); if (s) s.textContent = A.status; }
    function render3dPanel() {
        if (!A.on) return; const Rt = $('wright'); Rt.innerHTML = '';
        const chk = (label, key, title) => el('label', { class: 'chk', title: title || null }, el('input', { type: 'checkbox', checked: A.show[key] ? true : null, onchange: (e) => { A.show[key] = e.target.checked; applyVisibility(); } }), label);
        Rt.append(el('div', { class: 'h' }, 'The area in 3D'), el('div', { class: 'note' }, A.spot.x.toFixed(1) + ', ' + A.spot.y.toFixed(1) + (A.data ? ', z ' + A.data.centre[2].toFixed(1) : '') + ' · ' + A.r + ' m round'),
            el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: W.close3d }, '← Back to the map (Esc)'), el('button', { class: 'btn sm', disabled: A.loading ? true : null, onclick: load }, 'Load again')),
            el('div', { class: 'row' }, el('label', null, 'Radius'), el('input', { type: 'range', class: 'grow', min: '20', max: '300', step: '10', value: String(A.r), oninput: (e) => { e.target.nextSibling.textContent = e.target.value + ' m'; }, onchange: (e) => { A.r = +e.target.value; W.S.area = { x: A.spot.x, y: A.spot.y, r: A.r }; load(); } }), el('span', { class: 'note', style: { margin: 0, width: '44px' } }, A.r + ' m')));
        if (A.loading) { Rt.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note', id: 'a3status' }, A.status)); return; }
        Rt.append(el('div', { class: 'h' }, 'Show'), chk('The game\'s buildings (grey)', 'game'), chk('Your resources\' MLOs and maps', 'server'), chk('The game\'s collision (orange lines)', 'colGame'), chk('Your resources\' collision (their colour)', 'colServer'));
        const d = A.data; if (!d) { if (A.err) Rt.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, A.err)); return; }
        const srcs = {}; (d.server || []).forEach(s => { srcs[s.resource] = srcs[s.resource] || {}; srcs[s.resource].m = s; }); (d.collision || []).forEach(c => { if (c.source !== 'the game') { srcs[c.source] = srcs[c.source] || {}; srcs[c.source].c = c; } });
        Rt.append(el('div', { class: 'h' }, 'Resources here (' + Object.keys(srcs).length + ')'));
        if (!Object.keys(srcs).length) Rt.append(el('div', { class: 'note' }, W.S.data ? 'None of your resources has anything in this area.' : 'Scan your server (left) to see your resources here.'));
        Object.keys(srcs).forEach(n => {
            const s = srcs[n];
            Rt.append(el('div', { class: 'res', style: { '--c': colourOf(n), cursor: 'default' } },
                el('label', { class: 'chk', style: { margin: 0 } }, el('input', { type: 'checkbox', checked: !A.hidden[n] ? true : null, onchange: (e) => { A.hidden[n] = !e.target.checked; applyVisibility(); } }), el('span', { class: 't' }, n)),
                s.m ? el('div', { class: 'm' }, s.m.entities + ' entities · ' + s.m.tris.toLocaleString() + ' triangles' + (s.m.missing ? ' · ' + s.m.missing + ' models not found' : '') + (s.m.encrypted ? ' · has encrypted files' : '')) : null,
                s.c ? el('div', { class: 'm' }, 'collision: ' + s.c.files.join(', ')) : null,
                s.c ? el('button', { class: 'btn sm' + (A.fix && A.fix.res === n ? ' on' : ''), style: { marginTop: '4px' }, onclick: () => { if (A.fix && A.fix.res === n) { A.fix = null; build(); render3dPanel(); } else W.fixCollision(n); } }, A.fix && A.fix.res === n ? 'Stop fixing' : 'Fix its collision') : null));
            if (A.fix && A.fix.res === n) Rt.append(fixPanel());
        });
        const gc = (d.collision || []).find(c => c.source === 'the game'); if (gc && gc.files.length) Rt.append(el('div', { class: 'note' }, 'The game\'s collision files here: ' + gc.files.join(', ')));
        if ((d.warnings || []).length) Rt.append(el('div', { class: 'note', style: { color: 'var(--amber)' } }, d.warnings.join(' ')));
        Rt.append(el('div', { class: 'note' }, 'Left-drag turns, right-drag (or Shift) pans, wheel zooms, WASD moves, Q / E down and up. Lines of two colours crossing inside each other are collision that clashes.'));
    }
    function fixPanel() {
        const F = A.fix, box = el('div', { class: 'res on', style: { '--c': colourOf(F.res), cursor: 'default' } });
        box.append(el('div', { class: 't' }, 'Fixing ' + F.res + '\'s collision'));
        if (!F.sel) box.append(el('div', { class: 'note' }, 'Click a piece of its collision lines in the view to select it.'));
        else {
            const c = (A.data.collision || []).find(x => x.source === F.res), f = c && c.fileList ? c.fileList[F.sel.ref[0]] : null;
            box.append(el('div', { class: 'note' }, (F.sel.kind === 'tri' ? 'Triangle' : 'Box') + ' ' + F.sel.ref[2] + ' of part ' + F.sel.ref[1] + ' in ' + (f ? f.rel : '?') + ' · at ' + F.sel.point.map((v, k) => (v + A.data.centre[k]).toFixed(2)).join(', ')),
                el('div', { class: 'row wrap' }, el('button', { class: 'btn sm danger', onclick: () => takeOut(false) }, 'Take it out (Delete)'), el('button', { class: 'btn sm danger', title: 'The whole part this piece belongs to (yellow)', onclick: () => takeOut(true) }, 'The whole part (Shift+Del)')));
            const sz = (i, label) => el('input', { type: 'number', class: 'txt', step: '0.1', min: '0.05', value: String(F.size[i]), title: label, style: { width: '58px' }, onchange: (e) => { F.size[i] = Math.max(0.05, parseFloat(e.target.value) || 1); } });
            box.append(el('div', { class: 'row' }, el('button', { class: 'btn sm', title: 'A collision box standing on this point (B)', onclick: addBox }, 'Add a box here (B)'), sz(0, 'width (x)'), sz(1, 'depth (y)'), sz(2, 'height (z)')));
        }
        const n = F.del.size + F.adds.length;
        box.append(el('div', { class: 'note' }, n ? F.del.size + ' piece(s) to take out, ' + F.adds.length + ' box(es) to add.' : 'No changes yet.'),
            el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', disabled: n ? null : true, onclick: undoFix }, 'Undo (Ctrl+Z)'), el('button', { class: 'btn sm primary', disabled: n ? null : true, onclick: writeFix }, 'Write the fixed files')));
        if (F.written && F.written.length) box.append(el('div', { class: 'note', style: { color: '#8fdcae' } }, 'Written to ' + F.written[0].dir + '. Copy the files over the ones in your resource (keep a backup), then restart it.'), el('button', { class: 'btn sm', onclick: () => W.api('reveal?name=' + encodeURIComponent(F.written[0].dir), 'POST').catch(() => { }) }, 'Open the folder'));
        box.append(el('div', { class: 'note' }, 'Your server folder is not changed: the fixed copies go to the output folder. Encrypted files cannot be fixed.'));
        return box;
    }
    W.render3dPanel = render3dPanel;
    // (tests: look straight down at the middle of the resource being fixed)
    W.__aimCamera = function () { const c = A.fix && (A.data.collision || []).find(x => x.source === A.fix.res); if (!c || !R) return; const t = pieces(c).tris; let x = 0, y = 0, z = -1e9, n = 0; for (let i = 0; i < t.length; i += 3) { x += t[i]; y += t[i + 1]; z = Math.max(z, t[i + 2]); n++; } R.camera.target = [x / n, y / n, z]; R.camera.pitch = 1.55; R.camera.dist = 12; };
    // the map's right panel is replaced while the 3D view is open
    const orig = W.renderAll; W.renderAll = function () { orig(); if (A.on) render3dPanel(); };
})(window.MLO);
