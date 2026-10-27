// The guided build of an interior in an imported model: every step in order, one after the other. The steps the program can do it does itself (one at a
// time with "Do it", or all of them with "Do every step it can"); at a step that needs you it stops, says exactly what to do and opens the tool, and goes on
// by itself once you have done it. Also: a project made from a building of the game (picked on the Server and world page, or found by its name), with
// everything it needs pulled from the game files.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus;
    const G = M.Guide = { busy: false, cur: null, notes: {}, waiting: null, tried: new Set() };
    const IM = () => M.ImportModel, UI2 = () => M.ImportUI, imp = () => S.project.import;
    const enc = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000, s05 = (v) => r3(Math.round(v / 0.05) * 0.05);
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    const refresh = () => { if (M.UI && M.UI.renderLeft) M.UI.renderLeft(); };
    const stemOf = (f) => String(f || '').replace(/\.(ydr|yft)$/i, '').toLowerCase();

    // ---------------- pulling a building from the game ----------------
    // spec: { name (the model), ymap, x, y } — the model, its textures, the map file that places it, its detail models, collision and occluders go into the
    // project's files; the target, where it stands and where it came from are set
    G.pull = async function (spec, status) {
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status && status) status(s.status); } catch (e) { } }, 600);
        let r; try { r = await Model.api('game/pull?name=' + enc(), 'POST', { name: spec.name, ymap: spec.ymap || '', x: spec.x, y: spec.y, gta: '' }); } finally { clearInterval(poll); }
        if (!r || r.ok === false) throw new Error((r && r.error) || 'The pull failed.');
        Model.edit(P => {
            const I = P.import; I.target = r.target; I.game = { name: stemOf(r.target), ymap: (r.entity && r.entity.ymap) || spec.ymap || '', x: spec.x != null ? spec.x : (r.entity ? r.entity.x : null), y: spec.y != null ? spec.y : (r.entity ? r.entity.y : null) };
            if (r.entity) { const e = r.entity; I.entity = { x: r3(e.x), y: r3(e.y), z: r3(e.z), heading: Math.round(e.heading * 1000) / 1000, ymap: e.ymap || '', source: 'game', tilted: !!e.tilted, scale: e.scale || 1 }; }
        });
        G.lastPull = r;
        if (UI2() && UI2().afterFilesChanged) await UI2().afterFilesChanged(); else await IM().load();
        if (r.entity) IM().autoPlaces();
        return r;
    };
    // the page was opened from the building picker (index.html?gamepull=...): a new project, the pull, then the guided build
    G.fromGame = async function (spec) {
        await Model.createProject(spec.project || spec.name, 'import');
        S.tab = 'build'; if (M.App) M.App.setTab('build');
        G.pulling = 'Pulling ' + spec.name + ' and what it needs from the game...'; refresh();
        pullAndGo(spec);                                                       // (the page keeps drawing while the files come)
    };
    async function pullAndGo(spec) {
        try {
            const r = await G.pull(spec, (s) => { G.pulling = s; const e = document.getElementById('gpull'); if (e) e.textContent = s; });
            G.pulling = null; G.report = r; toast('Pulled ' + (r.added || []).length + ' file(s) from the game.', 'ok');
        } catch (e) { G.pulling = null; G.notes.model = e.message; toast('Could not pull ' + spec.name + ': ' + e.message, 'err'); refresh(); return; }
        refresh(); await wait(300); G.autopilot();
    };

    // ---------------- what the program can do itself ----------------
    const nearestTo = (list, at) => { if (!at || at.x == null) return list[0]; let b = list[0], bd = 1e18; list.forEach(e => { const d = Math.hypot(e.x - at.x, e.y - at.y); if (d < bd) { bd = d; b = e; } }); return b; };
    // where the model stands: an imported map file that places it, else the game's map files (the placement nearest to where it was picked)
    async function autoPlace() {
        const I = imp(), ents = IM().entities || [];
        if (ents.length) { UI2().useEntity(nearestTo(ents, I.game), 'file'); return ents.length > 1 ? 'Your map files place it ' + ents.length + ' times: the one nearest to the spot is used (change it in the Import tab).' : 'Placed as your map file places it.'; }
        const r = await Model.api('import/game-entity?name=' + enc(), 'POST', { target: I.target, gta: '' }); const list = r.entities || [];
        if (!list.length) throw new Error('The game\'s map files do not place ' + I.target + ': set where it stands yourself (Import tab).');
        UI2().useEntity(nearestTo(list, I.game), 'game');
        return list.length > 1 ? 'The game places it ' + list.length + ' times: ' + (I.game ? 'the one you picked' : 'the first one') + ' is used (change it in the Import tab).' : 'Placed where the game places it.';
    }
    // the building out of the block: the biggest part that is tall enough to have rooms (with what is attached to it)
    function autoBuilding() {
        const C = IM().comp; if (!C || !C.comps || C.comps.length <= 1) return 'The model is one building.';
        let best = -1, ba = -1;
        C.comps.forEach((c, i) => { const h = c.mx[2] - c.mn[2], a = (c.mx[0] - c.mn[0]) * (c.mx[1] - c.mn[1]); if (h >= 2.4 && a > ba) { ba = a; best = i; } });
        if (best < 0) C.comps.forEach((c, i) => { if (c.tris > ba) { ba = c.tris; best = i; } });
        const seed = C.comps[best].seed; IM().selectBuilding(seed[0], seed[1], false); IM().rebuildMembers(); IM().centerOnBuilding(); IM().rebuild();
        return 'Picked the biggest building of the block (Select building, B, picks another).';
    }
    // the grid: squared to the building's walls, on its floor, in its middle
    function autoGrid() {
        if (!IM().selComps && IM().comp && IM().comp.comps) {
            const ids = IM().comp.comps.map((c, i) => i), fit = IM().fitFrame(ids);
            Model.edit(P => { P.import.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; });
        } else IM().centerOnBuilding();
        IM().rebuild(); return 'The grid is squared to the walls and sits on the floor (Frame, O, changes it).';
    }
    // the building's collision files from the game (the ones that reach it)
    async function autoCollision() {
        const I = imp(), r = await Model.api('import/game-collision?name=' + enc(), 'POST', { target: I.target, gta: '', entity: I.entity || null });
        const names = (r.files || []).filter(f => f.overlaps !== false).map(f => f.name).filter(n => !(IM().files || []).some(f => f.name.toLowerCase() === n.toLowerCase()));
        if (!names.length) { Model.edit(P => { P.import.noGameCol = true; }); return 'The game has no collision file for it: the walls of your interior get collision of their own.'; }
        await Model.api('import/game-add?name=' + enc(), 'POST', { names, gta: '' }); await UI2().afterFilesChanged();
        return 'Added ' + names.length + ' collision file(s).';
    }
    // the box of the picked building (or of the whole model) on the grid
    function buildingBox() {
        const C = IM().comp; if (!C || !C.comps) return null; const ids = IM().selComps ? [...IM().selComps] : C.comps.map((c, i) => i);
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        ids.forEach(ci => { const c = C.comps[ci]; for (let k = 0; k < 8; k++) { const p = IM().toShell(k & 1 ? c.mx[0] : c.mn[0], k & 2 ? c.mx[1] : c.mn[1], k & 4 ? c.mx[2] : c.mn[2]); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } } });
        return { mn, mx };
    }
    G.buildingBox = buildingBox;
    // a first room: the building's ground-floor walls (each side the plane with the most wall between 0.3 and 2.2 m), fitted to them, the ceiling at their top
    function autoRooms() {
        const box = buildingBox(), faces = IM().wallFaces(); if (!box || !faces.length) throw new Error('The model has no walls to put a room in: draw the rooms yourself (Add room, 1).');
        const cx = (box.mn[0] + box.mx[0]) / 2, cy = (box.mn[1] + box.mx[1]) / 2, side = [new Map(), new Map(), new Map(), new Map()];          // -x, -y, +x, +y facing
        faces.forEach(f => {
            if (f.c[2] < 0.3 || f.c[2] > 2.2 || f.c[0] < box.mn[0] - 0.5 || f.c[0] > box.mx[0] + 0.5 || f.c[1] < box.mn[1] - 0.5 || f.c[1] > box.mx[1] + 0.5) return;
            const n = f.n; let s = -1, pos = 0;
            if (n[0] < -0.95 && f.c[0] < cx) { s = 0; pos = f.c[0]; } else if (n[1] < -0.95 && f.c[1] < cy) { s = 1; pos = f.c[1]; } else if (n[0] > 0.95 && f.c[0] > cx) { s = 2; pos = f.c[0]; } else if (n[1] > 0.95 && f.c[1] > cy) { s = 3; pos = f.c[1]; }
            if (s < 0) return; const k = Math.round(pos * 20); const b = side[s].get(k) || { w: 0, p: 0 }; b.w += f.area; b.p += pos * f.area; side[s].set(k, b);
        });
        const plane = (s, def) => { let best = null; side[s].forEach(b => { if (!best || b.w > best.w) best = b; }); return best && best.w > 0.5 ? best.p / best.w : def; };
        const r = [s05(plane(0, box.mn[0])), s05(plane(1, box.mn[1])), s05(plane(2, box.mx[0])), s05(plane(3, box.mx[1]))];
        const w = r[2] - r[0], d = r[3] - r[1];
        if (w < 1.5 || d < 1.5 || w > 120 || d > 120) throw new Error('No room shape could be found in the walls (' + w.toFixed(1) + ' x ' + d.toFixed(1) + ' m): draw the rooms yourself (Add room, 1).');
        Model.edit(P => { P.shell.ops.push({ op: 'add', r }); });
        IM().fitRooms(0.3, true);
        const h = IM().wallTop(); if (h != null) Model.edit(P => { P.settings.ceilH = Math.min(6, Math.max(2.2, Math.round(h * 100) / 100)); });
        return 'One room fills the building (' + w.toFixed(1) + ' x ' + d.toFixed(1) + ' m' + (h != null ? ', ceiling ' + Math.min(6, Math.max(2.2, h)).toFixed(2) + ' m' : '') + '). Split it with Partition (3) or draw more rooms (1) if you want.';
    }
    G.autoRooms = autoRooms;
    // doors and windows: the faces of the model whose texture says door or window, upright, of a door's or window's size, on a wall of a room
    const DOOR = /door|entrance|shutter/i, WIN = /window|glass|(^|_)win(_|\d|$)|pane/i, NOT = /frame|sill|trim|ledge|grill|grate|bars?($|_)|surround|lintel/i;
    function autoOpenings() {
        const m = IM().targetModel(), I = imp(); if (!m) throw new Error('No model.');
        const rooms = S.project.shell.ops.filter(o => o.op === 'add').map(o => o.r); if (!rooms.length) throw new Error('Draw a room first.');
        const H = S.project.settings.ceilH || 2.45, dels = new Set(I.deletes.map(d => d[0] + ':' + d[1])), onWall = (x, y) => rooms.some(r => x > r[0] - 0.6 && x < r[2] + 0.6 && y > r[1] - 0.6 && y < r[3] + 0.6 && !(x > r[0] + 0.6 && x < r[2] - 0.6 && y > r[1] + 0.6 && y < r[3] - 0.6));
        const found = { door: 0, window: 0 }, ks = [];
        m.geoms.forEach(g => {
            const name = (g.texName || g.tex || '') + ' ' + (g.shader || ''); if (NOT.test(g.texName || g.tex || '')) return;
            const type = DOOR.test(g.texName || g.tex || '') ? 'door' : (WIN.test(name) ? 'window' : null); if (!type) return;
            const used = new Set();
            for (let t = 0; t * 3 < g.idx.length && ks.length < 40; t++) {
                if (used.has(t) || dels.has(g.g + ':' + t)) continue;
                const tris = IM().flatPatch(g.g, t).filter(x => !dels.has(g.g + ':' + x)); tris.forEach(x => used.add(x)); if (!tris.length) continue;
                const r = IM().faceRect({ g: g.g, tris }); if (!r || !onWall(r.cx, r.cy)) continue;
                const ok = type === 'door' ? (r.w >= 0.5 && r.w <= 3.6 && r.h >= 1.6 && r.h <= 3.6 && r.zb <= 0.5) : (r.w >= 0.25 && r.w <= 6 && r.h >= 0.25 && r.h <= 3.6 && r.zb > -0.3 && r.zb < H);
                if (!ok) continue;
                const k = Object.assign({ id: Math.random().toString(36).slice(2, 10), type, mesh: false, face: { g: g.g, tris: tris.slice(), added: [] } }, r);
                if (type === 'door' && IM().doorModel() && I.placeDoors !== false) { k.leaf = true; k.flip = false; k.lo = 0; }
                k.dd = IM().frameDepth(k, new Set(tris.map(x => g.g + ':' + x))); ks.push(k); found[type]++;
            }
        });
        if (!ks.length) throw new Error('No door or window was found on the model by its textures: cut one yourself with the Door (4) or Window (5) tool by clicking its faces on the model.');
        Model.edit(P => {
            const have = new Set(P.import.deletes.map(d => d[0] + ':' + d[1]));
            ks.forEach(k => { k.face.tris.forEach(tr => { if (!have.has(k.face.g + ':' + tr)) { P.import.deletes.push([k.face.g, tr]); have.add(k.face.g + ':' + tr); k.face.added.push(tr); } }); P.import.cutters.push(k); });
        });
        return 'Cut out ' + found.door + ' door(s) and ' + found.window + ' window(s) found by their textures. Check them in the view; Ctrl+Z takes them back, the Door and Window tools add more.';
    }
    G.autoOpenings = autoOpenings;
    function autoFit() { const n = IM().fitRooms(0.25, true).length; return n ? n + ' room edge(s) moved onto the building\'s walls.' : 'The room edges already lie on the walls.'; }
    // lights: one per 4.5 m of room each way, in the middle of each part
    function autoLights() {
        const L = [];
        S.project.shell.ops.filter(o => o.op === 'add').forEach(o => { const r = o.r, nx = Math.max(1, Math.round((r[2] - r[0]) / 4.5)), ny = Math.max(1, Math.round((r[3] - r[1]) / 4.5)); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) L.push({ x: s05(r[0] + (r[2] - r[0]) * (i + 0.5) / nx), y: s05(r[1] + (r[3] - r[1]) * (j + 0.5) / ny) }); });
        if (!L.length) throw new Error('Draw a room first.');
        Model.edit(P => { P.shell.lights = (P.shell.lights || []).concat(L); });
        return L.length + ' ceiling light(s) placed (Paint tab > Lights sets their colour and strength; the Light tool, L, moves them).';
    }
    async function autoPlants() { const ok = await M.Plants.ensureFresh(); if (!ok) throw new Error(M.Plants.err || 'The map\'s plants could not be looked up.'); const n = M.Plants.hideList().length; return n ? n + ' plant(s) or prop(s) of the map stand in the way and will be hidden.' : 'No plant of the map stands in the rooms.'; }
    async function autoWalk() { await M.Walk.run(); const res = M.Walk.result; if (!res) throw new Error('The walk check did not run.'); const bad = (res.problems || []).filter(p => p.sev === 'bad').length; return bad ? bad + ' problem(s) found: see the Walk check tool (U).' : 'A player can walk through the rooms.'; }
    function colClear() { Model.edit(P => { P.import.clearCollision = true; }); return 'The building\'s collision is cleared out of the rooms.'; }

    // ---------------- the steps, in order ----------------
    G.steps = function () {
        const P = S.project, I = P.import, base = {}; if (!UI2() || P.kind !== 'import') return [];
        UI2().steps().forEach(s => { base[s.id] = s; });
        const out = [], add = (o) => out.push(Object.assign({ need: 'must', done: false }, o));
        const multi = !!(IM().comp && IM().comp.comps && IM().comp.comps.length > 1), hasModel = !!IM().targetModel(), hasRooms = P.shell.ops.some(o => o.op === 'add');
        add({ id: 'model', title: 'The building\'s files', done: hasModel, auto: I.game && I.game.name ? () => G.pull(I.game).then(r => 'Pulled ' + (r.added || []).length + ' file(s) from the game.') : null,
            how: I.game ? 'Pull the building again from the game.' : 'Pick a building in the game (button below), or import its files in the Import tab.', go: { tab: 'import' }, pick: !I.game });
        add({ id: 'place', title: 'Where it stands in the game', done: !!I.entity, auto: hasModel ? autoPlace : null, how: 'Import tab, Placement: choose where the game places the model.', go: { tab: 'import' } });
        if (multi) add({ id: 'building', title: 'The building, out of the block', need: 'should', done: !!IM().selComps, auto: autoBuilding, how: 'Select building (B): click the building you want.', go: { tool: 'building' } });
        add({ id: 'grid', title: 'The grid on the building\'s floor', done: base.grid ? base.grid.done : true, auto: hasModel ? autoGrid : null, how: 'Frame (O): click the floor, then a wall.', go: { tool: 'frame' } });
        if (I.entity) add({ id: 'col', title: 'The building\'s collision', need: 'should', done: (IM().files || []).some(f => f.kind === 'collision') || !!I.noGameCol, auto: autoCollision, how: 'Import tab: add the building\'s .ybn files, or look them up in the game.', go: { tab: 'import' } });
        add({ id: 'rooms', title: 'The rooms', done: hasRooms, auto: hasModel ? autoRooms : null, how: 'Add room (1): drag a rectangle inside the building for each room.', go: { tool: 'room' } });
        if (base.fit) add({ id: 'fit', title: 'Room edges on the building\'s walls', need: 'should', done: base.fit.done, auto: autoFit, how: base.fit.why, go: { tool: 'room' } });
        add({ id: 'open', title: 'Doors and windows', done: base.open ? base.open.done : false, auto: hasRooms ? autoOpenings : null, how: 'Door (4) or Window (5): click the faces of a door or window on the model; they are cut out and filled.', go: { tool: 'door' } });
        if (base.portal) add({ id: 'portal', title: 'The inside seen from outside', need: 'should', done: base.portal.done, auto: null, how: base.portal.why + ' Move a room edge onto that wall, or cut an opening where a room meets the outside wall.', go: { tool: 'door' } });
        if (base.colclear) add({ id: 'colclear', title: 'The building\'s collision out of the rooms', need: 'should', done: base.colclear.done, auto: colClear, how: base.colclear.why, go: { tool: 'room' } });
        add({ id: 'lights', title: 'Lights', need: 'should', done: (P.shell.lights || []).length > 0, auto: hasRooms ? autoLights : null, how: 'Light (L): click the floor where a ceiling light goes.', go: { tool: 'light' } });
        if (base.plants) add({ id: 'plants', title: 'Plants of the map in the way', need: 'opt', done: base.plants.done, auto: autoPlants, how: base.plants.why, go: { tool: 'plants' } });
        if (base.walk) add({ id: 'walk', title: 'Walk check', need: 'opt', done: base.walk.done, auto: autoWalk, how: base.walk.why, go: { tool: 'walk' } });
        const N = Model.exportNames(P); add({ id: 'names', title: 'Names of the files', need: 'should', done: !!(Model.getDeveloper() || (N.auto === false && N.prefix)), auto: null, how: 'Your developer name goes at the start of every file name (now: ' + N.prefix + '_...).', dev: true });
        add({ id: 'export', title: 'Export', need: 'final', done: false, auto: null, how: 'Write the resource folder for your server.', go: { tab: 'export' } });
        return out;
    };
    const open = (list) => list.filter(s => !s.done && s.need !== 'final');
    G.next = function () { const L = G.steps(); return open(L).find(s => s.need !== 'opt') || null; };

    // one step, done by the program
    G.doStep = async function (s) {
        if (!s || !s.auto || G.running) return false; G.running = s.id; G.cur = s.id; refresh(); let ok = true;
        try { const msg = await s.auto(); G.notes[s.id] = typeof msg === 'string' ? msg : ''; }
        catch (e) { G.notes[s.id] = e.message; ok = false; }
        await settle(); G.running = null; refresh(); return ok;
    };
    // after a change: the cut of the model, the collision and the meshes catch up
    async function settle() { for (let i = 0; i < 40; i++) { await wait(120); if (!IM().busy && !IM().loading) break; } if (M.App && M.App.remesh) M.App.remesh(); }
    // every step it can, in order; it stops at a step that needs you and goes on by itself when that step is done
    G.autopilot = async function () {
        if (G.busy) return; G.busy = true; G.stop = false; G.waiting = null; G.tried = new Set(); refresh();
        try {
            for (let guard = 0; guard < 40 && !G.stop; guard++) {
                const L = G.steps(), s = open(L).find(x => !G.tried.has(x.id)); if (!s) break;
                if (!s.auto) { if (s.need === 'must') { G.waiting = s.id; break; } G.tried.add(s.id); continue; }          // (a step only you can do: wait for you; an optional one: past it)
                G.tried.add(s.id); const ok = await G.doStep(s);
                const again = G.steps().find(x => x.id === s.id);
                if ((!ok || (again && !again.done)) && s.need === 'must') { G.waiting = s.id; break; }
            }
        } finally { G.busy = false; G.cur = null; refresh(); }
        if (!G.waiting && !G.stop) { const nx = G.next(); toast(nx ? 'Done what it can. Next: ' + nx.title + '.' : 'Every step is done: ready to export.', nx ? 'warn' : 'ok'); }
    };
    // a step you did yourself: the guided build goes on
    let resumeT = null;
    bus.on('change', () => {
        if (!G.waiting || G.busy) return; clearTimeout(resumeT);
        resumeT = setTimeout(() => { const s = G.steps().find(x => x.id === G.waiting); if (s && s.done) { G.waiting = null; G.autopilot(); } }, 700);
    });
    bus.on('project', () => { G.waiting = null; G.stop = true; G.notes = {}; G.report = null; });

    // ---------------- the panel at the top of the Import and Build tabs ----------------
    const goStep = (s) => { if (!s.go) return; if (s.go.tab) M.App.setTab(s.go.tab); else M.App.setTool(s.go.tool); };
    function mark(s) { return s.done ? ['✓', '#9fd9a8'] : (s.need === 'must' ? ['✗', '#f0a4a3'] : (s.need === 'should' ? ['!', '#f0d28a'] : (s.need === 'final' ? ['→', '#8fb3ff'] : ['○', '#8fa0bd']))); }
    function devInput() {
        const i = el('input', { class: 'txt grow', placeholder: 'your name or team, e.g. Bushcowboy', value: Model.getDeveloper() || '', maxlength: 40 });
        return el('div', { class: 'row' }, i, el('button', { class: 'btn sm', onclick: async () => { await Model.setDeveloper(i.value.trim()); refresh(); } }, 'Save'));
    }
    G.render = function (root) {
        if (S.project.kind !== 'import') return;
        const L = G.steps(), need = L.filter(s => s.need === 'must' || s.need === 'should'), done = need.filter(s => s.done).length, nx = G.waiting ? L.find(s => s.id === G.waiting) : G.next();
        const card = el('div', { class: 'route guide' });
        card.append(el('div', { class: 'rtop' }, el('span', { class: 'rt' }, 'Guided build'), el('span', { class: 'rn' }, done + ' of ' + need.length + ' done')), el('div', { class: 'rbar' }, el('i', { style: { width: (need.length ? Math.round(done / need.length * 100) : 0) + '%' } })));
        if (G.pulling) { card.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note', id: 'gpull' }, G.pulling)); root.append(card); return; }
        if (G.busy) {
            const s = L.find(x => x.id === G.cur);
            card.append(el('div', { class: 'rnext' }, el('div', { class: 'grow' }, el('div', { style: { fontWeight: 600 } }, s ? 'Doing: ' + s.title + '...' : 'Working...'), el('div', { class: 'bar' }, el('div'))), el('button', { class: 'btn sm', onclick: () => { G.stop = true; } }, 'Stop')));
        } else if (nx) {
            const note = G.notes[nx.id];
            card.append(el('div', { class: 'rnext' }, el('div', { class: 'grow' }, el('div', { style: { fontWeight: 600 } }, (G.waiting ? 'Your turn: ' : 'Next: ') + nx.title),
                note ? el('div', { class: 'note', style: { margin: '2px 0 0', color: '#f0d28a' } }, note) : null, el('div', { class: 'note', style: { margin: '2px 0 0' } }, nx.how))));
            const row = el('div', { class: 'row wrap', style: { marginTop: '6px' } });
            if (nx.auto) row.append(el('button', { class: 'btn sm primary', onclick: () => G.doStep(nx) }, 'Do it for me'));
            if (nx.go) row.append(el('button', { class: 'btn sm' + (nx.auto ? '' : ' primary'), onclick: () => goStep(nx) }, nx.go.tab ? 'Open the ' + nx.go.tab.charAt(0).toUpperCase() + nx.go.tab.slice(1) + ' tab' : 'Show me the tool'));
            if (nx.pick) row.append(el('button', { class: 'btn sm primary', onclick: () => { try { sessionStorage.setItem('mlo.noauto', '1'); } catch (e) { } location.href = 'world.html?pick=1'; } }, 'Pick a building in the game'));
            card.append(row);
            if (nx.dev) card.append(devInput());
            card.append(el('button', { class: 'btn primary', style: { width: '100%', marginTop: '6px' }, title: 'Every step the program can do, one after the other; it stops where it needs you and goes on when you have done it', onclick: () => G.autopilot() }, G.waiting ? 'Go on with the rest' : 'Do every step it can'));
        } else {
            card.append(el('div', { class: 'rnext' }, el('div', { class: 'grow note', style: { margin: 0 } }, 'Every step that is needed is done.'), el('button', { class: 'btn sm primary', onclick: () => M.App.setTab('export') }, 'Export')));
        }
        // what was pulled from the game
        if (G.report && !G.busy) {
            const R = G.report, add = R.added || [];
            card.append(el('details', { class: 'pgrp', style: { marginTop: '6px' } }, el('summary', null, el('span', { class: 'grow' }, 'Pulled from the game'), el('small', { class: 'note', style: { margin: 0 } }, add.length + ' files')),
                el('div', { class: 'pbody' }, ...add.map(a => el('div', { class: 'note', style: { margin: '1px 0' } }, el('b', null, a.name), ' · ' + a.why)), ...(R.warnings || []).map(w => el('div', { class: 'note', style: { color: '#f0d28a', margin: '1px 0' } }, w)))));
        }
        root.append(card);
        // every step: done, open, what the program did
        const list = el('div', { class: 'pbody' });
        L.forEach(s => {
            const m = mark(s), note = G.notes[s.id];
            list.append(el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '6px', margin: '3px 0' } }, el('span', { style: { color: m[1], width: '12px', flex: 'none' } }, G.cur === s.id ? '…' : m[0]),
                el('div', { class: 'grow' }, el('div', { style: { color: m[1] } }, s.title + (s.need === 'opt' ? ' (optional)' : '')), note ? el('div', { class: 'note', style: { margin: '1px 0 0' } }, note) : (!s.done && s.need !== 'final' ? el('div', { class: 'note', style: { margin: '1px 0 0' } }, s.how) : null)),
                !s.done && s.auto && !G.busy ? el('button', { class: 'btn sm', onclick: () => G.doStep(s) }, 'Do it') : null, !s.done && s.go && !G.busy ? el('button', { class: 'btn sm', onclick: () => goStep(s) }, 'Go') : null));
        });
        const det = el('details', { class: 'pgrp' }); if (S.guideOpen) det.open = true; det.addEventListener('toggle', () => { S.guideOpen = det.open; });
        det.append(el('summary', null, el('span', { class: 'grow' }, 'All steps'), el('small', { class: 'note', style: { margin: 0 } }, open(L).length ? open(L).length + ' open' : 'all done')), list);
        root.append(det);
    };

    // ---------------- the Import tab: a building from the game ----------------
    G.importBlock = function (root) {
        const I = imp();
        const box = el('div', { class: 'route', style: { padding: '8px 10px' } }, el('div', { class: 'rt', style: { marginBottom: '4px' } }, 'From the game'));
        if (I.game && I.game.name) box.append(el('div', { class: 'note' }, 'This project is ' + I.game.name + (I.game.ymap ? ' (' + I.game.ymap + ')' : '') + ' from the game.'), el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => pullNow(I.game) }, 'Pull it again (what is missing)')));
        else box.append(el('div', { class: 'note' }, 'Type the building\'s model name (CodeWalker shows it when you click the building) and the program pulls its model, textures, map file, detail models, collision and occluders from your game. Or pick it in 3D.'));
        const q = el('input', { class: 'txt grow', placeholder: 'dt1_02_build1', spellcheck: 'false', value: G.findQ || '', onkeydown: (e) => { if (e.key === 'Enter') find(q.value); } });
        box.append(el('div', { class: 'row' }, q, el('button', { class: 'btn sm', disabled: G.finding ? true : null, onclick: () => find(q.value) }, 'Find'), el('button', { class: 'btn sm', title: 'Find the building on the map and click it in 3D', onclick: () => { try { sessionStorage.setItem('mlo.noauto', '1'); } catch (e) { } location.href = 'world.html?pick=1'; } }, 'Pick in 3D')));
        if (G.finding) box.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note', id: 'gfind' }, G.findSt || 'Looking in the game\'s map files...'));
        if (G.findErr) box.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, G.findErr));
        (G.found || []).forEach(p => box.append(el('div', { class: 'row' }, el('span', { class: 'grow note', style: { margin: 0 } }, p.ymap + ' · ' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1)), el('button', { class: 'btn sm primary', onclick: () => pullNow({ name: G.foundName, ymap: p.ymap, x: p.x, y: p.y }) }, 'Pull this one'))));
        if (G.pulling) box.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note', id: 'gpull' }, G.pulling));
        root.append(box);
    };
    async function find(name) {
        name = stemOf(name.trim()); if (!name) return; G.findQ = name; G.finding = true; G.findErr = ''; G.found = null; refresh();
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) { G.findSt = s.status; const e = document.getElementById('gfind'); if (e) e.textContent = s.status; } } catch (e) { } }, 600);
        try { const r = await Model.api('game/find', 'POST', { name, gta: '' }); if (r.ok === false) throw new Error(r.error); G.found = r.places || []; G.foundName = name; if (!G.found.length) G.findErr = 'The game\'s map files do not place a model called ' + name + '.'; }
        catch (e) { G.findErr = e.message; }
        clearInterval(poll); G.finding = false; refresh();
    }
    async function pullNow(spec) {
        G.pulling = 'Pulling ' + spec.name + '...'; refresh();
        try { const r = await G.pull(spec, (s) => { G.pulling = s; const e = document.getElementById('gpull'); if (e) e.textContent = s; }); G.report = r; G.found = null; toast('Pulled ' + (r.added || []).length + ' file(s) from the game' + ((r.had || []).length ? ' (' + r.had.length + ' were there already)' : '') + '.', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
        G.pulling = null; refresh();
    }
})(window.MLO);
