// Props placed inside the interior (Place props tool, key 0): the game's own models, or model files of the project, as entities of the MLO. What it offers comes from what the
// project is made of: the props its imported map files place (and its model files nothing places), the props the game places around the building, the other models of
// the game archive the building comes from, the props of a game interior (the ones near the building first), and a search of every model of the game.
// Stored on the shell (so per building): shell.props [{ id, n, x, y, z, h }] in the grid's coordinates (the interior's own: x y on the plan, z above the floor, h heading in degrees).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, el = M.el, bus = Model.bus;
    const PR = M.Props = { ver: 0, err: '' };
    const r3 = (v) => Math.round(v * 1000) / 1000, snap = (v) => r3(Math.round(v / 0.05) * 0.05);
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const uid = () => Math.random().toString(36).slice(2, 9);
    const props = () => (S.project && S.project.shell && S.project.shell.props) || [];
    const imp = () => (S.project && S.project.import) || {};
    const enc = () => encodeURIComponent(Model.safeName(S.project.name));
    const f32 = (s) => { const u = M.fromB64(s); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); };

    // ---- the models' meshes (the game's, or a model file of the project): name -> { pos, nrm, mn, mx, tris, own } | null (no picture) ----
    const meshes = new Map(); let fetching = false, queue = new Set(), timer = null;
    function need(names) { names.forEach(n => { if (n && !meshes.has(n)) queue.add(n); }); if (queue.size && !timer) timer = setTimeout(fetchMeshes, 40); }
    async function fetchMeshes() {
        timer = null; if (fetching) { timer = setTimeout(fetchMeshes, 300); return; }
        const ask = [...queue].slice(0, 40); ask.forEach(n => queue.delete(n)); if (!ask.length) return; fetching = true;
        try {
            const r = await Model.api('import/prop-models?name=' + enc(), 'POST', { names: ask, gta: '' }), ms = r.models || {};
            ask.forEach(n => {
                const d = ms[n]; if (!d) { meshes.set(n, null); return; }
                const pos = f32(d.pos), nrm = f32(d.nrm), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
                for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { if (pos[i + a] < mn[a]) mn[a] = pos[i + a]; if (pos[i + a] > mx[a]) mx[a] = pos[i + a]; }
                meshes.set(n, { pos, nrm, mn, mx, tris: d.tris, own: !!d.own });
            });
            PR.err = '';
        } catch (e) { ask.forEach(n => meshes.set(n, null)); PR.err = e.message; }
        fetching = false; PR.ver++;
        if (queue.size) timer = setTimeout(fetchMeshes, 40);
        if (M.App && M.App.remesh && S.project.kind === 'import') M.App.remesh();
        if (S.shellTool === 'furnish' && M.UI) M.UI.renderLeft();
    }
    PR.mesh = (n) => meshes.get(n);
    PR._setMesh = (n, m) => { meshes.set(n, m); PR.ver++; };            // (tests)
    // a prop's footprint: the middle and half sizes of its box in its own coordinates (a 0.5 x 0.5 x 0.8 m box while there is no picture)
    function extent(n) { const m = meshes.get(n); if (!m) return { c: [0, 0, 0.4], h: [0.25, 0.25, 0.4] }; return { c: [(m.mn[0] + m.mx[0]) / 2, (m.mn[1] + m.mx[1]) / 2, (m.mn[2] + m.mx[2]) / 2], h: [Math.max(0.05, (m.mx[0] - m.mn[0]) / 2), Math.max(0.05, (m.mx[1] - m.mn[1]) / 2), Math.max(0.05, (m.mx[2] - m.mn[2]) / 2)] }; }
    // the box in the grid's coordinates: centre, half sizes, turn
    function obox(p) { const e = extent(p.n), h = (p.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h); return { c: [p.x + e.c[0] * c - e.c[1] * s, p.y + e.c[0] * s + e.c[1] * c, (p.z || 0) + e.c[2]], hu: e.h[0], hn: e.h[1], hz: e.h[2], yaw: h }; }
    // the prop whose footprint holds a point of the plan (the smallest, so a vase on a table can be picked)
    function at(x, y) {
        let best = -1, area = 1e9;
        props().forEach((p, i) => { const b = obox(p), dx = x - b.c[0], dy = y - b.c[1], c = Math.cos(-b.yaw), s = Math.sin(-b.yaw), lx = dx * c - dy * s, ly = dx * s + dy * c; if (Math.abs(lx) <= b.hu + 0.04 && Math.abs(ly) <= b.hn + 0.04 && b.hu * b.hn < area) { area = b.hu * b.hn; best = i; } });
        return best;
    }
    PR.at = at;

    // ---- in the view: each prop's mesh, turned and moved (a box while its picture is not there) ----
    const COL = { prop: [0.78, 0.8, 0.86], sel: [1, 0.88, 0.42], own: [0.7, 0.86, 0.74], none: [0.95, 0.62, 0.32] };
    const bcache = new Map();
    function boxMesh() {
        const pos = [], nrm = [], q = (a, b, c, d, n) => { [a, b, c, a, c, d].forEach(p => { pos.push(...p); nrm.push(...n); }); };
        const x0 = -0.25, x1 = 0.25, y0 = -0.25, y1 = 0.25, z0 = 0, z1 = 0.8;
        q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]); q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]);
        q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]); q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
        return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
    }
    const BOX = boxMesh();
    PR.batches = function () {
        const L = props(); if (!L.length) return [];
        need(L.map(p => p.n)); const out = [], keep = new Set();
        L.forEach(p => {
            const m = meshes.get(p.n), sel = S.propSel === p.id, src = m || BOX, key = [p.id, p.n, p.x, p.y, p.z || 0, p.h || 0, sel, !!m, PR.ver].join('|'); keep.add(p.id);
            let b = bcache.get(p.id);
            if (!b || b.key !== key) {
                const n = src.pos.length / 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), idx = new Uint16Array(n), h = (p.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), z = p.z || 0;
                for (let i = 0; i < n; i++) {
                    const x = src.pos[i * 3], y = src.pos[i * 3 + 1]; pos[i * 3] = p.x + x * c - y * s; pos[i * 3 + 1] = p.y + x * s + y * c; pos[i * 3 + 2] = z + src.pos[i * 3 + 2];
                    const nx = src.nrm[i * 3], ny = src.nrm[i * 3 + 1]; nrm[i * 3] = nx * c - ny * s; nrm[i * 3 + 1] = nx * s + ny * c; nrm[i * 3 + 2] = src.nrm[i * 3 + 2]; idx[i] = i;
                }
                b = { key, batch: { level: 0, kind: 'prop', group: 'int', tex: '', imgKey: null, flat: sel ? COL.sel : (!m ? COL.none : (m.own ? COL.own : COL.prop)), alpha: m ? 1 : 0.75, noCull: true, pos, nrm, uv: new Float32Array(n * 2), idx, glass: false, prop: p.id } };
                bcache.set(p.id, b);
            }
            out.push(b.batch);
        });
        [...bcache.keys()].forEach(k => { if (!keep.has(k)) bcache.delete(k); });
        return out;
    };

    // ---- pointer and keys ----
    let hover = null, drag = null;
    PR.reset = function () { hover = null; drag = null; };
    PR.scan = function (e, g) { hover = g ? { rx: g.rx, ry: g.ry, x: e && e.shiftKey ? r3(g.rx) : snap(g.rx), y: e && e.shiftKey ? r3(g.ry) : snap(g.ry), on: at(g.rx, g.ry) } : null; if (drag && hover) { drag.x = r3(hover.rx + drag.ox); drag.y = r3(hover.ry + drag.oy); if (!e || !e.shiftKey) { drag.x = snap(drag.x); drag.y = snap(drag.y); } if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 0.01) drag.moved = true; } };
    PR.dragging = () => !!drag;
    // a click with a model chosen places it (on top of the prop under the pointer: a vase on a table); with none chosen, or with Alt, it selects the prop and drags it
    PR.down = function (e) {
        if (!hover) return;
        if (hover.on >= 0 && (!S.propPick || (e && e.altKey))) {
            const p = props()[hover.on]; S.propSel = p.id; drag = { id: p.id, ox: p.x - hover.rx, oy: p.y - hover.ry, x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false };
            if (M.App && M.App.remesh) M.App.remesh(); M.UI.renderLeft(); return;
        }
        if (!S.propPick) { toast('Pick a model in the list on the left first, then click the floor.', 'warn'); return; }
        const under = hover.on >= 0 ? obox(props()[hover.on]) : null, z = under ? under.c[2] + under.hz : (S.propZ || 0);
        const p = { id: uid(), n: S.propPick, x: hover.x, y: hover.y, z: r3(z), h: r3(S.propHeading || 0) };
        Model.edit(P => { (P.shell.props = P.shell.props || []).push(p); }); S.propSel = p.id; M.UI.renderLeft();
    };
    PR.up = function () {
        const d = drag; drag = null; if (!d || !d.moved) return;
        Model.edit(P => { const q = (P.shell.props || []).find(o => o.id === d.id); if (q) { q.x = d.x; q.y = d.y; } }); M.UI.renderLeft();
    };
    const sel = () => props().find(p => p.id === S.propSel) || null;
    PR.turn = function (deg) { const p = sel(); if (!p) return false; Model.edit(P => { const q = P.shell.props.find(o => o.id === p.id); q.h = r3((((q.h || 0) + deg) % 360 + 360) % 360); }); M.UI.renderLeft(); return true; };
    PR.remove = function (id) { const i = props().findIndex(p => p.id === (id || S.propSel)); if (i < 0) return false; Model.edit(P => { P.shell.props.splice(i, 1); }); if (!id || id === S.propSel) S.propSel = null; M.UI.renderLeft(); return true; };
    PR.copy = function () { const p = sel(); if (!p) return false; const q = Object.assign({}, p, { id: uid(), x: r3(p.x + 0.5), y: r3(p.y + 0.5) }); Model.edit(P => { P.shell.props.push(q); }); S.propSel = q.id; M.UI.renderLeft(); return true; };
    // R turns the selected prop 90 degrees (Shift+R: 15), X / Delete removes it, Shift+D copies it, Esc lets go of a drag, then of the selection, then of the chosen model
    PR.keyEv = function (e, k) {
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (k === 'r') { if (!PR.turn(e.shiftKey ? 15 : 90)) { S.propHeading = r3(((S.propHeading || 0) + (e.shiftKey ? 15 : 90)) % 360); toast('New props face ' + S.propHeading + ' degrees.', 'ok'); M.UI.renderLeft(); } return true; }
        if ((k === 'x' || k === 'Delete' || k === 'Backspace') && S.propSel) { PR.remove(); return true; }
        if (k === 'd' && e.shiftKey) { PR.copy(); return true; }
        if (k === 'Escape') { if (drag) { drag = null; return true; } if (S.propSel) { S.propSel = null; if (M.App.remesh) M.App.remesh(); M.UI.renderLeft(); return true; } if (S.propPick) { S.propPick = null; M.UI.renderLeft(); return true; } }
        return false;
    };
    // the eraser takes props too
    PR.erase = function (x, y) { const i = at(x, y); if (i < 0) return false; const id = props()[i].id; Model.edit(P => { P.shell.props.splice(i, 1); }); if (S.propSel === id) S.propSel = null; return true; };
    PR.draw = function (R) {
        const Y = [1, 0.9, 0.4, 0.9], ob = (b, fill, line) => R.ovOBox(b.c, b.hu, b.hn, b.hz, b.yaw, fill, line);
        const s = sel(); if (s && !drag) ob(obox(s), [1, 0.88, 0.42, 0.08], Y);
        if (drag) { const p = props().find(o => o.id === drag.id); if (p) { ob(obox(Object.assign({}, p, { x: drag.x, y: drag.y })), [1, 0.9, 0.4, 0.2], Y); return { text: p.n + ' to ' + drag.x.toFixed(2) + ', ' + drag.y.toFixed(2) + ' (Shift: no snapping)', at: [drag.x, drag.y, (p.z || 0) + 1.2] }; } }
        if (!hover) return null;
        const on = hover.on >= 0 ? props()[hover.on] : null, ub = on ? obox(on) : null;
        if (on && !S.propPick) { ob(ub, [1, 1, 1, 0.1], [1, 1, 1, 0.9]); return { text: on.n + ': click to select, drag to move · R turns it · X removes it', at: [ub.c[0], ub.c[1], ub.c[2] + ub.hz + 0.3] }; }
        if (!S.propPick) return { text: 'Pick a model on the left, then click the floor', at: [hover.x, hover.y, 0.5] };
        need([S.propPick]); const z = ub ? ub.c[2] + ub.hz : (S.propZ || 0), b = obox({ n: S.propPick, x: hover.x, y: hover.y, z, h: S.propHeading || 0 }); if (ub) ob(ub, [1, 1, 1, 0.06], [1, 1, 1, 0.6]); ob(b, [1, 0.9, 0.4, 0.18], Y);
        return { text: 'Click: ' + (on ? 'put ' + S.propPick + ' on ' + on.n + ' (Alt+click selects it)' : 'place ' + S.propPick + ' (' + hover.x.toFixed(2) + ', ' + hover.y.toFixed(2) + ')') + (meshes.get(S.propPick) === null ? ' · no picture of this model, a box stands in' : ''), at: [hover.x, hover.y, b.c[2] + b.hz + 0.3] };
    };

    // ---- what to offer: suggestions from the project's files, the game around the building, its archive, game interiors, a search ----
    PR.sg = {}; PR.busy = {};
    PR.load = async function (what, extra) {
        if (PR.busy[what]) return; PR.busy[what] = true; if (M.UI) M.UI.renderLeft();
        try {
            const I = imp(), r = await Model.api('import/prop-suggest?name=' + enc(), 'POST', Object.assign({ what, target: I.target || '', entity: I.entity || null, gta: '' }, extra || {}));
            PR.sg[what] = r;
            if ((what === 'interiors' || what === 'interior') && !r.index) pollIndex(what, extra);
        } catch (e) { PR.sg[what] = { error: e.message, items: [] }; }
        PR.busy[what] = false; if (M.UI && S.shellTool === 'furnish') M.UI.renderLeft();
    };
    let pollT = null;
    function pollIndex(what, extra) {
        clearTimeout(pollT);
        pollT = setTimeout(async () => {
            let st = null; try { st = await Model.api('interiors/status'); } catch (e) { }
            if (st && st.ready) { PR.load(what, extra); return; }
            if (PR.sg[what]) { PR.sg[what].status = st ? (st.status || st.error || '') : ''; if (st && st.error) PR.sg[what].error = st.error; }
            if (S.shellTool === 'furnish') { M.UI.renderLeft(); if (!(st && st.error)) pollIndex(what, extra); }
        }, 3000);
    }
    PR.pick = function (n) { S.propPick = n; need([n]); M.UI.renderLeft(); };
    // another project: its own suggestions, nothing selected
    bus.on('project', () => { PR.sg = {}; PR.busy = {}; S.propSel = null; S.propPick = null; hover = null; drag = null; });
    PR.exportList = function (P) { return ((P && P.shell && P.shell.props) || []).map(p => ({ name: p.n, x: p.x, y: p.y, z: p.z || 0, heading: p.h || 0 })); };

    // ---- the tool's panel ----
    const num = (label, value, step, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: String(step), value: String(value), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    function rows(items, max) {
        const box = el('div', { class: 'plist' });
        (items || []).slice(0, max || 200).forEach(it => box.append(el('div', { class: 'prow' + (S.propPick === it.n ? ' on' : ''), title: it.n + (it.set ? ' (entity set ' + it.set + ')' : '') + (it.src === 'own' ? ' (a model file of the project: the export ships it)' : ''), onclick: () => PR.pick(it.n) },
            el('span', { class: 'pn' }, it.n), it.set ? el('small', null, it.set) : null, it.src === 'own' ? el('small', null, 'your file') : null, it.k === 'plant' ? el('small', null, 'plant') : null, it.c ? el('small', null, '×' + it.c) : null)));
        if (!(items || []).length) box.append(el('div', { class: 'note' }, 'Nothing here.'));
        return box;
    }
    // a group of suggestions that opens and closes (remembered while the program runs); onOpen loads it the first time
    S.propOpen = S.propOpen || { files: true };
    function group(key, title, count, body, onOpen) {
        const d = el('details', { class: 'pgrp' }); if (S.propOpen[key]) d.open = true;
        d.addEventListener('toggle', () => { S.propOpen[key] = d.open; if (d.open && onOpen) onOpen(); });
        d.append(el('summary', null, el('span', { class: 'grow' }, title), count != null ? el('small', { class: 'note', style: { margin: 0 } }, String(count)) : null), el('div', { class: 'pbody' }, body));
        return d;
    }
    const status = (what) => { const r = PR.sg[what]; if (PR.busy[what]) return el('div', { class: 'note' }, 'Looking...'); if (r && r.error) return el('div', { class: 'note', style: { color: '#f0a070' } }, r.error); return null; };
    PR.toolPanel = function (root) {
        const I = imp(), L = props();
        root.append(el('div', { class: 'h' }, 'Place props'), el('div', { class: 'note' }, 'The game\'s props (or model files of yours) inside the interior: pick one below, then click the floor, or another prop to stand it on top. With no model chosen (Esc), or with Alt, a click selects a prop and a drag moves it; R turns it 90 degrees (Shift+R: 15), X removes it, Shift+D copies it. They are exported as the interior\'s own entities.'));
        // the model chosen, and how new ones stand
        root.append(el('div', { class: 'route', style: { padding: '6px 8px' } },
            el('div', { class: 'row', style: { margin: 0 } }, el('span', { class: 'grow' }, S.propPick ? el('b', null, S.propPick) : el('span', { class: 'note', style: { margin: 0 } }, 'No model chosen yet')), S.propPick ? el('button', { class: 'btn sm', title: 'Esc', onclick: () => { S.propPick = null; M.UI.renderLeft(); } }, '✕') : null),
            S.propPick && meshes.get(S.propPick) ? el('div', { class: 'note' }, meshes.get(S.propPick).tris.toLocaleString() + ' triangles · ' + (meshes.get(S.propPick).mx[0] - meshes.get(S.propPick).mn[0]).toFixed(2) + ' x ' + (meshes.get(S.propPick).mx[1] - meshes.get(S.propPick).mn[1]).toFixed(2) + ' x ' + (meshes.get(S.propPick).mx[2] - meshes.get(S.propPick).mn[2]).toFixed(2) + ' m') : (S.propPick && meshes.get(S.propPick) === null ? el('div', { class: 'note' }, 'No picture of this model' + (PR.err ? ' (' + PR.err + ')' : '') + ': a box stands in. It is exported all the same.') : null),
            num('Height', S.propZ || 0, 0.05, v => { S.propZ = r3(Math.max(-2, Math.min(20, v))); }, 'm above the floor'), num('Facing', S.propHeading || 0, 15, v => { S.propHeading = r3(((v % 360) + 360) % 360); }, 'degrees')));
        // the selected one
        const s = sel();
        if (s) {
            const ed = (fn) => { Model.edit(P => { const q = P.shell.props.find(o => o.id === s.id); if (q) fn(q); }); M.UI.renderLeft(); };
            root.append(el('div', { class: 'route', style: { padding: '6px 8px' } }, el('div', { class: 'row', style: { margin: 0 } }, el('b', { class: 'grow' }, s.n), el('button', { class: 'btn sm danger', title: 'X', onclick: () => PR.remove() }, 'Remove')),
                num('x', s.x, 0.05, v => ed(q => { q.x = r3(v); }), 'm'), num('y', s.y, 0.05, v => ed(q => { q.y = r3(v); }), 'm'), num('Height', s.z || 0, 0.05, v => ed(q => { q.z = r3(v); }), 'm'), num('Facing', s.h || 0, 15, v => ed(q => { q.h = r3(((v % 360) + 360) % 360); }), 'degrees'),
                el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'R', onclick: () => PR.turn(90) }, 'Turn 90°'), el('button', { class: 'btn sm', title: 'Shift+D', onclick: () => PR.copy() }, 'Copy'), el('button', { class: 'btn sm', onclick: () => PR.pick(s.n) }, 'Place more of these'))));
        }
        // what is placed
        const byName = {}; L.forEach(p => { byName[p.n] = (byName[p.n] || 0) + 1; });
        root.append(el('div', { class: 'h' }, 'Placed (' + L.length + ')'));
        if (!L.length) root.append(el('div', { class: 'note' }, 'None yet.'));
        else root.append(el('div', { class: 'plist' }, ...Object.keys(byName).sort().map(n => el('div', { class: 'prow' + (s && s.n === n ? ' on' : ''), onclick: () => { const p = L.find(q => q.n === n); S.propSel = p.id; const cam = M.App.renderer && M.App.renderer.camera; if (cam) cam.target = [p.x, p.y, (p.z || 0) + 0.5]; if (M.App.remesh) M.App.remesh(); M.UI.renderLeft(); } }, el('span', { class: 'pn' }, n), el('small', null, '×' + byName[n])))));

        // ---- suggestions ----
        root.append(el('div', { class: 'h' }, 'Models to place'));
        if (!PR.sg.files && !PR.busy.files) PR.load('files');
        const F = PR.sg.files || {};
        root.append(group('files', 'From your files', F.items ? F.items.length : null, [status('files'), el('div', { class: 'note' }, 'The props your imported map files place around the building, the most used first, and model files of yours that nothing places (the export ships those with the resource).'), rows(F.items)]));
        const N = PR.sg.near || {}, canNear = !!(I.target && I.entity);
        root.append(group('near', 'Around the building in the game', N.items ? N.items.length : null, [status('near'), canNear ? null : el('div', { class: 'note' }, 'Set where the building stands in the game first (Import tab).'), N.items ? rows(N.items) : null, canNear ? el('button', { class: 'btn sm', onclick: () => PR.load('near') }, N.items ? 'Look again' : 'Look up (reads the game\'s map, a few seconds)') : null]));
        const A = PR.sg.archive || {};
        root.append(group('archive', 'Same game archive', A.items ? A.items.length : null, [status('archive'), A.archive ? el('div', { class: 'note' }, 'Other models of ' + A.archive) : null, A.note ? el('div', { class: 'note' }, A.note) : null, A.items ? rows(A.items) : null, el('button', { class: 'btn sm', onclick: () => PR.load('archive') }, A.items ? 'Look again' : 'Look up')], () => { if (!PR.sg.archive) PR.load('archive'); }));
        // a game interior: the ones near the building, or one searched for by name
        const IN = PR.sg.interiors || {}, IT = PR.sg.interior || null, iq = el('input', { class: 'grow', placeholder: 'casino, apartment, garage...', value: S.propIntQ || '', onkeydown: (e) => { if (e.key === 'Enter') { S.propIntQ = e.target.value; PR.load('interiors', { q: S.propIntQ }); } } });
        const ib = [status('interiors'), IN.index === false ? el('div', { class: 'note' }, 'The list of the game\'s interiors is being made (only the first time, a few minutes)... ' + (IN.status || '')) : null,
            el('div', { class: 'row' }, iq, el('button', { class: 'btn sm', onclick: () => { S.propIntQ = iq.value; PR.load('interiors', { q: S.propIntQ }); } }, 'Find')),
            (IN.items || []).length ? el('div', { class: 'plist', style: { maxHeight: '120px' } }, ...IN.items.map(it => el('div', { class: 'prow' + (IT && IT.hash === it.hash ? ' on' : ''), onclick: () => PR.load('interior', { key: it.hash }) }, el('span', { class: 'pn' }, it.name), el('small', null, it.dist != null ? it.dist + ' m away' : (it.pack || ''))))) : (IN.items && !S.propIntQ ? el('div', { class: 'note' }, 'No game interior within 600 m of the building: find one by name.') : null),
            status('interior'), IT && IT.items ? el('div', { class: 'note' }, 'Props of ' + IT.name + (IT.pack ? ' (' + IT.pack + ')' : '') + ': ' + IT.items.length + ' models' + (IT.shell ? ', its ' + IT.shell + ' wall and floor pieces left out' : '')) : null, IT && IT.items ? rows(IT.items) : null];
        root.append(group('interiors', 'From a game interior', IT && IT.items ? IT.items.length : null, ib, () => { if (!PR.sg.interiors) PR.load('interiors'); }));
        // every model of the game
        const SR = PR.sg.search || {}, sq = el('input', { class: 'grow', placeholder: 'chair, sofa, bar, plant...', value: S.propQ || '', onkeydown: (e) => { if (e.key === 'Enter') { S.propQ = e.target.value; PR.load('search', { q: S.propQ }); } } });
        root.append(group('search', 'Search every game model', SR.items ? (SR.total > SR.items.length ? SR.items.length + ' of ' + SR.total : SR.items.length) : null, [el('div', { class: 'row' }, sq, el('button', { class: 'btn sm', onclick: () => { S.propQ = sq.value; PR.load('search', { q: S.propQ }); } }, 'Search')), status('search'), SR.items ? rows(SR.items) : null]));
    };
})(window.MLO);
