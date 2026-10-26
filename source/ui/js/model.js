// Project state, undo/redo, edit operations and saving through the local host.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TOKEN = (document.querySelector('meta[name="mlo-token"]') || {}).content || '';

    // ---- tiny event bus ----
    const handlers = {};
    const bus = {
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
        emit(ev, a) { (handlers[ev] || []).forEach(f => { try { f(a); } catch (e) { M.Errors.report('editor', e); } }); }
    };

    async function api(path, method, body) {
        const r = await fetch('/api/' + path, { method: method || 'GET', headers: { 'X-Mlo-Token': TOKEN, 'Content-Type': 'application/json' }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
        if (!r.ok) throw new Error((j && j.error) || ('request failed ' + r.status));
        return j;
    }

    // raw bytes (dropped model files)
    async function apiRaw(path, bytes) {
        const r = await fetch('/api/' + path, { method: 'POST', headers: { 'X-Mlo-Token': TOKEN, 'Content-Type': 'application/octet-stream' }, body: bytes });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
        if (!r.ok) throw new Error((j && j.error) || ('request failed ' + r.status));
        return j;
    }

    const newLevel = () => ({ floor: {}, ceil: {}, walls: {}, roof: {}, stairs: [], lights: [] });
    const defaultsFor = () => ({ wallExt: 'brick_red', wallInt: 'plaster_cream', floor: 'photo_oak_grey', ceiling: 'plaster_white', roof: 'roof_slate', trim: 'trim_white', slab: 'concrete', stair: 'wood_oak' });
    const randId = () => Math.random().toString(36).slice(2, 5);

    const newShell = () => ({ ops: [], openings: [], parts: [], floors: [], lights: [], cands: [] });

    // ---- buildings: one project holds several interiors, one per building of the model ----
    // The live fields of the project (import.frame / building / iso / cutters / cboxes / clearCollision, shell, the ceiling and wall settings, defaults = the textures) belong to
    // the ACTIVE building, so every tool keeps working on "the building". The others sit in import.buildings[i].snap until they are switched to. The model, its deleted
    // faces, filled holes, removed parts, deleted collision, the door model and where the model stands are shared by all the buildings.
    const B_SET = ['ceilH', 'wallDepth', 'wallThick', 'walls', 'partT'];
    const clone = (o) => JSON.parse(JSON.stringify(o));
    function bSnap(P) {
        const I = P.import, st = {}; B_SET.forEach(k => { if (P.settings[k] !== undefined) st[k] = P.settings[k]; });
        return clone({ import: { frame: I.frame, building: I.building, iso: I.iso, cutters: I.cutters, cboxes: I.cboxes || [], fits: I.fits || [], clearCollision: I.clearCollision }, shell: P.shell, settings: st, defaults: P.defaults });
    }
    function bLoad(P, s) {
        const I = P.import, si = s.import || {};
        I.frame = si.frame || { x: 0, y: 0, z: 0, heading: 0 };
        if (si.building) I.building = si.building; else delete I.building;
        if (si.iso) I.iso = si.iso; else delete I.iso;
        I.cutters = si.cutters || []; I.cboxes = si.cboxes || []; I.fits = si.fits || [];
        if (si.clearCollision === false) I.clearCollision = false; else delete I.clearCollision;
        P.shell = Object.assign(newShell(), s.shell || {});
        B_SET.forEach(k => { if (s.settings && s.settings[k] !== undefined) P.settings[k] = s.settings[k]; else delete P.settings[k]; });
        if (s.defaults) P.defaults = s.defaults;
    }
    // an empty building that starts with this one's ceiling, wall settings and textures
    function bFresh(P) { const cur = bSnap(P); return { import: { frame: { x: 0, y: 0, z: 0, heading: 0 }, cutters: [], cboxes: [], fits: [] }, shell: newShell(), settings: cur.settings, defaults: cur.defaults }; }
    function ensureBuildings(P) {
        const I = P.import; if (!I) return;
        if (!Array.isArray(I.buildings) || !I.buildings.length) { I.buildings = [{ id: 'b1', name: 'Building 1', snap: null }]; I.activeB = 'b1'; }
        if (!I.buildings.some(b => b.id === I.activeB)) I.activeB = I.buildings[0].id;
        I.buildings.forEach(b => { if (b.id === I.activeB) b.snap = null; });
        // the number that is added to the prefix of a building's files: none for the first one, then 2, 3... (a building keeps its number when others are deleted)
        I.buildings.forEach((b, i) => { if (b.sfx === undefined) b.sfx = i === 0 ? '' : String(i + 1); });
    }
    // the data of every building, the active one read live (not copied): [{ id, name, active, d: { import: { frame, building, iso, cutters, cboxes, clearCollision }, shell, settings, defaults } }]
    function bldAll(P) {
        ensureBuildings(P); const I = P.import;
        return I.buildings.map(b => b.id === I.activeB
            ? { id: b.id, name: b.name, active: true, d: { import: { frame: I.frame, building: I.building, iso: I.iso, cutters: I.cutters, cboxes: I.cboxes || [], fits: I.fits || [], clearCollision: I.clearCollision }, shell: P.shell, settings: P.settings, defaults: P.defaults } }
            : { id: b.id, name: b.name, active: false, d: b.snap });
    }
    function bSwitch(P, id) {
        ensureBuildings(P); const I = P.import, cur = I.buildings.find(b => b.id === I.activeB), nxt = I.buildings.find(b => b.id === id);
        if (!nxt || nxt === cur) return false;
        cur.snap = bSnap(P); bLoad(P, nxt.snap); nxt.snap = null; I.activeB = id; return true;
    }
    function buildingChanged() { state.shellSel = null; state.cutSel = null; state.opSel = null; bus.emit('buildings'); }
    function switchBuilding(id) { const ok = edit(P => { bSwitch(P, id); }); if (ok) buildingChanged(); return ok; }
    function addBuilding(name) {
        let id = null;
        const ok = edit(P => {
            ensureBuildings(P); const I = P.import; id = 'b' + randId(); let n = I.buildings.length + 1; while (I.buildings.some(b => b.name === 'Building ' + n)) n++;
            I.buildings.find(b => b.id === I.activeB).snap = bSnap(P); const fresh = bFresh(P);
            const sfx = String(Math.max(1, ...I.buildings.map(b => parseInt(b.sfx || '1', 10) || 1)) + 1);
            I.buildings.push({ id, name: (name || '').trim().slice(0, 40) || 'Building ' + n, sfx, snap: null }); bLoad(P, fresh); I.activeB = id;
        });
        if (ok) buildingChanged(); return ok ? id : null;
    }
    function renameBuilding(id, name) { const n = (name || '').trim().slice(0, 40); if (!n) return false; return edit(P => { ensureBuildings(P); const b = P.import.buildings.find(x => x.id === id); if (b) b.name = n; }); }
    // deleting a building gives the faces its openings cut out back
    function deleteBuilding(id) {
        let done = false;
        edit(P => {
            ensureBuildings(P); const I = P.import; if (I.buildings.length < 2 || !I.buildings.some(b => b.id === id)) return;
            const keep = I.activeB; if (I.activeB !== id) bSwitch(P, id);
            I.cutters.slice().forEach(k => M.ImportModel.removeCutterIn(P, k.id));
            I.buildings = I.buildings.filter(b => b.id !== id);
            const to = I.buildings.find(b => b.id === keep) || I.buildings[0];
            bLoad(P, to.snap); to.snap = null; I.activeB = to.id; done = true;
        });
        if (done) buildingChanged(); return done;
    }
    // run fn as if another building were the active one (nothing is recorded in the history and no event is sent); the export uses it for each building in turn
    function withBuilding(id, fn) {
        const P = state.project; ensureBuildings(P); const I = P.import, orig = I.activeB;
        if (orig === id || !I.buildings.some(b => b.id === id)) return fn();
        bSwitch(P, id);
        try { return fn(); } finally { bSwitch(P, orig); }
    }

    // how the interior looks in the game: normal maps, the default light, wall colour variants (entity sets), skirting, crown and frames, the timecycle
    function defaultLook() {
        return {
            normalMaps: true, flipGreen: false,
            light: { r: 255, g: 238, b: 210, intensity: 4, range: 6, exponent: 24, type: 'point', coneInner: 30, coneOuter: 70, shadows: true, volume: false, corona: 0, specular: true },
            variants: [],                      // [{ id, name, swap: { texId: texId } }]: each is an entity set; the default paint is one too
            skirting: { on: true, h: 0.10, d: 0.015, tex: '' }, crown: { on: false, h: 0.07, d: 0.035, tex: '' },
            frames: 'detailed', sills: true
        };
    }
    function mergeLook(l) {
        const d = defaultLook(); l = l || {};
        const o = Object.assign(d, l); o.light = Object.assign(defaultLook().light, l.light || {}); o.skirting = Object.assign(defaultLook().skirting, l.skirting || {}); o.crown = Object.assign(defaultLook().crown, l.crown || {});
        o.variants = Array.isArray(l.variants) ? l.variants : []; return o;
    }

    // the entity sets the colour schemes become: [{ name, variant }] (variant null = the colours as painted); only schemes that swap something count
    function colourSets(l) {
        l = mergeLook(l); const vars = l.variants.filter(v => v && v.swap && Object.keys(v.swap).some(k => v.swap[k] && v.swap[k] !== k)); if (!vars.length) return [];
        const used = new Set(), slug = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'v', uniq = (n) => { let c = n, k = 2; while (used.has(c)) c = n + k++; used.add(c); return c; };
        return [{ name: uniq('paint_' + slug(l.defaultName || 'default')), variant: null }].concat(vars.map(v => ({ name: uniq('paint_' + slug(v.name)), variant: v })));
    }

    function newProject(name, kind) {
        const p = {
            version: 1, kind: kind === 'vanilla' ? 'vanilla' : (kind === 'import' ? 'import' : 'grid'), name: name || 'New House', prefix: 'mlo' + randId(),
            settings: { storyHeight: 3.1, wallThickness: 0.2, slab: 0.2, foundation: 0.5 },
            defaults: defaultsFor(), levels: [newLevel()], entrance: null,
            export: { resource: '', label: '', coords: '', pedZ: true, floorAbove: 0.1, autoLights: true, outDir: '' },
            look: defaultLook()
        };
        if (p.kind === 'vanilla') {
            // interior shell inside a house that already exists in the game: placement comes from the grabbed house
            p.settings = { ceilH: 2.45, wallDepth: 0.08, partT: 0.10 };
            p.defaults = { wallInt: 'plaster_white', floor: 'photo_oak_grey', ceiling: 'plaster_white', trim: 'trim_white' };
            p.vanilla = { x: '', door: '', facing: 'in', pedOffset: 1.06, gta: '', frame: null, doorWidth: 1.1, grabbed: false, nudge: { dz: 0, dh: 0 } };
            p.shell = newShell();
            p.export.floorAbove = 0;
        }
        if (p.kind === 'import') {
            // an interior built inside a model the user imported: the grid ("frame") sits on the model's floor, nothing is generated for you
            p.settings = { ceilH: 2.45, wallDepth: 0.08, partT: 0.10 };
            p.defaults = { wallInt: 'plaster_white', floor: 'photo_oak_grey', ceiling: 'plaster_white', trim: 'trim_white' };
            p.shell = newShell();
            p.import = { target: '', frame: { x: 0, y: 0, z: 0, heading: 0 }, entity: null, cutters: [], deletes: [], fills: [], mdeletes: [], parts: [] };
            ensureBuildings(p);
            p.export.floorAbove = 0; p.export.autoLights = false;
        }
        return p;
    }
    function upgrade(p) {
        const d = newProject(p.name, p.kind);
        p.kind = d.kind;
        p.settings = Object.assign(d.settings, p.settings || {}); p.defaults = Object.assign(d.defaults, p.defaults || {});
        p.export = Object.assign(d.export, p.export || {}); p.prefix = p.prefix || d.prefix; p.look = mergeLook(p.look);
        p.levels = (p.levels && p.levels.length ? p.levels : [newLevel()]).map(l => Object.assign(newLevel(), l));
        if (p.entrance === undefined) p.entrance = null;
        if (p.kind === 'vanilla') { p.vanilla = Object.assign(d.vanilla, p.vanilla || {}); p.vanilla.nudge = Object.assign({ dz: 0, dh: 0 }, p.vanilla.nudge || {}); p.shell = Object.assign(newShell(), p.shell || {}); }
        if (p.kind === 'import') {
            p.import = Object.assign(d.import, p.import || {}); p.import.frame = Object.assign({ x: 0, y: 0, z: 0, heading: 0 }, p.import.frame || {});
            p.import.cutters = p.import.cutters || []; p.import.deletes = p.import.deletes || []; p.import.fills = p.import.fills || []; p.import.mdeletes = p.import.mdeletes || []; p.import.parts = p.import.parts || []; p.import.colDeletes = p.import.colDeletes || []; p.import.cboxes = p.import.cboxes || []; p.import.fits = p.import.fits || []; p.shell = Object.assign(newShell(), p.shell || {});
            ensureBuildings(p);
        }
        return p;
    }

    const state = {
        project: newProject('New House'), level: 0, dirty: false, saved: true, saving: false,
        tab: 'build', tool: 'wall',
        view: { floor: true, walls: true, roof: true, wallMode: 'up', grid: true, outside: false },
        brush: { wall: 'plaster_cream', floor: 'photo_oak_grey', ceil: 'plaster_white', roof: 'roof_slate' },
        paintTarget: 'wall', paintRoom: false,
        stair: { wid: 1.0, steps: 0, run: 0.30, dir: 1, style: 'solid', rail: true },
        opening: 'door',
        ref: null, refMode: 'ghost', showCollision: false,
        shellTool: 'room', shellSel: null, shellOpen: { type: 'window' }, cutSel: null
    };
    const hist = { undo: [], redo: [] };

    function markChanged() { state.dirty = true; state.saved = false; bus.emit('change'); scheduleSave(); }
    function touch() { state.dirty = true; state.saved = false; bus.emit('saved'); scheduleSave(); }

    // run an edit; one history step per call, skipped when nothing changed
    function edit(fn) {
        const before = JSON.stringify(state.project);
        fn(state.project);
        const after = JSON.stringify(state.project);
        if (before === after) return false;
        M.Errors.crumb('edit');
        hist.undo.push(before); if (hist.undo.length > 120) hist.undo.shift(); hist.redo.length = 0;
        markChanged(); return true;
    }
    function undo() {
        if (!hist.undo.length) return; M.Errors.crumb('undo');
        hist.redo.push(JSON.stringify(state.project)); state.project = JSON.parse(hist.undo.pop());
        state.level = Math.min(state.level, state.project.levels.length - 1); markChanged(); bus.emit('project');
    }
    function redo() {
        if (!hist.redo.length) return;
        hist.undo.push(JSON.stringify(state.project)); state.project = JSON.parse(hist.redo.pop());
        state.level = Math.min(state.level, state.project.levels.length - 1); markChanged(); bus.emit('project');
    }

    // ---- saving ----
    let saveTimer = null;
    function safeName(n) { return (n || '').replace(/[^A-Za-z0-9 _\-]/g, '').trim().slice(0, 60); }
    function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { save().catch(e => { M.Errors.report('save', e); }); }, 1500); }
    async function save() {
        const name = safeName(state.project.name); if (!name) return;
        state.saving = true; bus.emit('saved');
        try { await api('project?name=' + encodeURIComponent(name), 'POST', JSON.stringify(state.project)); state.saved = true; diskName = name; M.Errors.clear('save'); thumbSoon(); }
        finally { state.saving = false; bus.emit('saved'); }
    }

    // ---- the project list: a small picture of the 3D view, and when each project was last opened ----
    let diskName = null, thumbAt = 0, thumbTimer = null;       // diskName: the open project, once it exists as a file
    function thumbSoon() { clearTimeout(thumbTimer); thumbTimer = setTimeout(() => { saveThumb(false).catch(() => { }); }, 2500); }
    // the current 3D view, cropped to 8:5 and scaled down; at most every 30 s unless forced (before the list opens or another project is opened)
    async function saveThumb(force) {
        const name = safeName(state.project.name), cv = M.App && M.App.canvas;
        if (!name || diskName !== name || !cv || !cv.width || !cv.height) return;
        if (!force && Date.now() - thumbAt < 30000) return; thumbAt = Date.now();
        const W = 240, H = 150, c = document.createElement('canvas'); c.width = W; c.height = H;
        const sr = cv.width / cv.height, tr = W / H; let sx = 0, sy = 0, sw = cv.width, sh = cv.height;
        if (sr > tr) { sw = cv.height * tr; sx = (cv.width - sw) / 2; } else { sh = cv.width / tr; sy = (cv.height - sh) / 2; }
        c.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, W, H);
        await api('thumb?name=' + encodeURIComponent(name), 'POST', c.toDataURL('image/jpeg', 0.72).split(',')[1]);
    }
    function openedMap() { try { return JSON.parse(localStorage.getItem('mlo.opened') || '{}') || {}; } catch (e) { return {}; } }
    function noteOpened(name) { try { const m = openedMap(); m[name] = new Date().toISOString(); localStorage.setItem('mlo.opened', JSON.stringify(m)); } catch (e) { } }
    function openedAt(name) { return openedMap()[name] || null; }
    function forgetOpened(name, to) { try { const m = openedMap(); if (to && m[name]) m[to] = m[name]; delete m[name]; localStorage.setItem('mlo.opened', JSON.stringify(m)); } catch (e) { } }
    async function listProjects() { return api('projects'); }
    // the grabbed vanilla house (reference triangles and collision) lives next to the project, not inside it, so undo stays light
    async function loadRef(name) {
        state.ref = null;
        try { state.ref = await api('ref?name=' + encodeURIComponent(name)); } catch (e) { state.ref = null; }
    }
    async function saveRef() {
        const name = safeName(state.project.name); if (!name || !state.ref) return;
        await api('ref?name=' + encodeURIComponent(name), 'POST', JSON.stringify(state.ref));
    }
    async function openProject(name) {
        M.Errors.crumb('open project "' + name + '"');
        try { await saveThumb(true); } catch (e) { }                     // the project that is leaving, while its view is still on screen
        const p = await api('project?name=' + encodeURIComponent(name));
        // the game's own interiors joined together: a page of their own
        if (p && p.kind === 'combo') { if (!state.saved && state.project && state.project.name) { try { await save(); } catch (e) { } } location.href = 'interiors.html?name=' + encodeURIComponent(name); return new Promise(() => { }); }
        state.project = upgrade(p); state.project.name = name; state.level = 0; hist.undo.length = 0; hist.redo.length = 0; state.saved = true; state.dirty = false;
        state.shellSel = null; state.ref = null;
        if (state.project.kind === 'vanilla') await loadRef(name);
        // images the user added to an imported-model project live next to it (not in the undo history)
        if (state.project.kind === 'import') { await loadRef(name); await M.TEX.loadUser(state.ref && state.ref.tex); } else M.TEX.clearUser();
        state.cutSel = null;
        if (state.project.kind === 'import') state.tab = state.project.import.target ? (state.tab === 'import' || state.tab === 'vanilla' ? 'build' : state.tab) : 'import';
        else state.tab = (state.project.kind === 'vanilla' && !state.project.vanilla.grabbed) ? 'vanilla' : ((state.tab === 'vanilla' || state.tab === 'import') ? 'build' : state.tab);
        try { localStorage.setItem('mlo.last', name); } catch (e) { }
        diskName = safeName(name); thumbAt = 0; noteOpened(name);
        bus.emit('project'); bus.emit('change');
    }
    async function createProject(name, kind) {
        try { await saveThumb(true); } catch (e) { }                     // the project that is leaving, while its view is still on screen
        const existing = await listProjects(); let n = safeName(name) || 'New House', base = n, c = 2;
        // a name is also taken while model files from an earlier project of that name are still lying around
        const taken = async (nm) => existing.some(e => e.name.toLowerCase() === nm.toLowerCase()) || (kind === 'import' && (((await api('import/files?name=' + encodeURIComponent(nm))).files) || []).length > 0);
        while (await taken(n)) n = base + ' ' + c++;
        state.project = newProject(n, kind); state.level = 0; hist.undo.length = 0; hist.redo.length = 0; state.ref = null; state.shellSel = null; M.TEX.clearUser();
        state.cutSel = null;
        state.tab = state.project.kind === 'import' ? 'import' : (state.project.kind === 'vanilla' ? 'vanilla' : ((state.tab === 'vanilla' || state.tab === 'import') ? 'build' : state.tab));
        await save(); try { localStorage.setItem('mlo.last', n); } catch (e) { } thumbAt = 0; noteOpened(n);
        bus.emit('project'); bus.emit('change');
    }
    // a copy of the open project, with its imported files, under another name; the copy is opened
    async function saveAs(newName) {
        const existing = await listProjects(); let n = safeName(newName) || 'Copy', base = n, c = 2;
        while (existing.some(e => e.name.toLowerCase() === n.toLowerCase())) n = base + ' ' + c++;
        const from = safeName(state.project.name);
        await save(); if (state.project.kind === 'import' && state.ref) await saveRef();
        await api('project-copy?name=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(n), 'POST');
        await openProject(n); return n;
    }
    // rename: the program moves the project file, its imported files, reference file and picture to the new name (the old way left the imported files behind)
    async function renameProject(newName) {
        const nn = safeName(newName); const old = safeName(state.project.name); if (!nn || nn === old) return;
        await save();
        await api('project-rename?name=' + encodeURIComponent(old) + '&to=' + encodeURIComponent(nn), 'POST');
        state.project.name = nn; diskName = nn; if (M.App) M.App._impName = nn;
        try { localStorage.setItem('mlo.last', nn); } catch (e) { } forgetOpened(old, nn);
        bus.emit('saved');
    }
    // rename any saved project from the list (the open one goes through renameProject)
    async function renameAny(old, newName) {
        const nn = safeName(newName); if (!nn || nn === old) return nn;
        if (old === safeName(state.project.name)) { await renameProject(nn); return nn; }
        await api('project-rename?name=' + encodeURIComponent(old) + '&to=' + encodeURIComponent(nn), 'POST');
        try { if (localStorage.getItem('mlo.last') === old) localStorage.setItem('mlo.last', nn); } catch (e) { } forgetOpened(old, nn);
        return nn;
    }
    // a copy of a saved project (with its imported files) under a free name "<name> copy"; it is not opened
    async function duplicate(name) {
        const existing = await listProjects(); let n = safeName(name + ' copy'), base = n, c = 2;
        while (existing.some(e => e.name.toLowerCase() === n.toLowerCase())) n = base + ' ' + c++;
        if (name === safeName(state.project.name)) { await save(); if (state.project.kind === 'import' && state.ref) await saveRef(); }
        await api('project-copy?name=' + encodeURIComponent(name) + '&to=' + encodeURIComponent(n), 'POST');
        return n;
    }
    async function deleteProject(name) { await api('project?name=' + encodeURIComponent(name), 'DELETE'); forgetOpened(name); }

    // ---- level helpers ----
    const cur = () => state.project.levels[state.level];
    function ensureLevels(n) { while (state.project.levels.length < n) state.project.levels.push(newLevel()); }

    // ---- edit operations (call inside edit()) ----
    const ops = {
        wallKey(o, i, j) { return o + ':' + i + ',' + j; },
        addWall(L, key) { if (!L.walls[key]) L.walls[key] = {}; },
        removeWall(P, k, key) {
            delete P.levels[k].walls[key];
            if (P.entrance && P.entrance.level === k && P.entrance.key === key) P.entrance = null;
        },
        setOpening(P, k, key, type) {
            const w = P.levels[k].walls[key]; if (!w) return;
            if (type) w.open = type; else delete w.open;
            if (P.entrance && P.entrance.level === k && P.entrance.key === key && w.open !== 'door' && w.open !== 'arch') P.entrance = null;
        },
        fillFloor(L, cells, tex) { cells.forEach(c => { L.floor[c[0] + ',' + c[1]] = tex; }); },
        eraseCell(P, k, i, j) {
            const L = P.levels[k], key = i + ',' + j;
            delete L.floor[key]; delete L.roof[key]; delete L.ceil[key];
            L.lights = L.lights.filter(l => !(Math.floor(l.x) === i && Math.floor(l.y) === j));
            L.stairs = L.stairs.filter(s => !M.Mesher.stairInfo(P.settings, s).cells.some(c => c[0] === i && c[1] === j));
        }
    };

    // ---- export names: developer_project for every file the resource makes itself (lowercase, letters and digits); the game files a project replaces keep their own names ----
    let developer = '';
    const slug = (s, n) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, n);
    const safeRes = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    async function loadSettings() { try { const s = await api('settings'); developer = (s && s.developer) || ''; } catch (e) { } try { if (!developer) developer = localStorage.getItem('mlo.developer') || ''; } catch (e) { } return developer; }
    async function setDeveloper(name) {
        developer = String(name || '').trim().slice(0, 40); try { localStorage.setItem('mlo.developer', developer); } catch (e) { }
        try { await api('settings', 'POST', { developer }); } catch (e) { }
        bus.emit('names');
    }
    function getDeveloper() { return developer; }
    // { prefix, resource, auto }: the prefix has no trailing _ (the host adds it); the first building of a project uses it as it is, the others add _2, _3...
    function exportNames(P, nameOverride) {
        const X = (P && P.export) || {};
        if (X.autoNames === false) return { prefix: (P.prefix || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30), resource: safeRes(X.resource) || ('mlo_' + (safeRes(P.name) || 'house')), auto: false };
        const parts = [slug(developer, 20), slug(nameOverride != null ? nameOverride : P.name, 20)].filter(Boolean), base = parts.join('_') || slug(P.prefix, 20) || 'mlo';
        return { prefix: base, resource: base, auto: true };
    }

    M.Model = { colourSets, defaultLook, mergeLook, loadSettings, setDeveloper, getDeveloper, exportNames, bldAll, switchBuilding, addBuilding, renameBuilding, deleteBuilding, withBuilding, state, bus, api, apiRaw, saveAs, touch, edit, undo, redo, save, listProjects, openProject, createProject, renameProject, renameAny, duplicate, deleteProject, saveThumb, openedAt, cur, ensureLevels, ops, newLevel, newProject, upgrade, hist, loadRef, saveRef, safeName };
})(window.MLO);


