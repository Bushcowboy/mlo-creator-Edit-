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
            R.setStaticLines('col:' + c.source, colLines(f32(c.tris), f32(c.boxes)), col, true);
        });
        applyVisibility();
    }
    function applyVisibility() {
        if (!R || !A.data) return;
        (A.data.collision || []).forEach(c => R.staticOn('col:' + c.source, (c.source === 'the game' ? A.show.colGame : A.show.colServer) && !A.hidden[c.source]));
    }
    const visible = (b) => b.kind === 'game' ? A.show.game : (b.kind.indexOf('srv:') === 0 ? A.show.server && !A.hidden[b.kind.slice(4)] : true);
    function frame() { raf = requestAnimationFrame(frame); if (A.on && R) R.render(visible); }

    function bind(c) {
        let drag = null;
        c.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }; e.preventDefault(); });
        window.addEventListener('mousemove', e => {
            if (!drag || !A.on) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
            if (drag.b === 0 && !drag.shift) R.camera.orbit(dx, dy); else R.camera.pan(dx, dy);
        });
        window.addEventListener('mouseup', () => { drag = null; });
        c.addEventListener('contextmenu', e => e.preventDefault());
        c.addEventListener('wheel', e => { e.preventDefault(); R.camera.zoom(Math.pow(1.0012, e.deltaY)); }, { passive: false });
        window.addEventListener('keydown', e => {
            const ae = document.activeElement, typing = ae && ((ae.tagName === 'INPUT' && /^(text|number|search|)$/.test(ae.type)) || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
            if (!A.on || typing) return; const cam = R.camera, s = cam.dist * 0.04, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
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
                W.openInProject ? el('button', { class: 'btn sm', style: { marginTop: '4px' }, onclick: () => W.openInProject(n) }, 'Fix its collision in a project...') : null));
        });
        const gc = (d.collision || []).find(c => c.source === 'the game'); if (gc && gc.files.length) Rt.append(el('div', { class: 'note' }, 'The game\'s collision files here: ' + gc.files.join(', ')));
        if ((d.warnings || []).length) Rt.append(el('div', { class: 'note', style: { color: 'var(--amber)' } }, d.warnings.join(' ')));
        Rt.append(el('div', { class: 'note' }, 'Left-drag turns, right-drag (or Shift) pans, wheel zooms, WASD moves, Q / E down and up. Lines of two colours crossing inside each other are collision that clashes.'));
    }
    W.render3dPanel = render3dPanel;
    // the map's right panel is replaced while the 3D view is open
    const orig = W.renderAll; W.renderAll = function () { orig(); if (A.on) render3dPanel(); };
})(window.MLO);
