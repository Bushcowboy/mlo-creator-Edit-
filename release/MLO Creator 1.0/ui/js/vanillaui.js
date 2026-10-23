// Panels for vanilla-house projects: the House tab (grab), shell build tools, view options and export.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, TEX, Model, Shell, Mesher } = M, S = Model.state, bus = Model.bus;
    const $ = (id) => document.getElementById(id);
    const VU = M.VanillaUI = {};
    const kit = () => M.UI.kit;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });

    const TOOLS = [['room', 'Add room', '1'], ['cut', 'Cut out', '2'], ['part', 'Partition', '3'], ['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6'], ['floor', 'Floor paint', '7'], ['select', 'Select', 'V'], ['eraser', 'Eraser', 'X']];
    const HELP = {
        room: 'Drag a rectangle to add it to the interior. Corners snap to the house\'s walls and to 5 cm.',
        cut: 'Drag a rectangle to take it out of the interior (a column, a closet, a bay you do not want).',
        part: 'Drag a straight line to build an interior wall. It snaps to the other walls. Put doors in it with the Door tool.',
        door: 'Click a wall to cut a doorway (0.9 x 2.1 m). Works on interior walls and on the house walls. Click it again to fill it in.',
        window: 'Click a house wall to put a window in. Next to a window of the real house it snaps to that window\'s size (green boxes show the ones found).',
        arch: 'Click a wall to open a 1 m archway up to 2.3 m.',
        floor: 'Drag a rectangle to give that part of the floor the floor texture chosen in the Paint tab.',
        select: 'Click a door, window or partition to change its size and position in the panel.',
        eraser: 'Click a partition or an opening to remove it. Added and cut rectangles are listed below.',
        paint: 'Click a wall to give it the chosen texture.'
    };
    const DEFAULT_ROWS = [['wallInt', 'Walls'], ['floor', 'Floors'], ['ceiling', 'Ceiling'], ['trim', 'Trim & frames']];

    function parseCoords(s) { return ((s || '').replace(/[A-Za-z_][A-Za-z_0-9]*/g, ' ').match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
    const r2 = (v) => Math.round(v * 100) / 100;
    const f1 = (v, d) => (v == null || isNaN(v)) ? '' : v.toFixed(d == null ? 2 : d);

    // ---------------- the House tab: grab ----------------
    let busy = false, lastError = '';
    async function grab(statusEl, btn) {
        const V = S.project.vanilla, n = parseCoords(V.door);
        if (n.length < 4) { toast('Paste the door spot first: vec4(x, y, z, heading).', 'warn'); return; }
        if (busy) return; busy = true; lastError = ''; btn.disabled = true; btn.textContent = 'Reading the game...';
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) statusEl.textContent = s.status; } catch (e) { } }, 500);
        try {
            const res = await Model.api('vanilla/grab', 'POST', { x: n[0], y: n[1], z: n[2], heading: n[3], facing: V.facing, pedOffset: V.pedOffset, gta: V.gta });
            if (!res.ok) { lastError = res.error || 'The lookup failed.'; toast(lastError, 'err'); }
            else await applyGrab(res);
        } catch (e) { lastError = e.message; toast('Lookup failed: ' + e.message, 'err'); }
        clearInterval(poll); busy = false; statusEl.textContent = ''; M.UI.renderLeft();
    }

    async function applyGrab(res) {
        S.ref = { ref: res.ref, collision: res.collision, info: res.info };
        const ops = [];
        (res.regions || []).forEach(r => (r.rects || []).forEach(rc => ops.push({ op: 'add', r: rc.map(v => Math.round(v * 1000) / 1000) })));
        const cands = (res.windows || []).map(w => ({ o: w.o, c: r2(w.c), u0: r2(w.u0), u1: r2(w.u1), z0: r2(w.z0), z1: r2(w.z1), inward: w.inward, door: !!w.door }));
        const W = res.door.width || 1.1, openings = [];
        if (res.door.found) openings.push({ id: 'entrance', type: 'door', o: 'H', c: 0, u0: -W / 2, u1: W / 2, z0: 0, z1: 2.1, entrance: true });
        cands.forEach((c, i) => {
            if (c.o === 'H' && Math.abs(c.c) < 0.45 && c.u0 < W / 2 && c.u1 > -W / 2) return;                // that is the entrance door itself
            const type = c.door ? 'door' : 'window';
            openings.push({ id: 'a' + i, type, o: c.o, c: c.c, u0: r2(c.u0 + (c.door ? 0.05 : 0.06)), u1: r2(c.u1 - (c.door ? 0.05 : 0.06)), z0: c.door ? 0 : r2(Math.max(0.2, c.z0)), z1: c.door ? 2.1 : r2(Math.min(2.3, c.z1 - 0.1)) });
        });
        Model.edit(P => {
            const V = P.vanilla; V.grabbed = true; V.frame = res.frame; V.doorWidth = W; V.log = res.info.log; V.covering = res.info.covering; V.found = res.door.found;
            V.auto = { ops: JSON.parse(JSON.stringify(ops)), openings: JSON.parse(JSON.stringify(openings)), cands };
            P.shell = { ops, openings, parts: [], floors: [], lights: [], cands, paint: [] };
        });
        Model.hist.undo.length = 0; Model.hist.redo.length = 0; S.shellSel = null;
        try { await Model.saveRef(); } catch (e) { toast('Could not save the reference: ' + e.message, 'warn'); }
        M.App.rebuildRef(); M.App.remesh(); M.App.frameAll();
        toast('House found: ' + ops.length + ' room rectangles, ' + openings.length + ' openings.', 'ok'); M.App.setTab('build');
    }

    VU.renderHouse = function (root) {
        const P = S.project, V = P.vanilla, k = kit();
        root.append(el('div', { class: 'h' }, 'Existing house'));
        root.append(el('div', { class: 'note' }, 'In the game, stand just outside the front door of the house, facing the door, and copy your coordinates. Paste them here and the program finds that house in the game files and measures it.'));
        root.append(el('textarea', { placeholder: 'vec4(-20.51, -1858.98, 25.41, 227.5)', oninput: (e) => { V.door = e.target.value; Model.touch(); } }, V.door || ''));
        root.append(el('div', { class: 'row' }, el('label', null, 'You faced'), el('select', { class: 'grow', onchange: (e) => { V.facing = e.target.value; Model.touch(); } },
            el('option', { value: 'in', selected: V.facing !== 'out' ? true : null }, 'into the house (the door)'), el('option', { value: 'out', selected: V.facing === 'out' ? true : null }, 'away from the house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Feet to floor'), el('input', { type: 'number', class: 'grow', step: '0.01', value: V.pedOffset, onchange: (e) => { V.pedOffset = parseFloat(e.target.value) || 1.06; Model.touch(); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row' }, el('label', null, 'GTA V folder'), el('input', { type: 'text', class: 'grow', value: V.gta || '', placeholder: 'found automatically', onchange: (e) => { V.gta = e.target.value.trim(); Model.touch(); } })));
        const status = el('div', { class: 'note', style: { minHeight: '18px' } });
        const btn = el('button', { class: 'btn primary', style: { width: '100%', padding: '9px', marginTop: '6px' }, onclick: () => grab(status, btn) }, V.grabbed ? 'Grab again' : 'Grab this house');
        root.append(btn, status);
        if (lastError) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, lastError));
        if (V.grabbed) {
            root.append(el('div', { class: 'h' }, 'What was found'));
            const f = V.frame; if (f) root.append(el('div', { class: 'kv' }, 'Frame heading', el('b', null, f1(f.heading) + '°'), 'Floor height', el('b', null, f1(f.oz, 3) + ' m'), 'Entrance at', el('b', null, f1(f.ox) + ', ' + f1(f.oy))));
            root.append(el('div', { class: 'note' }, (V.covering || []).length ? 'Map pieces: ' + V.covering.join(', ') : ''));
            const lg = el('div', { class: 'log' }); (V.log || []).forEach(l => lg.append(el('div', null, l))); root.append(lg);
            if (!V.found) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'No wall was found in front of you, so there is no entrance door yet. Draw the rooms with Add room and cut a door with the Door tool.'));
            root.append(el('div', { class: 'row', style: { marginTop: '8px' } }, el('button', { class: 'btn sm', onclick: () => M.App.setTab('build') }, 'Go to Build')));
        }
    };

    // ---------------- Build tab ----------------
    function findOpening(id) {
        const sh = S.project.shell; let op = sh.openings.find(o => o.id === id), host = null;
        if (!op) sh.parts.forEach(pt => { const f = (pt.open || []).find(o => o.id === id); if (f) { op = f; host = pt; } });
        return op ? { op, host } : null;
    }
    function numField(label, get, set, step, unit) {
        return el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: step || '0.01', value: get(), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    }

    VU.renderBuild = function (root) {
        const t = S.shellTool, P = S.project, sh = P.shell, k = kit(), grid = el('div', { class: 'tools' });
        TOOLS.forEach(tl => grid.append(el('button', { class: 'tool' + (t === tl[0] ? ' on' : ''), onclick: () => M.App.setTool(tl[0]) }, tl[1], el('kbd', null, tl[2]))));
        root.append(el('div', { class: 'h' }, 'Tools'), grid);
        root.append(el('div', { class: 'h' }, (TOOLS.filter(x => x[0] === t)[0] || ['', 'Tool'])[1]), el('div', { class: 'note' }, HELP[t] || ''));
        if (t === 'floor') root.append(el('div', { class: 'row' }, el('label', null, 'Floor'), k.swatchEl(S.brush.floor, 28), el('span', { class: 'grow' }, TEX.def(S.brush.floor).name), el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'floor'; M.App.setTab('paint'); } }, 'Change')));

        VU.renderSelected(root, k);
        VU.renderRectangles(root, k);
    };

    // the selected opening or partition: its numbers
    VU.renderSelected = function (root, k) {
        const sh = S.project.shell, sel = S.shellSel;
        if (sel && sel.kind === 'open') {
            const f = findOpening(sel.id);
            if (f) {
                const op = f.op;
                root.append(el('div', { class: 'h' }, 'Selected ' + op.type));
                const upd = (key, v) => Model.edit(Q => { const g = f.host ? Q.shell.parts.find(p => p.id === f.host.id).open.find(o => o.id === op.id) : Q.shell.openings.find(o => o.id === op.id); if (g) g[key] = Math.round(v * 1000) / 1000; });
                root.append(el('div', { class: 'row' }, el('label', null, 'Kind'), k.seg([['door', 'Door'], ['window', 'Window'], ['arch', 'Arch']], op.type, v => { Model.edit(Q => { const g = f.host ? Q.shell.parts.find(p => p.id === f.host.id).open.find(o => o.id === op.id) : Q.shell.openings.find(o => o.id === op.id); if (g) g.type = v; }); M.UI.renderLeft(); })));
                root.append(numField('From', () => f1(op.u0), v => upd('u0', v), '0.01', 'm'), numField('To', () => f1(op.u1), v => upd('u1', v), '0.01', 'm'),
                    numField('Bottom', () => f1(op.z0), v => upd('z0', v), '0.01', 'm'), numField('Top', () => f1(op.z1), v => upd('z1', v), '0.01', 'm'));
                root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm danger', onclick: () => M.ShellTools.deleteSelected() }, op.entrance ? 'Delete the entrance door' : 'Delete')));
            }
        } else if (sel && sel.kind === 'part') {
            const pt = sh.parts.find(p => p.id === sel.id);
            if (pt) {
                root.append(el('div', { class: 'h' }, 'Selected partition'));
                const upd = (key, v) => Model.edit(Q => { const g = Q.shell.parts.find(p => p.id === pt.id); if (g) g[key] = Math.round(v * 1000) / 1000; });
                root.append(el('div', { class: 'note' }, (pt.o === 'H' ? 'Runs along x at y = ' : 'Runs along y at x = ') + f1(pt.c) + ' m'));
                root.append(numField('Position', () => f1(pt.c), v => upd('c', v), '0.01', 'm'), numField('Start', () => f1(pt.u0), v => upd('u0', v), '0.01', 'm'), numField('End', () => f1(pt.u1), v => upd('u1', v), '0.01', 'm'));
                root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm danger', onclick: () => M.ShellTools.deleteSelected() }, 'Delete partition')));
            }
        }
    };

    VU.renderRectangles = function (root, k) {
        const P = S.project, sh = P.shell;
        // the rectangles the interior is made of
        root.append(el('div', { class: 'h' }, 'Interior rectangles'));
        const list = el('div', { class: 'plist', style: { maxHeight: '170px' } });
        sh.ops.forEach((o, i) => list.append(el('div', { class: 'pitem', style: { padding: '4px 8px' }, onmouseenter: () => { S.hoverOp = i; }, onmouseleave: () => { S.hoverOp = null; } },
            el('b', null, o.op === 'add' ? 'Add' : 'Cut'), el('span', { class: 'note' }, f1(o.r[2] - o.r[0]) + ' x ' + f1(o.r[3] - o.r[1]) + ' m'),
            el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); S.hoverOp = null; Model.edit(Q => { Q.shell.ops.splice(i, 1); }); M.UI.renderLeft(); } }, 'x'))));
        if (!sh.ops.length) list.append(el('div', { class: 'note' }, 'Nothing yet. Grab a house on the House tab, or draw with Add room.'));
        root.append(list);
        root.append(el('div', { class: 'row wrap' },
            P.vanilla && P.vanilla.auto ? el('button', { class: 'btn sm', onclick: async () => { if (await k.confirm('Start over from the grabbed house?', 'The rectangles, openings, partitions and floor paint go back to what the program measured.', 'Reset', true)) { Model.edit(Q => { const a = Q.vanilla.auto; Q.shell.ops = JSON.parse(JSON.stringify(a.ops)); Q.shell.openings = JSON.parse(JSON.stringify(a.openings)); Q.shell.parts = []; Q.shell.floors = []; Q.shell.paint = []; Q.shell.lights = []; }); S.shellSel = null; M.UI.renderLeft(); } } }, 'Reset to the grabbed house') : null));
        root.append(el('div', { class: 'h' }, 'Camera'), el('div', { class: 'note' }, 'Right-drag orbit · middle-drag or Shift+right-drag pan · wheel zoom · WASD move · Q/E turn · T top-down.'));
    };

    VU.renderPaint = function (root) {
        const P = S.project, k = kit();
        root.append(el('div', { class: 'h' }, 'Paint'), el('div', { class: 'note' }, 'Walls: click a wall face. Floors: drag a rectangle with the Floor paint tool (key 7) or set the whole floor below. Pick a texture in the bench underneath.'));
        root.append(el('div', { class: 'row' }, k.seg([['wall', 'Walls'], ['floor', 'Floors']], S.paintTarget === 'floor' ? 'floor' : 'wall', v => { S.paintTarget = v; S.shellTool = v === 'floor' ? 'floor' : 'paint'; S.benchSel = S.brush[v]; M.App.refreshPanels(); })));
        root.append(el('div', { class: 'h' }, 'Project theme'), el('div', { class: 'note' }, 'What every unpainted surface looks like. Pick a texture below, then press Set.'));
        DEFAULT_ROWS.forEach(r => root.append(el('div', { class: 'defrow' }, k.swatchEl(P.defaults[r[0]], 22), el('span', null, r[1]),
            el('button', { class: 'btn sm', onclick: () => { Model.edit(PP => { PP.defaults[r[0]] = S.benchSel || S.brush[S.paintTarget]; }); M.App.refreshPanels(); } }, 'Set'))));
    };

    // ---------------- right panel ----------------
    VU.renderRight = function (root) {
        const P = S.project, k = kit();
        root.append(el('div', { class: 'h' }, 'View'));
        root.append(el('div', { class: 'row' }, el('label', null, 'The house'), k.seg([['off', 'Off'], ['ghost', 'Ghost'], ['solid', 'Solid']], S.refMode, v => { S.refMode = v; M.UI.renderRight(); })));
        const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
        root.append(chk('Game collision (orange)', () => S.showCollision, v => { S.showCollision = v; }), chk('Ceiling', () => S.view.roof, v => { S.view.roof = v; }), chk('Floor', () => S.view.floor, v => { S.view.floor = v; }),
            chk('Walls', () => S.view.walls, v => { S.view.walls = v; }), chk('Grid', () => S.view.grid, v => { S.view.grid = v; M.App.renderer.showGrid = v; }));
        root.append(el('div', { class: 'row', style: { marginTop: '6px' } }, el('label', null, 'Ceiling'), el('input', { type: 'number', class: 'grow', step: '0.05', min: '2.2', max: '4', value: P.settings.ceilH, onchange: (e) => { const v = Math.min(4, Math.max(2.2, parseFloat(e.target.value) || 2.45)); Model.edit(Q => { Q.settings.ceilH = v; }); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Wall depth'), el('input', { type: 'number', class: 'grow', step: '0.01', min: '0.04', max: '0.3', value: P.settings.wallDepth, title: 'How far the walls reach out from the room surface towards the game\'s own walls', onchange: (e) => { const v = Math.min(0.3, Math.max(0.04, parseFloat(e.target.value) || 0.08)); Model.edit(Q => { Q.settings.wallDepth = v; }); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.App.toggleTopDown() }, 'Top-down (T)'), el('button', { class: 'btn sm', onclick: () => M.App.frameAll() }, 'Frame the house')));
        const b = M.App.built; if (b) root.append(el('div', { class: 'h' }, 'Model'), el('div', { class: 'kv' }, 'Triangles', el('b', null, b.stats.tris.toLocaleString()), 'Openings', el('b', null, P.shell.openings.length), 'Partitions', el('b', null, P.shell.parts.length)));
    };

    // ---------------- export ----------------
    function placement(P) {
        const V = P.vanilla, f = V.frame; if (!f) return null;
        return { x: f.ox, y: f.oy, z: f.oz + (V.nudge.dz || 0), heading: (((f.heading + (V.nudge.dh || 0)) % 360) + 360) % 360 };
    }
    function safeRes(s) { return (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
    let ex = {};
    VU.renderExport = function (root) {
        const P = S.project, X = P.export, V = P.vanilla, k = kit(); ex = {};
        const text = (key, ph) => el('input', { type: 'text', class: 'grow', value: X[key] || '', placeholder: ph || '', oninput: (e) => { X[key] = e.target.value; Model.touch(); } });
        root.append(el('div', { class: 'h' }, 'Resource'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Folder'), text('resource', 'mlo_' + (safeRes(P.name) || 'house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Prefix'), el('input', { type: 'text', class: 'grow', value: P.prefix, maxlength: 8, title: 'Every model in the pack starts with this. Keep it unique on your server.', oninput: (e) => { P.prefix = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); Model.touch(); } })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Label'), text('label', P.name)));
        root.append(el('div', { class: 'h' }, 'Where it goes'));
        const pl = placement(P);
        if (!pl) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'No house has been grabbed yet. Use the House tab first.'));
        else {
            ex.place = el('div', { class: 'kv' }); root.append(ex.place);
            root.append(el('div', { class: 'note' }, 'The position and heading come from the house you grabbed. Nudge them only if the walls do not line up in the game.'));
            root.append(el('div', { class: 'row' }, el('label', null, 'Floor height'), k.stepper(() => (V.nudge.dz >= 0 ? '+' : '') + V.nudge.dz.toFixed(2) + ' m', () => { V.nudge.dz = Math.round((V.nudge.dz - 0.01) * 100) / 100; Model.touch(); VU.updatePlace(); }, () => { V.nudge.dz = Math.round((V.nudge.dz + 0.01) * 100) / 100; Model.touch(); VU.updatePlace(); })));
            root.append(el('div', { class: 'row' }, el('label', null, 'Turn'), k.stepper(() => (V.nudge.dh >= 0 ? '+' : '') + V.nudge.dh.toFixed(1) + '°', () => { V.nudge.dh = Math.round((V.nudge.dh - 0.1) * 10) / 10; Model.touch(); VU.updatePlace(); }, () => { V.nudge.dh = Math.round((V.nudge.dh + 0.1) * 10) / 10; Model.touch(); VU.updatePlace(); })));
            VU.updatePlace();
        }
        root.append(el('div', { class: 'h' }, 'Options'));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.autoLights ? true : null, onchange: (e) => { X.autoLights = e.target.checked; Model.touch(); } }), 'Automatic ceiling lights in every room'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Output folder'), el('input', { type: 'text', class: 'grow', value: X.outDir || '', placeholder: 'default: the output folder next to the program', onchange: (e) => { X.outDir = e.target.value.trim(); Model.touch(); } })));
        root.append(el('div', { class: 'h' }, 'Game files'));
        root.append(el('div', { class: 'note' }, 'The real house has a solid front door, painted-on window glass, solid collision and occluders that hide the inside. Export copies the game\'s files for this house with those parts cut out; they replace the originals while the resource runs.'));
        const cut = (key, label) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X[key] !== false ? true : null, onchange: (e) => { X[key] = e.target.checked; Model.touch(); } }), label);
        root.append(cut('cutDoor', 'Cut the front door'), cut('cutWindows', 'Cut the window glass'), cut('cutCollision', 'Cut the collision that blocks the rooms'), cut('cutOccluders', 'Remove the occluders on the interior'));
        root.append(el('div', { class: 'note' }, 'Only one resource can replace a given game file. Two houses in the same block need their cuts in one resource.'));
        ex.btn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px', padding: '9px' }, onclick: () => doExport() }, 'Export resource');
        root.append(ex.btn);
        ex.log = el('div', { class: 'log', style: { marginTop: '10px', display: 'none' } }); root.append(ex.log);
        ex.after = el('div', { class: 'row wrap', style: { display: 'none' } }); root.append(ex.after);
    };
    VU.updatePlace = function () {
        if (!ex.place) return; const pl = placement(S.project); ex.place.innerHTML = '';
        if (pl) ex.place.append('X', el('b', null, f1(pl.x, 3)), 'Y', el('b', null, f1(pl.y, 3)), 'Floor Z', el('b', null, f1(pl.z, 3)), 'Heading', el('b', null, f1(pl.heading, 2) + '°'));
    };

    async function doExport() {
        const P = S.project, X = P.export, pl = placement(P);
        const log = (html, cls) => { ex.log.style.display = 'block'; ex.log.append(el('div', { class: cls || '' }, html)); ex.log.scrollTop = 1e9; };
        ex.log.innerHTML = ''; ex.after.style.display = 'none';
        if (!pl) { toast('Grab a house first.', 'warn'); return; }
        const built = Shell.build(P, { mode: 'export', autoLights: X.autoLights });
        if (!built.batches.length) { toast('The interior is empty: grab a house or add a room first.', 'warn'); return; }
        if (!P.prefix) { toast('Give the project a prefix first.', 'warn'); return; }
        const resource = safeRes(X.resource) || ('mlo_' + (safeRes(P.name) || 'house'));
        ex.btn.disabled = true; ex.btn.textContent = 'Exporting...';
        try {
            log('Meshing: ' + built.stats.tris + ' triangles, ' + built.stats.boxes + ' collision boxes, ' + built.stats.portals + ' portals, ' + built.stats.lights + ' lights');
            if (!built.portals.length) log('Warning: no windows or doors in the house walls, so the interior will not be visible from outside.', 'bad');
            const anyCut = X.cutDoor !== false || X.cutWindows !== false || X.cutCollision !== false || X.cutOccluders !== false;
            const patch = anyCut ? { enabled: true, gta: P.vanilla.gta || '', frame: { ox: pl.x, oy: pl.y, oz: pl.z, heading: pl.heading }, ceilH: P.settings.ceilH, rects: Shell.regionRects(P.shell), openings: built.shell.resolved,
                doors: X.cutDoor !== false, windows: X.cutWindows !== false, collision: X.cutCollision !== false, occluders: X.cutOccluders !== false } : undefined;
            if (patch) log('Cutting the game files for this house (the first run reads the game, about half a minute)...');
            const model = Mesher.toExport(P, built, { light: {}, model: { resource, prefix: P.prefix, label: X.label || P.name, timecycle: 'hash_E83C53FC', placement: pl, entranceNote: 'the grabbed house door at ' + (P.vanilla.door || '').replace(/\s+/g, ' ').trim(), outDir: X.outDir || undefined, patch } });
            const res = await Model.api('export', 'POST', model);
            if (!res.ok) { log('Export failed: ' + res.error, 'bad'); console.error(res.detail); }
            else {
                (res.log || []).forEach(l => log(l)); (res.warnings || []).forEach(l => log('Warning: ' + l, 'bad')); (res.files || []).forEach(l => log('  ' + l)); log('Done: ' + res.dir, 'good');
                ex.after.style.display = 'flex'; ex.after.innerHTML = '';
                ex.after.append(el('button', { class: 'btn sm', onclick: () => Model.api('reveal?name=' + encodeURIComponent(res.dir), 'POST') }, 'Open folder'),
                    el('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText('ensure ' + res.resource).then(() => toast('Copied: ensure ' + res.resource, 'ok')); } }, 'Copy "ensure ' + res.resource + '"'));
            }
        } catch (err) { log('Export failed: ' + err.message, 'bad'); }
        ex.btn.disabled = false; ex.btn.textContent = 'Export resource';
    }

    VU.updateShellInfo = function () { };
})(window.MLO);
