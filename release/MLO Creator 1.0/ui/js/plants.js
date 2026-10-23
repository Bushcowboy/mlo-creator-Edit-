// Plants and bushes of the game's map. They are not part of the building model: the map files place bushes, hedges, trees and weeds as props of their own, and one that
// stands in a room shows through the interior. The host lists the ones around the building (import/game-props); the ones whose middle reaches into a room are hidden by
// a small client script in the exported resource (CreateModelHide, a small radius around the exact spot). Stored in import.plants = { list, set, show }:
// list = [{ n name, x y z where it stands, cx cy cz its middle, r half its width, h height, sized, lod, files }] in WORLD coordinates, set = { key: true/false } is what the
// user ticked by hand against the rule, import.plantsHide = false switches the hiding off.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, IM = M.ImportModel;
    const imp = () => S.project.import;
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    const PL = M.Plants = { sel: null, busy: false, err: '' };
    const data = () => (S.project.kind === 'import' && imp() && imp().plants) || null;
    const list = () => { const d = data(); return d && d.list ? d.list : []; };
    const keyOf = (p) => p.n + '|' + (+p.x).toFixed(2) + '|' + (+p.y).toFixed(2) + '|' + (+p.z).toFixed(2);

    // a point of the world in the model's own coordinates (the model stands at import.entity, turned about the vertical)
    function toModel(p) {
        const e = imp().entity; if (!e) return null;
        const h = (e.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), dx = p.cx - e.x, dy = p.cy - e.y;
        return { x: dx * c + dy * s, y: -dx * s + dy * c, zc: p.cz - e.z, zb: p.z - e.z };
    }
    // ... and in the grid's (the view's) coordinates
    function toGrid(p, base) {
        const m = toModel(p), f = imp().frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), dx = m.x - f.x, dy = m.y - f.y;
        return [dx * c + dy * s, -dx * s + dy * c, (base ? m.zb : m.zc) - f.z];
    }

    // The rule: a plant goes when enough of it is inside a room: at least 3 triangles and at least plantsMin percent of all its triangles (5 by default). The host counts them when
    // the plants are looked up (p.tris of p.all, against the rooms as they were then: d.rooms). A bush that only leans over a wall from outside stays, and so does a big patch of
    // weeds with a few cards through the wall: hiding takes away the WHOLE plant, so a patch wider than 12 m is never hidden by the rule (only by a tick of yours). Without a count
    // (a lookup made before the rooms were drawn, or rooms changed since) nothing is hidden by the rule: only what you ticked. The export looks the plants up again first.
    let volCache = null, volAt = 0;
    const volumes = () => { const now = performance.now(); if (!volCache || now - volAt > 400) { volCache = IM.allRoomVolumes(true); volAt = now; } return volCache; };
    PL.gap = function (p) {                // how far the middle of the plant is from the nearest room (0: in one), null when no room is at its height
        const m = toModel(p); if (!m) return null; let best = null;
        volumes().forEach(v => {
            if (m.zc + p.h / 2 < v.zb - 0.3 || m.zc - p.h / 2 > v.zb + v.h + 0.3) return;
            const c = Math.cos(v.yaw), s = Math.sin(v.yaw), du = (m.x - v.cx) * c + (m.y - v.cy) * s, dn = -(m.x - v.cx) * s + (m.y - v.cy) * c;
            const g = Math.hypot(Math.max(Math.abs(du) - v.w / 2, 0), Math.max(Math.abs(dn) - v.d / 2, 0));
            if (best === null || g < best) best = g;
        });
        return best;
    };
    PL.minPct = () => { const v = imp().plantsMin; return v == null ? 5 : v; };
    PL.counted = (p) => p.tris != null && p.tris >= 0 && p.all > 0;
    PL.pct = (p) => PL.counted(p) ? p.tris / p.all * 100 : 0;
    PL.tooBig = (p) => p.r > 6;                                                   // wider than 12 m: a patch, not a plant
    PL.inside = (p) => !isProp(p) && PL.counted(p) && p.tris >= 3 && PL.pct(p) >= PL.minPct() && !PL.tooBig(p);        // (a prop that is not a plant is only ever removed by you)
    const roomsKey = () => JSON.stringify(IM.allRoomVolumes(true).map(v => [v.cx, v.cy, v.zb, v.w, v.h, v.d, v.yaw]));
    PL.VER = 4;                                                                    // (2: plants are found by what the model is made of, not only by its name; 3: with how the map places them, for the pictures; 4: the other props too)
    // what the Plants tool shows: vegetation, props (bins, boxes, fences...), small pieces of the model files (vents, pipes...: off until you ask for them)
    PL.kinds = () => Object.assign({ plant: true, prop: true, detail: false }, S.propKinds || {});
    const isProp = (p) => p.k === 'prop';
    PL.stale = () => { const d = data(); return !!(d && d.list && d.list.length && (d.rooms !== roomsKey() || d.ver !== PL.VER)); };
    // The doors and windows of every building in the model's coordinates ({ cx, cy, zb, w, h, yaw }): the cut openings and the placed window / door / frame models.
    let opCache = null, opAt = 0;
    PL.openings = function () {
        const now = performance.now(); if (opCache && now - opAt < 400) return opCache; opAt = now; const out = [];
        Model.bldAll(S.project).forEach(b => {
            const I = b.d.import, f = I.frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
            const add = (k) => out.push({ cx: f.x + k.cx * c - k.cy * s, cy: f.y + k.cx * s + k.cy * c, zb: f.z + k.zb, w: k.w, h: k.h, yaw: (k.yaw || 0) + h });
            (I.cutters || []).filter(k => k.type === 'door' || k.type === 'window' || k.type === 'arch').forEach(add); (I.fits || []).filter(k => k.open !== false).forEach(add);
        });
        return (opCache = out);
    };
    // A plant that stands in front of a window or a door (its middle within a metre of the opening's face, and the width of it) is in the way of the opening: it is hidden by default,
    // whether or not it reaches into a room. Only plants of bush size (up to 5 m across): a big patch of weeds beside a window is not "in front of" it.
    PL.blocks = function (p) {
        if (isProp(p) || p.r > 2.5 || p.h < 0.3) return false; const m = toModel(p); if (!m) return false; const rr = Math.min(p.r, 2) * 0.7;
        return PL.openings().some(o => {
            if (m.zc - p.h / 2 > o.zb + o.h || m.zc + p.h / 2 < o.zb) return false;
            const c = Math.cos(o.yaw), s = Math.sin(o.yaw), du = (m.x - o.cx) * c + (m.y - o.cy) * s, dn = -(m.x - o.cx) * s + (m.y - o.cy) * c;
            return Math.hypot(Math.max(Math.abs(du) - o.w / 2 - 0.3, 0), Math.max(Math.abs(dn) - 1.0, 0)) <= rr;
        });
    };
    PL.auto = (p) => (!PL.stale() && PL.inside(p)) || PL.blocks(p);                   // what the rules say, before your ticks
    PL.on = (p) => { const d = data(), k = keyOf(p); if (d && d.set && k in d.set) return !!d.set[k]; return PL.auto(p); };
    // what the export hides
    PL.hideList = function () {
        const I = imp(); if (!I || I.plantsHide === false) return [];
        return list().filter(PL.on).map(p => ({ n: p.n, x: p.x, y: p.y, z: p.z }));
    };
    // counted against the rooms as they are now (the export does this first, so a lookup from before the rooms were drawn is never used); false when it could not be done
    PL.ensureFresh = async function () {
        const I = imp(); if (!I || !PL.stale()) return true; if (!I.target || !I.entity || PL.busy) return false;
        await PL.lookup(document.createElement('div'), document.createElement('button')); return !PL.err && !PL.stale();
    };

    PL.lookup = async function (statusEl, btn) {
        const I = imp(); if (!I.target || !I.entity || PL.busy) return; PL.busy = true; PL.err = ''; btn.disabled = true; btn.textContent = 'Looking...';
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) statusEl.textContent = s.status; } catch (e) { } }, 500);
        try {
            const rooms = roomsKey(), r = await Model.api('import/game-props?name=' + encodeURIComponent(Model.safeName(S.project.name)), 'POST', { target: I.target, gta: '', entity: I.entity, volumes: IM.allRoomVolumes(true), others: true, region: 'all', skip: (IM.files || []).filter(f => f.kind === 'model').map(f => f.name) });          // (the whole model, not only the part round the rooms)
            const props = r.props || [], keys = new Set(props.map(keyOf));
            Model.edit(Q => { const old = Q.import.plants || {}, set = {}; Object.keys(old.set || {}).forEach(k => { if (keys.has(k)) set[k] = old.set[k]; }); Q.import.plants = { list: props, set, show: old.show !== false, rooms, ver: PL.VER }; });
            if (!props.length) PL.err = 'The map places no plants around this building.';
        } catch (e) { PL.err = e.message; }
        clearInterval(poll); PL.busy = false; M.UI.renderLeft();
    };
    PL.go = function (p) {                 // look at it
        PL.sel = keyOf(p); const g = toGrid(p, true), cam = M.App.renderer.camera; cam.target = [g[0], g[1], 0.6]; cam.dist = Math.min(cam.dist, 8); M.UI.renderLeft();
    };

    // ---------- bushes that are part of the model files ----------
    // Not every bush is a prop of the map: the block's detail files (det01..05, detail_01...) hold bushes, hedges and weeds as flat cards (parts whose texture is a "crop", "weed",
    // "bush"...: the Vegetation kind of the clearing). They stand where the game's map puts those files (IM.detailXf). The cards of one bush are separate triangles, so cards
    // closer than 1 m to each other are one bush. Removing a bush deletes its triangles from the file (import.mdeletes, or import.deletes for the building's own file) like the
    // Delete faces tool does, and the export writes the changed file. Only the ones within 12 m of a room are looked at.
    const gapTo = (x, y, z, vols) => {                            // distance from a point (the model's coordinates) to the nearest room: 0 inside, null when no room is at its height
        let best = null;
        vols.forEach(v => {
            if (z < v.zb - 0.5 || z > v.zb + v.h + 0.5) return;
            const c = Math.cos(v.yaw), s = Math.sin(v.yaw), du = (x - v.cx) * c + (y - v.cy) * s, dn = -(x - v.cx) * s + (y - v.cy) * c;
            const g = Math.hypot(Math.max(Math.abs(du) - v.w / 2, 0), Math.max(Math.abs(dn) - v.d / 2, 0)); if (best === null || g < best) best = g;
        });
        return best;
    };
    let mbCache = null;
    PL.bushes = function () {
        const I = imp(); if (!I || !IM.loaded) return [];
        const key = [IM.cutVer, JSON.stringify(I.detailPlace || {}), I.entity ? I.entity.x + ',' + I.entity.y : '', roomsKey(), IM.models.length, I.frame.z].join('|'); if (mbCache && mbCache.key === key) return mbCache.list;
        // the whole model (every house of the block), not only the part round the rooms; gp = how far from a room (1000 when there is none at its height)
        const vols = IM.allRoomVolumes(true), tf = (IM.targetModel() || {}).file, items = [], wcell = new Map();
        IM.models.forEach(m => m.geoms.forEach(g => {
            const kind = IM.partKind(g.texName, g.shader); if (kind !== 'veg' && kind !== 'win') return; const p = g.pos, ix = g.idx;
            for (let t = 0; t * 3 + 2 < ix.length; t++) {
                const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3, x = (p[a] + p[b] + p[c]) / 3, y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
                if (kind === 'win') { const k = Math.floor(x) + '|' + Math.floor(y); let l = wcell.get(k); if (!l) wcell.set(k, l = []); l.push([x, y, z]); continue; }          // (the windows of the model: where the details at windows are)
                const gp = gapTo(x, y, z, vols); items.push({ f: m.file, g: g.g, t, x, y, z, gp: gp === null ? 1000 : gp });
            }
        }));
        const nearWin = (x, y, z0, z1) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = wcell.get((Math.floor(x) + dx) + '|' + (Math.floor(y) + dy)); if (l) for (const w of l) if (Math.hypot(w[0] - x, w[1] - y) <= 0.9 && w[2] >= z0 - 0.4 && w[2] <= z1 + 0.4) return true; } return false; };
        // one bush = cards that touch (a metre between neighbours), in the same file
        const par = items.map((_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }, cell = new Map();
        items.forEach((it, i) => { const k = it.f + '|' + Math.floor(it.x) + '|' + Math.floor(it.y) + '|' + Math.floor(it.z); let l = cell.get(k); if (!l) cell.set(k, l = []); l.push(i); });
        items.forEach((it, i) => {
            const cx = Math.floor(it.x), cy = Math.floor(it.y), cz = Math.floor(it.z);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const l = cell.get(it.f + '|' + (cx + dx) + '|' + (cy + dy) + '|' + (cz + dz)); if (!l) continue; l.forEach(j => { if (j > i && Math.hypot(items[j].x - it.x, items[j].y - it.y, items[j].z - it.z) <= 1.0) par[find(j)] = find(i); }); }
        });
        const groups = new Map(); items.forEach((it, i) => { const r = find(i); let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(it); });
        const list = []; groups.forEach(l => {
            if (l.length < 3) return; const n = l.length, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let sx = 0, sy = 0, sz = 0, gap = 1e9, inRoom = 0;
            l.forEach(it => { sx += it.x; sy += it.y; sz += it.z; const q = [it.x, it.y, it.z]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], q[a]); mx[a] = Math.max(mx[a], q[a]); } gap = Math.min(gap, it.gp); if (it.gp === 0) inRoom++; });
            // The cut-out texture page of the detail files also holds the little details of windows (sills, boxes, bars, awnings): cards next to a window part are those, not bushes.
            if (nearWin(sx / n, sy / n, mn[2], mx[2])) return;
            const f = l[0].f, name = f.replace(/\.ydr$/i, '').replace(/^[a-z0-9]+_\d+_(res\d+_)?/i, '');
            list.push({ key: f + '|' + (sx / n).toFixed(1) + '|' + (sy / n).toFixed(1) + '|' + (sz / n).toFixed(1), file: f, name, target: f === tf, tris: l.map(it => [it.g, it.t]), n, c: [sx / n, sy / n, mn[2]], w: Math.max(mx[0] - mn[0], mx[1] - mn[1]), h: mx[2] - mn[2], gap, inRoom });
        });
        // a bush stands on the ground: cards that start more than 50 cm above the lowest card of the same file round them (10 m) are something at a window or on a wall
        const keep = list.filter(b => !list.some(o => o.file === b.file && o !== b && Math.hypot(o.c[0] - b.c[0], o.c[1] - b.c[1]) <= 10 && b.c[2] - o.c[2] > 0.5));
        keep.sort((a, b) => a.gap - b.gap); mbCache = { key, list: keep }; return keep;
    };
    // Small pieces of the model files (the "other small removals"): a vent, a pipe, a box, a step, a lamp: separate pieces (connected triangles) of the building and of its detail
    // files that are at most 3.5 m across, anywhere in the model (the nearest 800 to a room first). Not windows (their own kind), not decals and overlays (paint on a wall, not an object), not
    // vegetation (the bushes). They come out of the file the same way (import.deletes / import.mdeletes). Listed nearest first.
    let dtCache = null;
    PL.details = function () {
        const I = imp(); if (!I || !IM.loaded) return [];
        const key = [IM.cutVer, JSON.stringify(I.detailPlace || {}), roomsKey(), IM.models.length, I.frame.z].join('|'); if (dtCache && dtCache.key === key) return dtCache.list;
        const vols = IM.allRoomVolumes(true), tf = (IM.targetModel() || {}).file, out = [], seen = new Set();
        IM.models.forEach(m => {
            const gmap = new Map(); m.geoms.forEach(g => gmap.set(g.g, g));
            m.geoms.forEach(g => {
                const sh = (g.shader || '') + ' ' + (g.texName || ''); if (IM.partKind(g.texName, g.shader) !== 'other' || /decal|overlay/i.test(sh)) return;
                const p = g.pos, ix = g.idx;
                for (let t = 0; t * 3 + 2 < ix.length; t++) {
                    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3, x = (p[a] + p[b] + p[c]) / 3, y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3, gp0 = gapTo(x, y, z, vols), gp = gp0 === null ? 1000 : gp0;
                    const isl = IM.island(m.file, g.g, t); if (!isl.length) continue; const ik = m.file + '|' + isl[0].g + ':' + isl[0].tris[0]; if (seen.has(ik)) continue; seen.add(ik);
                    let n = 0; isl.forEach(s => { n += s.tris.length; }); if (n > 1500 || n < 2) continue;
                    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], tris = [];
                    isl.forEach(s => { const gg = gmap.get(s.g); if (!gg) return; s.tris.forEach(tt => { tris.push([s.g, tt]); for (let k = 0; k < 3; k++) { const i = gg.idx[tt * 3 + k] * 3; for (let q = 0; q < 3; q++) { const v = gg.pos[i + q]; if (v < mn[q]) mn[q] = v; if (v > mx[q]) mx[q] = v; } } }); });
                    const w = Math.max(mx[0] - mn[0], mx[1] - mn[1]), h = mx[2] - mn[2]; if (w > 3.5 || h > 3.5) continue;
                    const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2, g2 = gapTo(cx, cy, cz, vols);
                    out.push({ key: ik + '|' + cx.toFixed(1) + '|' + cy.toFixed(1), file: m.file, name: m.file.replace(/\.ydr$/i, '').replace(/^[a-z0-9]+_\d+_(res\d+_)?/i, ''), target: m.file === tf, tris, n, c: [cx, cy, mn[2]], w, h, gap: g2 == null ? gp : g2 });
                }
            });
        });
        out.sort((a, b) => a.gap - b.gap); const list = out.slice(0, 800); dtCache = { key, list }; return list;
    };
    PL.bushGone = (b) => { const I = imp(), del = b.target ? new Set(I.deletes.map(d => d[0] + ':' + d[1])) : IM.mdelSet(b.file); return b.tris.every(t => del.has(t[0] + ':' + t[1])); };
    // takes a bush's triangles out of its file (on), or gives them back, in the project data Q.import
    function bushEdit(I, b, on) {
        if (b.target) { const have = new Set(I.deletes.map(d => d[0] + ':' + d[1])); if (on) b.tris.forEach(t => { if (!have.has(t[0] + ':' + t[1])) I.deletes.push([t[0], t[1]]); }); else { const gone = new Set(b.tris.map(t => t[0] + ':' + t[1])); I.deletes = I.deletes.filter(d => !gone.has(d[0] + ':' + d[1])); } }
        else { I.mdeletes = I.mdeletes || []; const gone = new Set(b.tris.map(t => t[0] + ':' + t[1])); if (on) { const have = new Set(I.mdeletes.filter(d => d[0] === b.file).map(d => d[1] + ':' + d[2])); b.tris.forEach(t => { if (!have.has(t[0] + ':' + t[1])) I.mdeletes.push([b.file, t[0], t[1]]); }); } else I.mdeletes = I.mdeletes.filter(d => !(d[0] === b.file && gone.has(d[1] + ':' + d[2]))); }
    }
    PL.setBush = function (b, on) { Model.edit(Q => { bushEdit(Q.import, b, on); }); M.UI.renderLeft(); };
    const mToGrid = (c) => { const f = imp().frame, h = (f.heading || 0) * Math.PI / 180, cs = Math.cos(h), sn = Math.sin(h), dx = c[0] - f.x, dy = c[1] - f.y; return [dx * cs + dy * sn, -dx * sn + dy * cs, c[2] - f.z]; };
    PL.goBush = function (b) {
        PL.sel = b.key; if (!IM.showDetails) { IM.showDetails = true; IM.rebuild(); }          // (the bush is part of a detail file: it is only drawn with the detail models on)
        const g = mToGrid(b.c), cam = M.App.renderer.camera; cam.target = [g[0], g[1], g[2] + 0.6]; cam.dist = Math.min(cam.dist, 8); M.UI.renderLeft();
    };

    // ---------- the models themselves, in the view ----------
    // "Show the plant models": the real meshes of the map's plants (the game's models, at most 2,500 triangles each) drawn where they stand, orange when they will be removed, green
    // when they stay, and the cards of the model-file bushes in cyan, so you can see what a tick takes away. They go into the model batches (IM.rebuild).
    const pcache = new Map(); let pbusy = false;                                              // name -> { pos, nrm } | null (no picture)
    PL.shows = () => !!(imp() && imp().plantsShow) || S.shellTool === 'plants';                  // (the Plants tool always shows them)
    PL.picks = new Set(); PL._items = [];                                                      // what is selected in the Plants tool, and what can be picked in the view
    PL.fetchModels = async function () {
        if (pbusy) return; const L = list(), K = PL.kinds(), need = [...new Set(L.filter(p => p.q && K[isProp(p) ? 'prop' : 'plant']).map(p => p.n))].filter(n => !pcache.has(n)); if (!need.length) return;
        pbusy = true;
        try {
            const r = await Model.api('import/prop-models?name=' + encodeURIComponent(Model.safeName(S.project.name)), 'POST', { names: need.slice(0, 60), gta: '' }), ms = r.models || {};
            need.slice(0, 60).forEach(n => { const d = ms[n]; if (!d) { pcache.set(n, null); return; } const f = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); }; pcache.set(n, { pos: f(d.pos), nrm: f(d.nrm), tris: d.tris, shown: d.shown }); });
        } catch (e) { need.forEach(n => pcache.set(n, null)); PL.err = e.message; }
        pbusy = false; if (PL.shows()) IM.rebuild(); M.UI.renderLeft();
    };
    const rotQ = (q, v) => { const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]); return [v[0] + q[3] * tx + (q[1] * tz - q[2] * ty), v[1] + q[3] * ty + (q[2] * tx - q[0] * tz), v[2] + q[3] * tz + (q[0] * ty - q[1] * tx)]; };
    function plantBatch(p, mdl, col, alpha) {
        const e = imp().entity, f = imp().frame, he = (e.heading || 0) * Math.PI / 180, hf = (f.heading || 0) * Math.PI / 180, ce = Math.cos(he), se = Math.sin(he), cf = Math.cos(hf), sf = Math.sin(hf), n = mdl.pos.length / 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
        const q = p.q || [0, 0, 0, 1], sx = (p.sc || [1, 1])[0] || 1, sz = (p.sc || [1, 1])[1] || 1, idx = new Uint16Array(n);
        for (let i = 0; i < n; i++) {
            const v = rotQ(q, [mdl.pos[i * 3] * sx, mdl.pos[i * 3 + 1] * sx, mdl.pos[i * 3 + 2] * sz]), dx = p.x + v[0] - e.x, dy = p.y + v[1] - e.y, mx = dx * ce + dy * se - f.x, my = -dx * se + dy * ce - f.y;
            pos[i * 3] = mx * cf + my * sf; pos[i * 3 + 1] = -mx * sf + my * cf; pos[i * 3 + 2] = p.z + v[2] - e.z - f.z;
            const w = rotQ(q, [mdl.nrm[i * 3], mdl.nrm[i * 3 + 1], mdl.nrm[i * 3 + 2]]), nx = w[0] * ce + w[1] * se, ny = -w[0] * se + w[1] * ce;
            nrm[i * 3] = nx * cf + ny * sf; nrm[i * 3 + 1] = -nx * sf + ny * cf; nrm[i * 3 + 2] = w[2]; idx[i] = i;
        }
        return { level: 0, kind: 'model', group: 'model', tex: '', imgKey: null, flat: col, alpha, noCull: true, clip: true, pos, nrm, uv: new Float32Array(n * 2), idx, glass: false, model: 'plants' };
    }
    // the cards of a model-file bush, as a coloured copy on top of the real ones (the model's coordinates -> the grid's)
    function bushBatch(b, col) {
        const m = IM.models.find(x => x.file === b.file); if (!m) return null; const f = imp().frame, hf = (f.heading || 0) * Math.PI / 180, cf = Math.cos(hf), sf = Math.sin(hf), pos = [], nrm = [];
        const gm = new Map(); m.geoms.forEach(g => gm.set(g.g, g));
        b.tris.forEach(t => { const g = gm.get(t[0]); if (!g) return; const ix = g.idx; for (let k = 0; k < 3; k++) { const i = ix[t[1] * 3 + k] * 3, mx = g.pos[i] - f.x, my = g.pos[i + 1] - f.y; pos.push(mx * cf + my * sf, -mx * sf + my * cf, g.pos[i + 2] - f.z); nrm.push(0, 0, 1); } });
        if (!pos.length) return null; const n = pos.length / 3, idx = new Uint16Array(n); for (let i = 0; i < n; i++) idx[i] = i;
        return { level: 0, kind: 'model', group: 'model', tex: '', imgKey: null, flat: col, alpha: 0.95, noCull: true, clip: true, pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(n * 2), idx, glass: false, model: 'plants' };
    }
    const COL = { off: [1, 0.45, 0.3], stay: [0.5, 0.78, 0.5], prop: [0.72, 0.76, 0.9], bush: [0.45, 0.85, 1], piece: [0.82, 0.7, 1], sel: [1, 0.93, 0.45] };
    PL.modelBatches = function () {
        const I = imp(); PL._items = []; if (!PL.shows() || !I || !I.entity || !IM.loaded) return []; const out = [], items = [], hiding = I.plantsHide !== false, K = PL.kinds();
        const bound = (b) => { let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < b.pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], b.pos[i + a]); mx[a] = Math.max(mx[a], b.pos[i + a]); } const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; return { c, rad: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 + 0.05, base: [c[0], c[1], mn[2]] }; };
        list().forEach(p => {
            const cat = isProp(p) ? 'prop' : 'plant'; if (!p.q || !K[cat]) return; const on = hiding && PL.on(p), id = 'p|' + keyOf(p), sel = PL.picks.has(id);          // (all of them, the whole model)
            const mdl = pcache.get(p.n); if (!mdl) return; const b = plantBatch(p, mdl, sel ? COL.sel : (on ? COL.off : (cat === 'prop' ? COL.prop : COL.stay)), sel ? 0.95 : (on ? 0.92 : 0.5)); out.push(b); items.push(Object.assign({ id, kind: 'prop', cat, ref: p, on, pos: b.pos, idx: b.idx }, bound(b)));
        });
        const model = (kind, cat, arr, color, max) => arr.forEach(b => {
            if (b.gap > max) return; const gone = PL.bushGone(b), id = (kind === 'bush' ? 'b|' : 'd|') + b.key, sel = PL.picks.has(id);
            const bb = bushBatch(b, sel ? COL.sel : (gone ? COL.off : color)); if (!bb) return; if (gone && !sel) bb.alpha = 0.55; out.push(bb); items.push(Object.assign({ id, kind, cat, ref: b, on: gone, pos: bb.pos, idx: bb.idx }, bound(bb)));
        });
        if (K.plant) model('bush', 'plant', PL.bushes(), COL.bush, 1e9);
        if (K.detail) model('piece', 'detail', PL.details(), COL.piece, 1e9);
        PL._items = items;
        if (list().some(p => p.q && !pcache.has(p.n))) PL.fetchModels();
        return out;
    };
    // what the pictures depend on (the remesh redraws them when it changes)
    PL.stateKey = function () { const I = imp(), d = data(); return JSON.stringify([I.plantsShow, S.shellTool === 'plants', [...PL.picks], PL.kinds(), I.plantsHide, I.plantsMin, d && d.set, d && d.list && d.list.length, d && d.rooms, d && d.ver, I.cutters.length, (I.fits || []).length, pcache.size, I.frame, I.entity, (I.mdeletes || []).length, I.deletes.length]); };

    // the bushes of the model files, listed under the plants of the map
    const bushBlock = (root) => {
        const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
        const all = PL.bushes(), B = all.filter(b => b.gap <= 8 || PL.bushGone(b)), dp = IM.detailsPlaced();
        root.append(el('div', { class: 'h' }, 'Model-file bushes'));
        root.append(el('div', { class: 'note' }, 'Bushes drawn into the model files (cyan). Tick one to take it out.'));
        if (dp.total && dp.have < dp.total) root.append(el('div', { class: 'note', style: { color: '#f0c674' } }, 'Detail models not placed yet: look them up in Model files.'));
        if (!B.length) { root.append(el('div', { class: 'note' }, 'None near your rooms.')); return; }
        root.append(el('div', { class: 'note' }, B.length + ' near your rooms, ' + B.filter(PL.bushGone).length + ' taken out'));
        B.slice(0, 30).forEach(b => {
            const gone = PL.bushGone(b);
            root.append(el('div', { class: 'pitem', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px', background: PL.sel === b.key ? 'rgba(255,255,255,0.08)' : '' } },
                el('input', { type: 'checkbox', checked: gone ? true : null, title: 'Take this bush out of the model file', onchange: (e) => PL.setBush(b, e.target.checked) }),
                el('span', { class: 'grow', style: { minWidth: 0 } }, 'Bush', el('span', { class: 'note', title: b.name + ', ' + b.n + ' cards, ' + f2(b.gap, 1) + ' m from a room' }, ' · ' + b.name + ' · ' + f2(b.w, 1) + ' m')),
                el('button', { class: 'btn sm', onclick: () => PL.goBush(b) }, 'Show')));
        });
        if (B.length > 30) root.append(el('div', { class: 'note' }, (B.length - 30) + ' more not listed'));
    };
    PL.panel = function (root) {
        const I = imp(), d = data(), L = list();
        const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
        root.append(el('div', { class: 'note' }, 'Plants and props of the map, whole model. Those in your rooms or in front of your windows are hidden in the game; pick the rest with the Props and plants tool (Y).'));
        const status = el('div', { class: 'note', style: { minHeight: '16px' } });
        const btn = el('button', { class: 'btn sm', onclick: () => PL.lookup(status, btn) }, L.length ? 'Look up again' : 'Look up');
        if (I.target && I.entity) root.append(el('div', { class: 'row wrap' }, btn), status);
        else root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'Set where the model stands (below) first.'));
        if (PL.err) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, PL.err));
        // the models themselves in the view, so you can see what is going to be removed
        root.append(chk('Show the models in the view', () => PL.shows(), v => { Model.edit(Q => { Q.import.plantsShow = v; }); IM.rebuild(); if (v) PL.fetchModels(); M.UI.renderLeft(); }));
        if (PL.shows()) {
            root.append(el('div', { class: 'note' }, el('span', { style: { color: '#ff7350' } }, 'Orange'), ' removed · ', el('span', { style: { color: '#80c780' } }, 'green'), ' stays · ', el('span', { style: { color: '#73d9ff' } }, 'cyan'), ' model bushes' + (L.length && L.some(p => !p.q) ? ' · look up again for the pictures' : '')));
            if (pcache.size === 0 && L.length && !pbusy && L.some(p => p.q)) PL.fetchModels();
        }
        if (!L.length || !I.entity) { bushBlock(root); return; }
        const rows = L.map(p => ({ p, g: PL.gap(p), on: PL.on(p) })).sort((a, b) => (b.on - a.on) || ((a.g == null ? 1e9 : a.g) - (b.g == null ? 1e9 : b.g)));
        const shown = rows.filter(r => r.on || (r.g != null && r.g < 4 && !isProp(r.p)) || (d.set && keyOf(r.p) in d.set));          // (the props are in the Plants tool; here only the ones you removed)
        const stale = PL.stale(), nIn = rows.filter(r => PL.counted(r.p) && r.p.tris > 0).length;
        const nPl = L.filter(p => !isProp(p)).length, nPr = L.length - nPl;
        root.append(el('div', { class: 'note' }, nPl + ' plants, ' + nPr + ' props · ' + (stale ? 'not counted for the current rooms' : nIn + ' in rooms') + ' · ' + rows.filter(r => r.on).length + (I.plantsHide === false ? ' would be hidden' : ' hidden')));
        if (stale) root.append(el('div', { class: 'note', style: { color: '#f0c674' } }, 'Rooms changed: look up again (the export does it too).'));
        root.append(chk('Hide plants in my rooms', () => I.plantsHide !== false, v => { Model.edit(Q => { Q.import.plantsHide = v; }); M.UI.renderLeft(); }));
        root.append(el('div', { class: 'row' }, el('label', null, 'Hide from'), el('input', { type: 'number', class: 'grow', step: '1', min: '1', max: '100', value: PL.minPct(), title: 'A plant is hidden when at least this part of it is inside a room (and at least 3 triangles). The whole plant goes, also the part outside the walls. A bush in front of a window or door is hidden too; a patch wider than 12 m only if you tick it.', onchange: (e) => { const v = Math.min(100, Math.max(1, parseFloat(e.target.value))); Model.edit(Q => { Q.import.plantsMin = isNaN(v) ? 5 : v; }); M.UI.renderLeft(); } }), el('span', { class: 'note' }, '% in a room')));
        root.append(chk('Show rings in the view', () => d.show !== false, v => { Model.edit(Q => { Q.import.plants.show = v; }); }));
        shown.slice(0, 40).forEach(r => {
            const p = r.p, k = keyOf(p), counted = PL.counted(p), wide = f2(p.r * 2, 1) + ' m', where = counted && p.tris > 0 ? Math.round(PL.pct(p)) + '% in a room' : (r.g == null || r.g > 4 ? '' : f2(r.g, 1) + ' m from a room');
            const why = (counted && p.tris > 0 ? p.tris + ' of ' + p.all + ' triangles in a room. ' : '') + (p.why && p.why !== 'name' ? 'A plant by its model (' + p.why + '). ' : '') + (PL.tooBig(p) ? 'Too big to hide by the rule.' : '');
            root.append(el('div', { class: 'pitem', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px', background: PL.sel === k ? 'rgba(255,255,255,0.08)' : '' } },
                el('input', { type: 'checkbox', checked: r.on ? true : null, title: 'Hide this one', onchange: (e) => { const v = e.target.checked; Model.edit(Q => { const pl = Q.import.plants; pl.set = pl.set || {}; if (v === PL.auto(p)) delete pl.set[k]; else pl.set[k] = v; }); M.UI.renderLeft(); } }),
                el('span', { class: 'grow', style: { minWidth: 0 }, title: why }, (p.why && p.why !== 'name' ? 'Bush ' : '') + p.n, el('span', { class: 'note' }, ' · ' + wide + (where ? ' · ' + where : '') + (PL.blocks(p) ? ' · at a window' : ''))),
                el('button', { class: 'btn sm', onclick: () => PL.go(p) }, 'Show')));
        });
        if (shown.length > 40) root.append(el('div', { class: 'note' }, (shown.length - 40) + ' more not listed'));
        if (d.set && Object.keys(d.set).length) root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'Forget your ticks: only the rules decide', onclick: () => { Model.edit(Q => { Q.import.plants.set = {}; }); M.UI.renderLeft(); } }, 'Reset my ticks')));
        bushBlock(root);
    };

    // ---------- the Plants tool: pick the models in the view, one by one, and remove them ----------
    // Click a plant model (or a bush of the model files) to select it, Shift+click adds or takes away, A selects all, Alt+A none, Ctrl+I inverts, X / Delete removes the selection
    // (a plant of the map is hidden by the script, a bush of the model files is taken out of its file), R keeps it again. Esc selects none.
    const toast = (t, k) => Model.bus.emit('toast', { text: t, kind: k });
    function rayTri(o, d, p, a, b, c) {
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x, det = e1x * hx + e1y * hy + e1z * hz; if (Math.abs(det) < 1e-12) return -1;
        const f = 1 / det, sx = o[0] - p[a], sy = o[1] - p[a + 1], sz = o[2] - p[a + 2], u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) return -1;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (d[0] * qx + d[1] * qy + d[2] * qz); if (v < 0 || u + v > 1) return -1;
        const t = f * (e2x * qx + e2y * qy + e2z * qz); return t > 1e-4 ? t : -1;
    }
    PL.pickAt = function (ray) {                       // the nearest model under the ray: { t, it }
        let best = null; const o = ray.o, d = ray.d, dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        PL._items.forEach(it => {
            const ocx = it.c[0] - o[0], ocy = it.c[1] - o[1], ocz = it.c[2] - o[2], t0 = (ocx * d[0] + ocy * d[1] + ocz * d[2]) / dd, px = ocx - d[0] * t0, py = ocy - d[1] * t0, pz = ocz - d[2] * t0;
            if (px * px + py * py + pz * pz > it.rad * it.rad) return;
            const p = it.pos, ix = it.idx; for (let t = 0; t + 2 < ix.length; t += 3) { const tt = rayTri(o, d, p, ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3); if (tt >= 0 && (!best || tt < best.t)) best = { t: tt, it }; }
        });
        return best;
    };
    const itemName = (it) => it.kind === 'prop' ? (it.cat === 'prop' ? 'Prop ' + it.ref.n : ((it.ref.why && it.ref.why !== 'name' ? 'Bush ' : '') + it.ref.n)) : (it.kind === 'piece' ? 'Piece of ' + it.ref.name + ' (' + it.ref.n + ' triangles)' : 'Bush of ' + it.ref.name);
    const refreshView = () => { if (IM.loaded) IM.rebuild(); M.UI.renderLeft(); };
    PL.selectAll = () => { PL.picks = new Set(PL._items.map(i => i.id)); refreshView(); };
    PL.selectNone = () => { PL.picks.clear(); refreshView(); };
    PL.selectInvert = () => { PL.picks = new Set(PL._items.filter(i => !PL.picks.has(i.id)).map(i => i.id)); refreshView(); };
    // remove (true) or keep (false) the selection
    PL.applySel = function (remove) {
        const its = PL._items.filter(it => PL.picks.has(it.id)); if (!its.length) { toast('Nothing selected: click a plant model in the view first.', 'warn'); return false; }
        const props = its.filter(i => i.kind === 'prop').map(i => i.ref), bushes = its.filter(i => i.kind !== 'prop').map(i => i.ref);          // (map props, and bushes / pieces of the model files)
        Model.edit(Q => { const I = Q.import; if (props.length && I.plants) { I.plants.set = I.plants.set || {}; props.forEach(p => { I.plants.set[keyOf(p)] = remove; }); } bushes.forEach(b => bushEdit(I, b, remove)); });
        toast(its.length + ' plant model' + (its.length === 1 ? '' : 's') + (remove ? ' removed' : ' kept') + '.' + (remove && imp().plantsHide === false ? ' (Hiding is switched off, so the map\'s plants are still there until you switch it on.)' : '') + ' Ctrl+Z undoes.', 'ok');
        PL.picks.clear(); refreshView(); return true;
    };
    PL._hover = null; PL._wasShows = false;
    PL.toolChanged = function () { if (S.shellTool !== 'plants') { PL.picks.clear(); PL._hover = null; } const now = PL.shows(); if (now !== PL._wasShows) { PL._wasShows = now; if (IM.loaded) IM.rebuild(); } if (now) PL.fetchModels(); };
    PL.tool = {
        scan(e, ray) { const h = PL.pickAt(ray); PL._hover = h ? h.it : null; },
        down(e) {
            const it = PL._hover;
            if (!it) { if (!e.shiftKey && PL.picks.size) { PL.picks.clear(); refreshView(); } return; }
            if (e.shiftKey) { if (PL.picks.has(it.id)) PL.picks.delete(it.id); else PL.picks.add(it.id); } else PL.picks = new Set([it.id]);
            refreshView();
        },
        draw(R) {
            const ring = (it, col, k) => { const rad = Math.max(0.3, Math.min(it.rad * k, 3.5)); for (let i = 0; i < 20; i++) { const t0 = i / 20 * 2 * Math.PI, t1 = (i + 1) / 20 * 2 * Math.PI; R.ovTopLine([it.base[0] + Math.cos(t0) * rad, it.base[1] + Math.sin(t0) * rad, it.base[2] + 0.03], [it.base[0] + Math.cos(t1) * rad, it.base[1] + Math.sin(t1) * rad, it.base[2] + 0.03], col); } };
            PL._items.forEach(it => { if (PL.picks.has(it.id)) ring(it, [1, 0.93, 0.45, 1], 0.75); });
            const it = PL._hover; if (!it) return PL._items.length ? { text: 'Click a plant model to select it', at: null } : { text: S.tab === 'build' ? 'No plant models yet: look the plants up (panel)' : null, at: null };
            ring(it, [1, 1, 1, 1], 0.75);
            return { text: itemName(it) + ' · ' + (it.on ? 'will be removed' : 'stays') + ' · click to select' + (PL.picks.size ? ' (Shift adds)' : ''), at: [it.c[0], it.c[1], it.c[2] + it.rad + 0.25] };
        },
        key(k) {
            if (k === 'a') { PL.selectAll(); return true; }
            if (k === 'x' || k === 'Delete' || k === 'Backspace') { PL.applySel(true); return true; }
            if (k === 'r') { PL.applySel(false); return true; }
            if (k === 'Escape' && PL.picks.size) { PL.selectNone(); return true; }
            return false;
        },
        keyEv(e, k) {
            if (e.altKey && k === 'a') { PL.selectNone(); return true; }
            if ((e.ctrlKey || e.metaKey) && k === 'i') { PL.selectInvert(); return true; }
            return false;
        }
    };
    // the panel of the Plants tool
    PL.toolPanel = function (root) {
        const I = imp(), L = list(), items = PL._items, sel = items.filter(i => PL.picks.has(i.id));
        const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
        const status = el('div', { class: 'note', style: { minHeight: '16px' } }), lb = el('button', { class: 'btn sm' + (L.length ? '' : ' primary'), onclick: () => PL.lookup(status, lb) }, L.length ? 'Look up again' : 'Look up props and plants');
        if (!I.entity) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'Set where the model stands first (Import tab).'));
        else root.append(el('div', { class: 'row wrap' }, lb), status);
        if (PL.err) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, PL.err));
        if (L.length && L.some(p => !p.q)) root.append(el('div', { class: 'note', style: { color: '#f0c674' } }, 'Old lookup: look up again.'));
        // what to show: vegetation, props, small pieces of the model files
        const K = PL.kinds(), kindChk = (cat, label) => chk(label + ' (' + items.filter(i => i.cat === cat).length + ')', () => !!K[cat], v => { S.propKinds = Object.assign({}, PL.kinds(), { [cat]: v }); PL.picks = new Set([...PL.picks].filter(id => { const it = PL._items.find(q => q.id === id); return !it || it.cat !== cat || v; })); IM.rebuild(); M.UI.renderLeft(); });
        root.append(kindChk('plant', 'Plants'), kindChk('prop', 'Props'), kindChk('detail', 'Model pieces (vents, pipes...)'));
        root.append(el('div', { class: 'note' }, items.length + ' shown · ' + items.filter(i => i.on).length + ' removed · ' + sel.length + ' selected'));
        root.append(el('div', { class: 'note' }, el('span', { style: { color: '#ff7350' } }, 'orange'), ' removed · ', el('span', { style: { color: '#80c780' } }, 'green'), ' plant · ', el('span', { style: { color: '#b8c2e6' } }, 'grey'), ' prop · ', el('span', { style: { color: '#73d9ff' } }, 'cyan'), ' model bush · ', el('span', { style: { color: '#d1b3ff' } }, 'lilac'), ' piece · ', el('span', { style: { color: '#ffee73' } }, 'yellow'), ' selected'));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'A', onclick: () => PL.selectAll() }, 'All'), el('button', { class: 'btn sm', title: 'Alt+A', onclick: () => PL.selectNone() }, 'None'), el('button', { class: 'btn sm', title: 'Ctrl+I', onclick: () => PL.selectInvert() }, 'Invert')));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm danger', disabled: sel.length ? null : true, onclick: () => PL.applySel(true) }, 'Remove selected ', el('kbd', null, 'X')), el('button', { class: 'btn sm', disabled: sel.length ? null : true, title: 'Take the selected ones off the removal list', onclick: () => PL.applySel(false) }, 'Keep selected ', el('kbd', null, 'R'))));
        if (I.plantsHide === false) root.append(el('div', { class: 'note', style: { color: '#f0c674' } }, 'Hiding is switched off (Import tab, Props and plants).'));
        sel.slice(0, 12).forEach(it => root.append(el('div', { class: 'pitem', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px' } }, el('span', { class: 'grow', style: { minWidth: 0 } }, itemName(it), el('span', { class: 'note' }, ' · ' + (it.on ? 'removed' : 'stays'))), el('button', { class: 'btn sm', onclick: () => { PL.picks.delete(it.id); refreshView(); } }, 'x'))));
    };

    // rings and stems in the view (grid coordinates)
    PL.draw = function (R) {
        const d = data(); if (d && d.show === false) return;
        // the bushes of the model files (cyan; grey when taken out)
        PL.bushes().forEach(b => {
            if (b.gap > 8 && PL.sel !== b.key) return; const gone = PL.bushGone(b), g = mToGrid(b.c), col = PL.sel === b.key ? [1, 1, 1, 1] : (gone ? [0.6, 0.6, 0.6, 0.4] : [0.45, 0.85, 1, 0.95]), rad = Math.max(0.4, Math.min(b.w / 2, 2.5));
            for (let i = 0; i < 16; i++) { const t0 = i / 16 * 2 * Math.PI, t1 = (i + 1) / 16 * 2 * Math.PI; R.ovTopLine([g[0] + Math.cos(t0) * rad, g[1] + Math.sin(t0) * rad, g[2] + 0.03], [g[0] + Math.cos(t1) * rad, g[1] + Math.sin(t1) * rad, g[2] + 0.03], col); }
            R.ovTopLine([g[0], g[1], g[2]], [g[0], g[1], g[2] + Math.max(0.6, Math.min(b.h, 3))], col);
        });
        if (!d || !d.list || !d.list.length || !imp().entity) return;
        const hiding = imp().plantsHide !== false;
        d.list.forEach(p => {
            const sel = keyOf(p) === PL.sel, on = hiding && PL.on(p), gap = PL.gap(p);
            if (!sel && !on && (gap === null || gap > 3)) return;                           // the ones far from the rooms stay out of the picture
            const g = toGrid(p, true), col = sel ? [1, 1, 1, 1] : (on ? [1, 0.5, 0.32, 0.95] : [0.62, 0.8, 0.62, 0.55]);
            const ring = (rad, a) => { for (let i = 0; i < 16; i++) { const t0 = i / 16 * 2 * Math.PI, t1 = (i + 1) / 16 * 2 * Math.PI; R.ovTopLine([g[0] + Math.cos(t0) * rad, g[1] + Math.sin(t0) * rad, g[2] + 0.03], [g[0] + Math.cos(t1) * rad, g[1] + Math.sin(t1) * rad, g[2] + 0.03], [col[0], col[1], col[2], col[3] * a]); } };
            ring(Math.min(p.r, 4), 1);
            R.ovTopLine([g[0], g[1], g[2]], [g[0], g[1], g[2] + Math.min(Math.max(p.h, 0.6), 3)], col);
        });
    };
})(window.MLO);
