// Interior shell for a vanilla house. The interior is a set of rectangles (add / cut), so the automatic fit and hand edits share one model.
// Walls are thin: the room's surface is the detected inner boundary and the wall box reaches outward by `wallDepth` towards the game's own wall.
// Output has the same shape as Mesher.build(): batches, collision boxes, portals, lights.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TEX = M.TEX;
    const MAXV = 60000;
    const OPEN = {
        door: { w: 0.9, z0: 0, z1: 2.1, portal: 8192 },
        window: { w: 0.9, z0: 0.9, z1: 2.1, portal: 0, glass: true },
        arch: { w: 1.0, z0: 0, z1: 2.3, portal: 8192 }
    };

    // The surfaces a collision box can have: the game's own surface types (the numbers are the lines of data\materials\materials.dat), with the colour of the
    // box's outline in the editor. The type decides how it sounds, how bullets go through it and what it does to a ragdoll.
    const COLMATS = [
        { id: 'concrete', name: 'Concrete', type: 1, col: [0.72, 0.74, 0.80] }, { id: 'plaster', name: 'Plaster, drywall', type: 101, col: [0.95, 0.90, 0.72] },
        { id: 'brick', name: 'Brick', type: 13, col: [0.90, 0.52, 0.40] }, { id: 'stone', name: 'Stone', type: 11, col: [0.62, 0.66, 0.62] }, { id: 'marble', name: 'Marble', type: 14, col: [0.86, 0.88, 0.95] },
        { id: 'wood', name: 'Wood (polished)', type: 72, col: [0.82, 0.62, 0.36] }, { id: 'metal', name: 'Metal (solid)', type: 56, col: [0.55, 0.72, 0.95] }, { id: 'railing', name: 'Metal railing', type: 65, col: [0.40, 0.62, 0.90] },
        { id: 'tile', name: 'Tile (ceramic)', type: 81, col: [0.55, 0.92, 0.92] }, { id: 'carpet', name: 'Carpet', type: 97, col: [0.78, 0.58, 0.85] }, { id: 'linoleum', name: 'Linoleum', type: 95, col: [0.70, 0.85, 0.55] },
        { id: 'plastic', name: 'Plastic', type: 86, col: [0.95, 0.60, 0.80] }, { id: 'glass', name: 'Glass (shoot through)', type: 112, col: [0.50, 0.90, 1.0] }
    ];
    const COLMAT = {}; COLMATS.forEach(m => { COLMAT[m.id] = m; });
    M.COLMATS = { list: COLMATS, byId: COLMAT, get: (id) => COLMAT[id] || COLMAT.concrete };

    function uniq(a) { a.sort((p, q) => p - q); const o = []; for (const v of a) if (!o.length || Math.abs(v - o[o.length - 1]) > 1e-6) o.push(v); return o; }

    // compressed grid of the region (union of 'add' rects minus 'cut' rects, in order)
    function regionGrid(shell, extraX, extraY) {
        const xs = [], ys = [];
        shell.ops.forEach(o => { xs.push(o.r[0], o.r[2]); ys.push(o.r[1], o.r[3]); });
        (extraX || []).forEach(v => xs.push(v)); (extraY || []).forEach(v => ys.push(v));
        const X = uniq(xs), Y = uniq(ys), nx = Math.max(X.length - 1, 0), ny = Math.max(Y.length - 1, 0), mask = [];
        for (let i = 0; i < nx; i++) mask.push(new Array(ny).fill(false));
        shell.ops.forEach(o => {
            const r = o.r;
            for (let i = 0; i < nx; i++) {
                const cx = (X[i] + X[i + 1]) / 2; if (cx <= r[0] || cx >= r[2]) continue;
                for (let j = 0; j < ny; j++) { const cy = (Y[j] + Y[j + 1]) / 2; if (cy > r[1] && cy < r[3]) mask[i][j] = o.op === 'add'; }
            }
        });
        return { X, Y, nx, ny, mask };
    }

    // wall segments along the boundary of the region; inward = which side of the wall line the room is on (+1 = towards +x / +y)
    function boundary(g) {
        const segs = [];
        for (let j = 0; j <= g.ny; j++) {
            let cur = null;
            for (let i = 0; i < g.nx; i++) {
                const below = j > 0 ? g.mask[i][j - 1] : false, above = j < g.ny ? g.mask[i][j] : false;
                if (below !== above) {
                    const inward = above ? 1 : -1;
                    if (cur && cur.inward === inward && Math.abs(cur.u1 - g.X[i]) < 1e-6) cur.u1 = g.X[i + 1];
                    else { cur = { o: 'H', c: g.Y[j], u0: g.X[i], u1: g.X[i + 1], inward, ops: [] }; segs.push(cur); }
                } else cur = null;
            }
        }
        for (let i = 0; i <= g.nx; i++) {
            let cur = null;
            for (let j = 0; j < g.ny; j++) {
                const left = i > 0 ? g.mask[i - 1][j] : false, right = i < g.nx ? g.mask[i][j] : false;
                if (left !== right) {
                    const inward = right ? 1 : -1;
                    if (cur && cur.inward === inward && Math.abs(cur.u1 - g.Y[j]) < 1e-6) cur.u1 = g.Y[j + 1];
                    else { cur = { o: 'V', c: g.X[i], u0: g.Y[j], u1: g.Y[j + 1], inward, ops: [] }; segs.push(cur); }
                } else cur = null;
            }
        }
        return segs;
    }

    function build(project, opts) {
        opts = opts || {};
        const S = project.shell, cfg = project.settings, D = project.defaults;
        const H = cfg.ceilH, depth = cfg.wallDepth, PT = cfg.partT;
        const exportMode = opts.mode === 'export';
        const wantBoxes = exportMode || !!opts.boxes;         // the collision boxes are made for the export, and for the editor's "my collision" outline
        // walls = 'skin' (imported models only): the walls are the building's own wall faces turned to look into the rooms, so they cannot be off by a millimetre;
        // no wall pieces or wall collision are made from the room edges (the game's own collision of the building stays). Openings, trim and portals still are.
        const skin = project.kind === 'import' && cfg.walls === 'skin';
        // the finishing touches (project.look): skirting along the floor, crown moulding under the ceiling, detailed casings and window sills
        const LK = (M.Model && M.Model.mergeLook) ? M.Model.mergeLook(project.look) : { skirting: { on: false }, crown: { on: false }, frames: 'simple', sills: false };
        const SK = LK.skirting, CR = LK.crown, detailed = LK.frames === 'detailed', skTex = (SK.tex && TEX.byId[SK.tex]) ? SK.tex : D.trim, crTex = (CR.tex && TEX.byId[CR.tex]) ? CR.tex : D.trim;
        const acc = new Map(), batches = [], boxes = [], matList = [], matIdx = new Map(), portals = [], lights = [], colTris = [];
        const bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
        const stats = { tris: 0, boxes: 0, portals: 0, lights: 0, warnings: [] };

        function emitQuad(kind, group, tex, glass, a, b, c, d) {
            const key = kind + '|' + group + '|' + tex + '|' + (glass ? 1 : 0);
            let m = acc.get(key);
            if (!m || m.pos.length / 3 + 4 > MAXV) { m = { level: 0, kind, group, tex, glass: !!glass, pos: [], nrm: [], uv: [], idx: [] }; acc.set(key, m); batches.push(m); }
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
            const tile = glass ? 1 : TEX.tile(tex), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), base = m.pos.length / 3;
            [a, b, c, d].forEach(p => {
                m.pos.push(p[0], p[1], p[2]); m.nrm.push(nx, ny, nz);
                if (ax >= ay && ax >= az) m.uv.push(p[1] / tile, -p[2] / tile); else if (ay >= ax && ay >= az) m.uv.push(p[0] / tile, -p[2] / tile); else m.uv.push(p[0] / tile, p[1] / tile);
                for (let q = 0; q < 3; q++) { if (p[q] < bmn[q]) bmn[q] = p[q]; if (p[q] > bmx[q]) bmx[q] = p[q]; }
            });
            m.idx.push(base, base + 1, base + 2, base + 2, base + 3, base); stats.tris += 2;
        }
        // one triangle (a, b, c); the normal follows the winding
        function emitTri(kind, group, tex, a, b, c) {
            const key = kind + '|' + group + '|' + tex + '|0'; let m = acc.get(key);
            if (!m || m.pos.length / 3 + 3 > MAXV) { m = { level: 0, kind, group, tex, glass: false, pos: [], nrm: [], uv: [], idx: [] }; acc.set(key, m); batches.push(m); }
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
            const tile = TEX.tile(tex), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), base = m.pos.length / 3;
            [a, b, c].forEach(p => {
                m.pos.push(p[0], p[1], p[2]); m.nrm.push(nx, ny, nz);
                if (ax >= ay && ax >= az) m.uv.push(p[1] / tile, -p[2] / tile); else if (ay >= ax && ay >= az) m.uv.push(p[0] / tile, -p[2] / tile); else m.uv.push(p[0] / tile, p[1] / tile);
                for (let q = 0; q < 3; q++) { if (p[q] < bmn[q]) bmn[q] = p[q]; if (p[q] > bmx[q]) bmx[q] = p[q]; }
            });
            m.idx.push(base, base + 1, base + 2); stats.tris += 1;
        }
        // axis-aligned rectangle in the plane ax = f, ranges (p0,p1) x (q0,q1) over the cyclic pair of the other axes; sign = facing direction
        function pq(kind, group, tex, glass, ax, f, p0, p1, q0, q1, sign) {
            if (p1 - p0 < 1e-5 || q1 - q0 < 1e-5) return;
            const P = (p, q) => ax === 'x' ? [f, p, q] : (ax === 'y' ? [q, f, p] : [p, q, f]);
            const a = P(p0, q0), b = P(p1, q0), c = P(p1, q1), d = P(p0, q1);
            if (sign > 0) emitQuad(kind, group, tex, glass, a, b, c, d); else emitQuad(kind, group, tex, glass, a, d, c, b);
        }
        function box(kind, group, tex, x0, y0, z0, x1, y1, z1) {
            pq(kind, group, tex, false, 'x', x1, y0, y1, z0, z1, 1); pq(kind, group, tex, false, 'x', x0, y0, y1, z0, z1, -1);
            pq(kind, group, tex, false, 'y', y1, z0, z1, x0, x1, 1); pq(kind, group, tex, false, 'y', y0, z0, z1, x0, x1, -1);
            pq(kind, group, tex, false, 'z', z1, x0, x1, y0, y1, 1); pq(kind, group, tex, false, 'z', z0, x0, x1, y0, y1, -1);
        }
        function cbox(x0, y0, z0, x1, y1, z1, type, room) {
            if (!wantBoxes) return;
            if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
            const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            boxes.push([x0, y0, z0, x1, y1, z1, mi]);
        }
        // collision triangles (sloped ceilings): x y z three times and the material index
        function ctri(a, b, c, type, room) {
            if (!wantBoxes) return; const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            colTris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], mi);
        }
        // a quad whose face looks towards `toward` (the winding is chosen for it)
        // (corners that fall together, as at the foot of a gable end, make it a triangle; the facing is worked out from all the corners)
        function quadToward(kind, tex, a, b, c, d, toward, col) {
            const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7 && Math.abs(p[2] - q[2]) < 1e-7;
            const pts = []; [a, b, c, d].forEach(p => { if (!pts.length || !same(pts[pts.length - 1], p)) pts.push(p); }); if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
            if (pts.length < 3) return;
            let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;                                                        // Newell's normal
            for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); cx += p[0]; cy += p[1]; cz += p[2]; }
            if (Math.hypot(nx, ny, nz) < 1e-10) return; cx /= pts.length; cy /= pts.length; cz /= pts.length;
            if (nx * (toward[0] - cx) + ny * (toward[1] - cy) + nz * (toward[2] - cz) < 0) pts.reverse();
            if (pts.length === 3) emitTri(kind, 'int', tex, pts[0], pts[1], pts[2]); else emitQuad(kind, 'int', tex, false, pts[0], pts[1], pts[2], pts[3]);
            if (col) { ctri(pts[0], pts[1], pts[2], col, 0); if (pts.length === 4) ctri(pts[0], pts[2], pts[3], col, 0); }
        }
        // a box turned about Z: centre cx cy, half length hu along the angle, half width hn, z0..z1 (all six faces, or no top when noTop)
        function obox(kind, tex, cx, cy, hu, hn, z0, z1, ang, noTop) {
            const c = Math.cos(ang), s2 = Math.sin(ang), P = (a, b, z) => [cx + a * hu * c - b * hn * s2, cy + a * hu * s2 + b * hn * c, z], mid = [cx, cy, (z0 + z1) / 2];
            const q = (p0, p1, p2, p3) => quadToward(kind, tex, p0, p1, p2, p3, [mid[0] + (p0[0] + p2[0] - 2 * mid[0]) * 4, mid[1] + (p0[1] + p2[1] - 2 * mid[1]) * 4, mid[2] + (p0[2] + p2[2] - 2 * mid[2]) * 4]);
            q(P(-1, -1, z0), P(1, -1, z0), P(1, 1, z0), P(-1, 1, z0)); if (!noTop) q(P(-1, -1, z1), P(1, -1, z1), P(1, 1, z1), P(-1, 1, z1));
            q(P(-1, -1, z0), P(1, -1, z0), P(1, -1, z1), P(-1, -1, z1)); q(P(-1, 1, z0), P(1, 1, z0), P(1, 1, z1), P(-1, 1, z1));
            q(P(-1, -1, z0), P(-1, 1, z0), P(-1, 1, z1), P(-1, -1, z1)); q(P(1, -1, z0), P(1, 1, z0), P(1, 1, z1), P(1, -1, z1));
        }
        // a collision box that is turned about Z (the ones the user draws): the first six numbers are the box around it, the eighth says how it really stands
        function cboxO(cx, cy, z0, z1, hu, hn, yaw, type, room, id) {
            if (!wantBoxes) return;
            if (hu < 5e-5 || hn < 5e-5 || z1 - z0 < 1e-4) return;
            const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            const c = Math.cos(yaw), s = Math.sin(yaw), square = Math.abs(s) < 1e-9 || Math.abs(c) < 1e-9;
            const ex = Math.abs(c) * hu + Math.abs(s) * hn, ey = Math.abs(s) * hu + Math.abs(c) * hn;
            boxes.push([cx - ex, cy - ey, z0, cx + ex, cy + ey, z1, mi, square ? { user: id } : { user: id, cx, cy, hu, hn, yaw }]);          // (square to the grid: the box around it is the box)
        }

        // ---------------- region, floors, ceiling ----------------
        const fx = [], fy = [];
        (S.floors || []).forEach(f => { fx.push(f.r[0], f.r[2]); fy.push(f.r[1], f.r[3]); });
        const g = regionGrid(S, fx, fy);
        const inRegion = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
        const floorTexAt = (cx, cy) => { let t = D.floor; (S.floors || []).forEach(f => { if (cx > f.r[0] && cx < f.r[2] && cy > f.r[1] && cy < f.r[3]) t = f.tex; }); return t; };
        // rooms with a shaped ceiling (vaulted, barrel, tray, shed): their cells get no flat ceiling; the last such room over a cell owns it
        const styled = (S.ops || []).map((o, i) => ({ o, i })).filter(x => x.o.op === 'add' && x.o.ceil && x.o.ceil.shape && x.o.ceil.shape !== 'flat' && (+x.o.ceil.rise || 0) > 0.01);
        const ownerAt = (cx, cy) => { let w = -1; styled.forEach(x => { const r = x.o.r; if (cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]) w = x.i; }); return w; };
        {
            const cells = [], used = [];
            const keyAt = (cx, cy) => floorTexAt(cx, cy) + '|' + ownerAt(cx, cy);
            for (let i = 0; i < g.nx; i++) { used.push(new Array(g.ny).fill(false)); for (let j = 0; j < g.ny; j++) if (g.mask[i][j]) cells.push([i, j, keyAt((g.X[i] + g.X[i + 1]) / 2, (g.Y[j] + g.Y[j + 1]) / 2)]); }
            const texOf = (i, j) => g.mask[i][j] ? keyAt((g.X[i] + g.X[i + 1]) / 2, (g.Y[j] + g.Y[j + 1]) / 2) : null;
            cells.forEach(c => {
                const i = c[0], j = c[1]; if (used[i][j]) return; const tex = c[2];
                let i1 = i + 1; while (i1 < g.nx && !used[i1][j] && texOf(i1, j) === tex) i1++;
                let j1 = j + 1; for (; j1 < g.ny; j1++) { let ok = true; for (let x = i; x < i1; x++) if (used[x][j1] || texOf(x, j1) !== tex) { ok = false; break; } if (!ok) break; }
                for (let x = i; x < i1; x++) for (let y = j; y < j1; y++) used[x][y] = true;
                const x0 = g.X[i], x1 = g.X[i1], y0 = g.Y[j], y1 = g.Y[j1], ftex = tex.split('|')[0], own = +tex.split('|')[1];
                pq('floor', 'int', ftex, false, 'z', 0, x0, x1, y0, y1, 1);
                if (own < 0) { pq('roof', 'int', D.ceiling, false, 'z', H, x0, x1, y0, y1, -1); cbox(x0, y0, H, x1, y1, H + 0.1, 101, 0); }
                cbox(x0, y0, -0.35, x1, y1, 0, TEX.colType(ftex), 1);
            });
        }

        // ---------------- walls around the region ----------------
        const segs = boundary(g);
        const entranceOpen = (S.openings || []).find(o => o.entrance);
        (S.openings || []).forEach(op => {
            let best = null, bo = 0;
            segs.forEach(sg => {
                if (sg.o !== op.o || Math.abs(sg.c - op.c) > 0.3) return;
                const ov = Math.min(sg.u1, op.u1) - Math.max(sg.u0, op.u0); if (ov > bo + 1e-9 && ov > 0.04) { bo = ov; best = sg; }
            });
            if (best) best.ops.push({ u0: Math.max(op.u0, best.u0), u1: Math.min(op.u1, best.u1), z0: op.z0, z1: op.z1, type: op.type, id: op.id, entrance: !!op.entrance });
        });

        // cutters the user placed (imported-model projects) also open the interior walls they pass through
        const spans = [];
        const fitCut = M.FitModels ? M.FitModels.cutters(project) : [];                                    // placed window and door models (Models tool): they open the walls too
        (((project.import && project.import.cutters) || []).concat(fitCut)).forEach(k => {
            const q = (((k.yaw * 180 / Math.PI) % 360) + 360) % 360, r90 = q % 90; if (Math.min(r90, 90 - r90) > (k.face ? 6 : 1.5)) return;      // faces of the model can be a few degrees off the grid
            const horiz = Math.round(q / 90) % 2 === 0, cu = horiz ? k.cx : k.cy, cn = horiz ? k.cy : k.cx;
            const type = k.face ? k.type : (k.type === 'arch' ? 'arch' : ((k.type === 'window' || (k.type === 'door' && k.zb > 0.3)) ? 'window' : 'door'));
            // (a door with a frame that is bigger than its opening: the walls open to the frame, which is where the model's wall is cut out to as well)
            const fe = M.ImportModel && M.ImportModel.doorFrameExtent ? M.ImportModel.doorFrameExtent(k) : null, ju = fe ? fe.cu : k.w / 2, zTop = fe ? fe.ct : k.zb + k.h;
            spans.push({ o: horiz ? 'H' : 'V', u0: cu - ju, u1: cu + ju, n0: cn - k.d / 2, n1: cn + k.d / 2, z0: Math.max(0, k.zb), z1: Math.min(H, zTop), type, id: 'cut' + k.id, face: !!k.face });
        });
        spans.forEach(sp => segs.forEach(sg => {
            if (sg.o !== sp.o || sg.c < sp.n0 - 0.03 || sg.c > sp.n1 + 0.03) return;
            const u0 = Math.max(sp.u0, sg.u0), u1 = Math.min(sp.u1, sg.u1); if (u1 - u0 < 0.04 || sp.z1 - sp.z0 < 0.1) return;
            sg.ops.push({ u0, u1, z0: sp.z0, z1: sp.z1, type: sp.type, id: sp.id, entrance: false, face: sp.face });
        }));

        // Wall thickness (into the room): things of the building stick through the wall (frames and vents reach 5 to 10 cm past the wall surface into the room), so the
        // inner face of every wall moves `T` into the room, sg.ci. At a corner of the room the two walls meet at their moved faces: both end T shorter; round a
        // corner that sticks into the room they end T longer.
        const T = Math.max(0, Math.min(0.5, +cfg.wallThick || 0)), ciOf = (sg) => sg.ci != null ? sg.ci : sg.c;
        // The thickness only goes into the room: with one set, nothing of a wall (collision, sides of openings, portals) reaches past the room edge to the outside,
        // which is the building's own wall. Without one, the old "wall depth" still reaches out that far.
        const outD = T > 0.0005 ? 0 : depth, ext0 = T > 0.0005 ? T : depth;
        if (T > 0.0005) {
            const vk = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4), endsAt = new Map(), endKey = (sg, e) => { const u = e ? sg.u1 : sg.u0; return sg.o === 'H' ? vk(u, sg.c) : vk(sg.c, u); };
            segs.forEach(sg => [0, 1].forEach(e => { const k = endKey(sg, e); let l = endsAt.get(k); if (!l) endsAt.set(k, l = []); l.push({ sg, end: e }); }));
            const moves = [];
            segs.forEach(sg => {
                sg.ci = sg.c + sg.inward * T;
                [0, 1].forEach(e => {
                    const here = endsAt.get(endKey(sg, e)), perp = here.filter(o => o.sg.o !== sg.o); if (perp.length !== 1 || here.some(o => o.sg !== sg && o.sg.o === sg.o)) return;
                    const B = perp[0].sg, dB = perp[0].end === 0 ? 1 : -1, dA = e ? 1 : -1, sA = sg.inward, sB = B.inward;
                    if (dB === sA && sB === -dA) moves.push([sg, e, -T]); else if (dB === -sA && sB === dA) moves.push([sg, e, T]);
                });
            });
            moves.forEach(m => { if (m[1]) m[0].u1 += m[2]; else m[0].u0 -= m[2]; });
        }
        // a piece of wall: inner face over [u0,u1] x [z0,z1]; collision box reaches `depth` outward and `ext` past the ends
        // a board along the inside face of a wall: u0..u1, z0..z1, standing d into the room; at the ends of the wall it reaches d further, so corners close
        function board(sg, u0, u1, z0, z1, d, tex) {
            const ci = ciOf(sg), e = ci + sg.inward * d, eLo = Math.abs(u0 - sg.u0) < 1e-6 ? d : 0, eHi = Math.abs(u1 - sg.u1) < 1e-6 ? d : 0;
            if (u1 - u0 < 0.02) return;
            if (sg.o === 'H') box('wall', 'int', tex, u0 - eLo, Math.min(ci, e), z0, u1 + eHi, Math.max(ci, e), z1); else box('wall', 'int', tex, Math.min(ci, e), u0 - eLo, z0, Math.max(ci, e), u1 + eHi, z1);
        }
        function wallPiece(sg, u0, u1, z0, z1, extLo, extHi) {
            if (u1 - u0 < 1e-5 || z1 - z0 < 1e-5) return;
            if (SK.on && z0 < 1e-4 && z1 > SK.h) board(sg, u0, u1, 0, Math.min(SK.h, z1), SK.d, skTex);                     // skirting (also under windows)
            if (CR.on && z1 > H - 1e-4 && H - z0 > CR.h) board(sg, u0, u1, H - CR.h, H, CR.d, crTex);                      // crown moulding (also over doors)
            const tex = sg.tex || D.wallInt, ci = ciOf(sg);
            // (walls = 'skin' has no wall faces of its own, but still the collision: the building's collision is cleared out of the rooms, so the walls need it from here)
            if (!skin) { if (sg.o === 'H') pq('wall', 'int', tex, false, 'y', ci, z0, z1, u0, u1, sg.inward); else pq('wall', 'int', tex, false, 'x', ci, u0, u1, z0, z1, sg.inward); }
            const out = sg.c - sg.inward * outD, o0 = Math.min(ci, out), o1 = Math.max(ci, out), a = u0 - extLo, b = u1 + extHi;
            if (sg.o === 'H') cbox(a, o0, z0, b, o1, z1, TEX.colType(tex), 0); else cbox(o0, a, z0, o1, b, z1, TEX.colType(tex), 0);
        }
        function revealQuad(sg, plane, f, a0, a1, z0, z1, sign) {
            // plane: 'u' jamb at u = f (normal along the wall line), 'z' head/sill at z = f
            const ci = ciOf(sg), out = sg.c - sg.inward * outD, o0 = Math.min(ci, out), o1 = Math.max(ci, out);
            if (plane === 'u') { if (sg.o === 'H') pq('wall', 'int', D.trim, false, 'x', f, o0, o1, z0, z1, sign); else pq('wall', 'int', D.trim, false, 'y', f, z0, z1, o0, o1, sign); }
            else { if (sg.o === 'H') pq('wall', 'int', D.trim, false, 'z', f, a0, a1, o0, o1, sign); else pq('wall', 'int', D.trim, false, 'z', f, o0, o1, a0, a1, sign); }
        }
        function casing(sg, u0, u1, z0, z1, thick, group) {
            // thin trim plates on the room side around an opening
            const cw = 0.06, e0 = ciOf(sg), e1 = e0 + sg.inward * thick;
            const plate = (a0, a1, b0, b1) => {
                if (a1 - a0 < 1e-5 || b1 - b0 < 1e-5) return;
                if (sg.o === 'H') box('wall', 'int', D.trim, a0, Math.min(e0, e1), b0, a1, Math.max(e0, e1), b1); else box('wall', 'int', D.trim, Math.min(e0, e1), a0, b0, Math.max(e0, e1), a1, b1);
            };
            plate(u0 - cw, u0, z0, z1 + cw); plate(u1, u1 + cw, z0, z1 + cw); plate(u0, u1, z1, z1 + cw); if (z0 > 0.05 && !(detailed && LK.sills)) plate(u0, u1, z0 - cw, z0);
            if (detailed) {
                // a second, thicker step on the opening's edge (a bead), so the casing has a profile instead of a flat plate
                const bw = 0.022, e2 = e0 + sg.inward * (thick + 0.012), bead = (a0, a1, b0, b1) => { if (a1 - a0 < 1e-5 || b1 - b0 < 1e-5) return; if (sg.o === 'H') box('wall', 'int', D.trim, a0, Math.min(e0, e2), b0, a1, Math.max(e0, e2), b1); else box('wall', 'int', D.trim, Math.min(e0, e2), a0, b0, Math.max(e0, e2), a1, b1); };
                bead(u0 - bw, u0, z0, z1 + bw); bead(u1, u1 + bw, z0, z1 + bw); bead(u0 - bw, u1 + bw, z1, z1 + bw);
            }
        }
        // a window board: a sill reaching into the room under the opening, with a thin apron under it
        function sill(sg, u0, u1, z0) {
            if (z0 < 0.25) return;
            const ci = ciOf(sg), out = ci + sg.inward * 0.07, ap = ci + sg.inward * 0.014, x0 = u0 - 0.06, x1 = u1 + 0.06;
            if (sg.o === 'H') { box('wall', 'int', D.trim, x0, Math.min(ci, out), z0 - 0.028, x1, Math.max(ci, out), z0); box('wall', 'int', D.trim, u0 - 0.02, Math.min(ci, ap), z0 - 0.1, u1 + 0.02, Math.max(ci, ap), z0 - 0.028); }
            else { box('wall', 'int', D.trim, Math.min(ci, out), x0, z0 - 0.028, Math.max(ci, out), x1, z0); box('wall', 'int', D.trim, Math.min(ci, ap), u0 - 0.02, z0 - 0.1, Math.max(ci, ap), u1 + 0.02, z0 - 0.028); }
        }

        segs.forEach(sg => {
            sg.ops.sort((a, b) => a.u0 - b.u0);
            let cur = sg.u0, first = true;
            sg.ops.forEach(op => {
                op.u0 = Math.max(op.u0, sg.u0); op.u1 = Math.min(op.u1, sg.u1); if (op.u1 - op.u0 < 0.02) return;          // (a wall that was made shorter at a corner keeps the part of an opening that is left)
                if (op.u0 < cur - 1e-6) return;
                wallPiece(sg, cur, op.u0, 0, H, first ? ext0 : 0, 0); first = false;
                wallPiece(sg, op.u0, op.u1, op.z1, H, 0, 0);
                if (op.z0 > 1e-4) wallPiece(sg, op.u0, op.u1, 0, op.z0, 0, 0);
                // an opening made from the model's faces has no generated trim: it is only cut through the wall (glass or the door model fill it)
                // (with a wall thickness the hole has sides, so the reveals are made for those too)
                if (!op.face || T > 0.0005) {
                    revealQuad(sg, 'u', op.u0, 0, 0, op.z0, op.z1, 1); revealQuad(sg, 'u', op.u1, 0, 0, op.z0, op.z1, -1);
                    revealQuad(sg, 'z', op.z1, op.u0, op.u1, 0, 0, -1); if (op.z0 > 1e-4) revealQuad(sg, 'z', op.z0, op.u0, op.u1, 0, 0, 1);
                    if (!op.face) casing(sg, op.u0, op.u1, op.z0, op.z1, 0.02, 'int');
                }
                if (op.type === 'window' && detailed && LK.sills && !op.face) sill(sg, op.u0, op.u1, op.z0);
                if (op.type === 'window' && !op.face) {
                    // frame, mullions and glass at the middle of the wall depth
                    const wc = sg.c - sg.inward * outD / 2 + sg.inward * T / 2, fb = 0.045, fd = 0.03, zc = (op.z0 + op.z1) / 2, uc = (op.u0 + op.u1) / 2;
                    const fbox = (a0, a1, b0, b1, h) => { if (sg.o === 'H') box('wall', 'int', D.trim, a0, wc - h, b0, a1, wc + h, b1); else box('wall', 'int', D.trim, wc - h, a0, b0, wc + h, a1, b1); };
                    fbox(op.u0, op.u0 + fb, op.z0, op.z1, fd); fbox(op.u1 - fb, op.u1, op.z0, op.z1, fd);
                    fbox(op.u0 + fb, op.u1 - fb, op.z0, op.z0 + fb, fd); fbox(op.u0 + fb, op.u1 - fb, op.z1 - fb, op.z1, fd);
                    if (op.u1 - op.u0 > 0.6) fbox(uc - 0.015, uc + 0.015, op.z0 + fb, op.z1 - fb, 0.025);
                    if (op.z1 - op.z0 > 0.7) fbox(op.u0 + fb, op.u1 - fb, zc - 0.015, zc + 0.015, 0.025);
                    const gu0 = op.u0 + fb, gu1 = op.u1 - fb, gz0 = op.z0 + fb, gz1 = op.z1 - fb;
                    if (detailed) {
                        // glazing beads: thin strips that hold the glass, on the room side of it
                        const bb = 0.014, bo = sg.inward * 0.012, bbox = (a0, a1, b0, b1) => { const c0 = wc + bo - 0.007, c1 = wc + bo + 0.007; if (sg.o === 'H') box('wall', 'int', D.trim, a0, Math.min(c0, c1), b0, a1, Math.max(c0, c1), b1); else box('wall', 'int', D.trim, Math.min(c0, c1), a0, b0, Math.max(c0, c1), a1, b1); };
                        bbox(gu0, gu0 + bb, gz0, gz1); bbox(gu1 - bb, gu1, gz0, gz1); bbox(gu0 + bb, gu1 - bb, gz0, gz0 + bb); bbox(gu0 + bb, gu1 - bb, gz1 - bb, gz1);
                    }
                    if (sg.o === 'H') { pq('glass', 'glass', 'glass', true, 'y', wc + 0.003, gz0, gz1, gu0, gu1, 1); pq('glass', 'glass', 'glass', true, 'y', wc - 0.003, gz0, gz1, gu0, gu1, -1); cbox(gu0, wc - 0.015, gz0, gu1, wc + 0.015, gz1, 112, 0); }
                    else { pq('glass', 'glass', 'glass', true, 'x', wc + 0.003, gu0, gu1, gz0, gz1, 1); pq('glass', 'glass', 'glass', true, 'x', wc - 0.003, gu0, gu1, gz0, gz1, -1); cbox(wc - 0.015, gu0, gz0, wc + 0.015, gu1, gz1, 112, 0); }
                }
                // portal to the outside
                if (exportMode) {
                    const spec = OPEN[op.type] || OPEN.window, out = -sg.inward, wm = sg.c - sg.inward * outD / 2 + sg.inward * T / 2;
                    let a, b, c, d; const U0 = op.u0, U1 = op.u1, Z0 = op.z0, Z1 = op.z1;
                    if (sg.o === 'H') { if (out < 0) { a = [U0, wm, Z0]; b = [U1, wm, Z0]; c = [U1, wm, Z1]; d = [U0, wm, Z1]; } else { a = [U1, wm, Z0]; b = [U0, wm, Z0]; c = [U0, wm, Z1]; d = [U1, wm, Z1]; } }
                    else { if (out < 0) { a = [wm, U1, Z0]; b = [wm, U0, Z0]; c = [wm, U0, Z1]; d = [wm, U1, Z1]; } else { a = [wm, U0, Z0]; b = [wm, U1, Z0]; c = [wm, U1, Z1]; d = [wm, U0, Z1]; } }
                    const pr = { flags: spec.portal, corners: [].concat(a, b, c, d) };
                    if (op.type === 'window') portals.push(pr); else if (op.entrance) portals.unshift(pr); else portals.push(pr);
                }
                cur = op.u1;
            });
            wallPiece(sg, cur, sg.u1, 0, H, first ? ext0 : 0, ext0);
        });

        // ---------------- the building's own walls, turned inwards (walls = 'skin') ----------------
        if (skin && M.ImportModel && M.ImportModel.wallFaces) {
            const inRoom = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
            let n = 0;
            M.ImportModel.wallFaces().forEach(f => {
                const nh = Math.hypot(f.n[0], f.n[1]); if (nh < 0.5 || f.c[2] < -0.3 || f.c[2] > H + 0.3) return; const nx = f.n[0] / nh, ny = f.n[1] / nh;
                // the room is behind the face (a model's faces look outwards) and nothing of the room is in front of it
                let behind = false; for (const d of [0.05, 0.12, 0.25]) if (inRoom(f.c[0] - nx * d, f.c[1] - ny * d)) { behind = true; break; }
                if (!behind || inRoom(f.c[0] + nx * 0.1, f.c[1] + ny * 0.1)) return;
                const sx = -nx * T, sy = -ny * T;                                                                                    // wall thickness: moved into the room
                emitTri('wall', 'int', D.wallInt, [f.p[0] + sx, f.p[1] + sy, f.p[2]], [f.p[6] + sx, f.p[7] + sy, f.p[8]], [f.p[3] + sx, f.p[4] + sy, f.p[5]]); n++;        // turned round: it looks into the room
            });
            stats.skin = n;
        }

        // ---------------- partition walls ----------------
        (S.parts || []).forEach(pt => {
            const pops = (pt.open || []).slice();
            spans.forEach(sp => { if (sp.o !== pt.o || pt.c < sp.n0 - 0.03 || pt.c > sp.n1 + 0.03) return; const u0 = Math.max(sp.u0, pt.u0), u1 = Math.min(sp.u1, pt.u1); if (u1 - u0 >= 0.04 && sp.z1 - sp.z0 >= 0.1) pops.push({ u0, u1, z0: sp.z0, z1: sp.z1 }); });
            const ops = pops.sort((a, b) => a.u0 - b.u0), tex = pt.texA || D.wallInt, texB = pt.texB || D.wallInt;
            const lo = pt.c - PT / 2, hi = pt.c + PT / 2, ctype = TEX.colType(tex);
            const strip = (u0, u1, z0, z1, d, t) => { if (u1 - u0 < 0.02) return; if (pt.o === 'H') { box('wall', 'int', t, u0, hi, z0, u1, hi + d, z1); box('wall', 'int', t, u0, lo - d, z0, u1, lo, z1); } else { box('wall', 'int', t, hi, u0, z0, hi + d, u1, z1); box('wall', 'int', t, lo - d, u0, z0, lo, u1, z1); } };
            const piece = (u0, u1, z0, z1) => {
                if (u1 - u0 < 1e-5 || z1 - z0 < 1e-5) return;
                if (pt.o === 'H') { pq('wall', 'int', texB, false, 'y', hi, z0, z1, u0, u1, 1); pq('wall', 'int', tex, false, 'y', lo, z0, z1, u0, u1, -1); cbox(u0, lo, z0, u1, hi, z1, ctype, 0); }
                else { pq('wall', 'int', texB, false, 'x', hi, u0, u1, z0, z1, 1); pq('wall', 'int', tex, false, 'x', lo, u0, u1, z0, z1, -1); cbox(lo, u0, z0, hi, u1, z1, ctype, 0); }
                if (SK.on && z0 < 1e-4 && z1 > SK.h) strip(u0, u1, 0, SK.h, SK.d, skTex);
                if (CR.on && z1 > H - 1e-4 && H - z0 > CR.h) strip(u0, u1, H - CR.h, H, CR.d, crTex);
            };
            const cap = (u, sign) => { if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'x', u, lo, hi, 0, H, sign); else pq('wall', 'int', D.trim, false, 'y', u, 0, H, lo, hi, sign); };
            const jamb = (u, sign, z0, z1) => { if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'x', u, lo, hi, z0, z1, sign); else pq('wall', 'int', D.trim, false, 'y', u, z0, z1, lo, hi, sign); };
            const headsill = (z, u0, u1, sign) => { if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'z', z, u0, u1, lo, hi, sign); else pq('wall', 'int', D.trim, false, 'z', z, lo, hi, u0, u1, sign); };
            let cur = pt.u0; cap(pt.u0, -1); cap(pt.u1, 1);
            ops.forEach(op => {
                if (op.u0 < cur - 1e-6) return;
                piece(cur, op.u0, 0, H); piece(op.u0, op.u1, op.z1, H); if (op.z0 > 1e-4) piece(op.u0, op.u1, 0, op.z0);
                jamb(op.u0, 1, op.z0, op.z1); jamb(op.u1, -1, op.z0, op.z1); headsill(op.z1, op.u0, op.u1, -1); if (op.z0 > 1e-4) headsill(op.z0, op.u0, op.u1, 1);
                cur = op.u1;
            });
            piece(cur, pt.u1, 0, H);
        });

        // ---------------- shaped ceilings, ceiling beams, columns and placed beams ----------------
        // the height a shaped ceiling adds over H across its span (t = 0..1): gable (two slopes), barrel (a circular arc), shed (one slope)
        const profile = (shape, rise, span) => {
            if (shape === 'gable') return (t) => rise * (1 - Math.abs(2 * t - 1));
            if (shape === 'shed') return (t) => rise * t;
            if (shape === 'barrel') { const R2 = (span * span / 4 + rise * rise) / (2 * rise); return (t) => Math.max(0, Math.sqrt(Math.max(0, R2 * R2 - Math.pow(t * span - span / 2, 2))) - (R2 - rise)); }
            return () => 0;
        };
        const samples = (shape) => shape === 'barrel' ? Array.from({ length: 17 }, (_, k) => k / 16) : (shape === 'gable' ? [0, 0.5, 1] : [0, 1]);
        const ceilingAt = [];          // [{ r, shape, alongX, h(x, y) }]: for columns and beams to reach the ceiling there
        const Tc = Math.max(0, Math.min(0.5, +cfg.wallThick || 0));
        styled.forEach(({ o, i }) => {
            const C = o.ceil, shape = C.shape, rise = Math.max(0.05, Math.min(8, +C.rise || 1)), ctex = (C.tex && TEX.byId[C.tex]) ? C.tex : D.ceiling;
            const r = [o.r[0] + Tc, o.r[1] + Tc, o.r[2] - Tc, o.r[3] - Tc]; if (r[2] - r[0] < 0.3 || r[3] - r[1] < 0.3) return;
            const w = r[2] - r[0], d = r[3] - r[1], alongX = C.axis === 'x' ? true : (C.axis === 'y' ? false : w >= d);       // the ridge runs along the longer side unless set
            // (u along the ridge, v across the span) -> world
            const u0 = alongX ? r[0] : r[1], u1 = alongX ? r[2] : r[3], v0 = alongX ? r[1] : r[0], v1 = alongX ? r[3] : r[2], span = v1 - v0;
            const W = (u, v, z) => alongX ? [u, v, z] : [v, u, z], inside = W((u0 + u1) / 2, (v0 + v1) / 2, H - 1.2);
            if (shape === 'tray') {
                const m = Math.max(0.1, Math.min(Math.min(w, d) / 2 - 0.15, +C.margin || 0.45)), ix0 = r[0] + m, iy0 = r[1] + m, ix1 = r[2] - m, iy1 = r[3] - m, top = H + rise;
                // the flat border at H, the raised middle, and the four step walls between them
                pq('roof', 'int', ctex, false, 'z', H, r[0], r[2], r[1], iy0, -1); pq('roof', 'int', ctex, false, 'z', H, r[0], r[2], iy1, r[3], -1);
                pq('roof', 'int', ctex, false, 'z', H, r[0], ix0, iy0, iy1, -1); pq('roof', 'int', ctex, false, 'z', H, ix1, r[2], iy0, iy1, -1);
                pq('roof', 'int', ctex, false, 'z', top, ix0, ix1, iy0, iy1, -1);
                pq('wall', 'int', ctex, false, 'x', ix0, iy0, iy1, H, top, 1); pq('wall', 'int', ctex, false, 'x', ix1, iy0, iy1, H, top, -1);
                pq('wall', 'int', ctex, false, 'y', iy0, H, top, ix0, ix1, 1); pq('wall', 'int', ctex, false, 'y', iy1, H, top, ix0, ix1, -1);
                cbox(r[0], r[1], H, r[2], r[3], H + 0.1, 101, 0);
                ceilingAt.push({ r, h: (x, y) => (x > ix0 && x < ix1 && y > iy0 && y < iy1) ? rise : 0 });
            } else {
                const f = profile(shape, rise, span), ts = samples(shape), vs = ts.map(t => v0 + t * span), hs = ts.map(t => f(t));
                for (let k = 0; k + 1 < ts.length; k++) {
                    const a = W(u0, vs[k], H + hs[k]), b = W(u1, vs[k], H + hs[k]), c = W(u1, vs[k + 1], H + hs[k + 1]), e = W(u0, vs[k + 1], H + hs[k + 1]);
                    quadToward('roof', ctex, a, b, c, e, inside, 101);
                    // the two end walls between H and the ceiling (gable ends), facing into the room
                    // (it reaches 1 cm down over the top of the wall below, so no crack shows along the joint)
                    [u0, u1].forEach(ue => { const zb = H - 0.01, p0 = W(ue, vs[k], zb), p1 = W(ue, vs[k + 1], zb), p2 = W(ue, vs[k + 1], H + hs[k + 1]), p3 = W(ue, vs[k], H + hs[k]); if (hs[k] + hs[k + 1] > 1e-4) quadToward('wall', ctex, p0, p1, p2, p3, inside, 101); });
                }
                // a shed ceiling's high side: a wall from H up to the top along the ridge
                if (shape === 'shed') quadToward('wall', ctex, W(u0, v1, H - 0.01), W(u1, v1, H - 0.01), W(u1, v1, H + rise), W(u0, v1, H + rise), inside, 101);
                ceilingAt.push({ r, h: (x, y) => { const v = alongX ? y : x; return f(Math.max(0, Math.min(1, (v - v0) / span))); } });
                // beams: across = ribs / rafters following the ceiling; along = purlins at heights across the span (and a ridge beam for a gable)
                const B = C.beams || {};
                if (B.on) {
                    const bw = Math.max(0.04, Math.min(0.6, +B.w || 0.15)), bd = Math.max(0.03, Math.min(0.8, +B.d || 0.18)), btex = (B.tex && TEX.byId[B.tex]) ? B.tex : 'wood_dark', n = Math.max(1, Math.min(60, Math.round(+B.n || 4)));
                    if (B.dir !== 'along') for (let q = 1; q <= n; q++) {
                        const uc = u0 + (u1 - u0) * q / (n + 1);
                        for (let k = 0; k + 1 < ts.length; k++) {
                            const za = H + hs[k], zb = H + hs[k + 1], la = [uc - bw / 2, uc + bw / 2];
                            // the underside of the rib, d below the ceiling, and its two sides
                            const lo = (u, kk) => W(u, vs[kk], H + hs[kk] - bd), hi = (u, kk) => W(u, vs[kk], H + hs[kk] + 0.005);
                            quadToward('roof', btex, lo(la[0], k), lo(la[1], k), lo(la[1], k + 1), lo(la[0], k + 1), [inside[0], inside[1], inside[2] - 5]);
                            la.forEach((u, si) => { const side = W(u + (si ? 5 : -5), (vs[k] + vs[k + 1]) / 2, (za + zb) / 2 - bd / 2); quadToward('roof', btex, lo(u, k), lo(u, k + 1), hi(u, k + 1), hi(u, k), side); });
                        }
                    }
                    if (B.dir === 'along' || B.dir === 'grid') {
                        const vsel = shape === 'gable' ? [0.5].concat(Array.from({ length: n }, (_, q) => (q + 1) / (n + 1) / 2)).concat(Array.from({ length: n }, (_, q) => 0.5 + (q + 1) / (n + 1) / 2)) : Array.from({ length: n }, (_, q) => (q + 1) / (n + 1));
                        vsel.forEach(t => { const vc = v0 + t * span, zt = H + f(t); const c0 = W((u0 + u1) / 2, vc, 0); obox('roof', btex, c0[0], c0[1], alongX ? (u1 - u0) / 2 : bw / 2, alongX ? bw / 2 : (u1 - u0) / 2, zt - bd, zt, 0, true); });
                    }
                }
            }
        });
        // ceiling beams of flat (and tray) rooms: across, along or a grid, under the ceiling
        (S.ops || []).forEach(o => {
            if (o.op !== 'add' || !o.ceil || !o.ceil.beams || !o.ceil.beams.on) return; const shape = o.ceil.shape || 'flat';
            if (shape !== 'flat' && shape !== 'tray' && (+o.ceil.rise || 0) > 0.01) return;          // (vaulted rooms have their own ribs and purlins above)
            const B = o.ceil.beams, r = [o.r[0] + Tc, o.r[1] + Tc, o.r[2] - Tc, o.r[3] - Tc], w = r[2] - r[0], d = r[3] - r[1]; if (w < 0.3 || d < 0.3) return;
            const bw = Math.max(0.04, Math.min(0.6, +B.w || 0.15)), bd = Math.max(0.03, Math.min(0.8, +B.d || 0.18)), btex = (B.tex && TEX.byId[B.tex]) ? B.tex : 'wood_dark', n = Math.max(1, Math.min(60, Math.round(+B.n || 4)));
            const alongX = o.ceil.axis === 'x' ? true : (o.ceil.axis === 'y' ? false : w >= d);
            // across: beams spanning the short way, spaced along the long way (across the ridge direction)
            const across = () => { for (let q = 1; q <= n; q++) { if (alongX) { const x = r[0] + w * q / (n + 1); box('roof', 'int', btex, x - bw / 2, r[1], H - bd, x + bw / 2, r[3], H); } else { const y = r[1] + d * q / (n + 1); box('roof', 'int', btex, r[0], y - bw / 2, H - bd, r[2], y + bw / 2, H); } } };
            const along = () => { for (let q = 1; q <= n; q++) { if (alongX) { const y = r[1] + d * q / (n + 1); box('roof', 'int', btex, r[0], y - bw / 2, H - bd, r[2], y + bw / 2, H); } else { const x = r[0] + w * q / (n + 1); box('roof', 'int', btex, x - bw / 2, r[1], H - bd, x + bw / 2, r[3], H); } } };
            if (B.dir === 'along') along(); else if (B.dir === 'grid') { across(); along(); } else across();
        });
        // how high the ceiling is over a point (H, or a shaped room's ceiling there)
        const ceilZ = (x, y) => { let z = H; ceilingAt.forEach(c => { if (x > c.r[0] - 1e-6 && x < c.r[2] + 1e-6 && y > c.r[1] - 1e-6 && y < c.r[3] + 1e-6) z = Math.max(z, H + c.h(x, y)); }); return z; };
        // columns: square or round posts from the floor to the ceiling, with a base and a capital when asked for
        (S.columns || []).forEach(cl => {
            const sz = Math.max(0.08, Math.min(2, +cl.w || 0.3)), h2 = sz / 2, tex = (cl.tex && TEX.byId[cl.tex]) ? cl.tex : D.trim, top = cl.h ? Math.min(+cl.h, ceilZ(cl.x, cl.y)) : ceilZ(cl.x, cl.y), x = cl.x, y = cl.y;
            const bt = cl.trim !== false ? 0.12 : 0, bo = cl.trim !== false ? 0.035 : 0;
            if (cl.shape === 'round') {
                const N = 16, P = (k, rad, z) => [x + Math.cos(k / N * Math.PI * 2) * rad, y + Math.sin(k / N * Math.PI * 2) * rad, z];
                for (let k = 0; k < N; k++) quadToward('wall', tex, P(k, h2, bt), P(k + 1, h2, bt), P(k + 1, h2, top - bt), P(k, h2, top - bt), [x + Math.cos((k + 0.5) / N * Math.PI * 2) * 9, y + Math.sin((k + 0.5) / N * Math.PI * 2) * 9, top / 2]);
                if (bt) { box('wall', 'int', tex, x - h2 - bo, y - h2 - bo, 0, x + h2 + bo, y + h2 + bo, bt); box('wall', 'int', tex, x - h2 - bo, y - h2 - bo, top - bt, x + h2 + bo, y + h2 + bo, top); }
            } else {
                box('wall', 'int', tex, x - h2, y - h2, bt, x + h2, y + h2, top - bt);
                if (bt) { box('wall', 'int', tex, x - h2 - bo, y - h2 - bo, 0, x + h2 + bo, y + h2 + bo, bt); box('wall', 'int', tex, x - h2 - bo, y - h2 - bo, top - bt, x + h2 + bo, y + h2 + bo, top); }
            }
            cbox(x - h2 - bo, y - h2 - bo, 0, x + h2 + bo, y + h2 + bo, top, TEX.colType(tex), 0);
        });
        // placed beams: from a to b, their top at the ceiling (or at a height you give), any angle on the plan
        (S.beams || []).forEach(bm => {
            const ax = bm.a[0], ay = bm.a[1], bx = bm.b[0], by = bm.b[1], len = Math.hypot(bx - ax, by - ay); if (len < 0.05) return;
            const bw = Math.max(0.04, Math.min(1, +bm.w || 0.2)), bd = Math.max(0.04, Math.min(2, +bm.d || 0.25)), tex = (bm.tex && TEX.byId[bm.tex]) ? bm.tex : 'wood_dark';
            const cx = (ax + bx) / 2, cy = (ay + by) / 2, top = bm.z ? +bm.z : Math.min(ceilZ(ax, ay), ceilZ(bx, by), ceilZ(cx, cy)), ang = Math.atan2(by - ay, bx - ax);
            obox('roof', tex, cx, cy, len / 2, bw / 2, top - bd, top, ang, top >= H - 1e-4);
            if (top - bd < 2.3) cboxO(cx, cy, top - bd, top, len / 2, bw / 2, ang, TEX.colType(tex), 0, 'beam' + (bm.id || ''));          // (low enough to walk into: it stops you)
        });
        stats.columns = (S.columns || []).length; stats.beams = (S.beams || []).length; stats.vaults = styled.length;

        // ---------------- openings cut out of the model's faces: glass in windows, a frame around windows and doors ----------------
        // An oriented box of a frame: u = ua..ub across the opening (from its centre), z = za..zb, bd deep, centred dn along the outward normal.
        const frameBar = (k, dn, bd, ua, ub, za, zb) => {
            const ux = Math.cos(k.yaw), uy = Math.sin(k.yaw), nx = -uy, ny = ux, uc = (ua + ub) / 2, hu = (ub - ua) / 2, hn = bd / 2, cx0 = k.cx + uc * ux + dn * nx, cy0 = k.cy + uc * uy + dn * ny;
            if (hu < 1e-4 || zb - za < 1e-4) return;
            const P = (su, sn2, z) => [cx0 + su * hu * ux + sn2 * hn * nx, cy0 + su * hu * uy + sn2 * hn * ny, z], T = D.trim;
            emitQuad('wall', 'int', T, false, P(1, -1, za), P(1, 1, za), P(1, 1, zb), P(1, -1, zb));      // +u
            emitQuad('wall', 'int', T, false, P(-1, 1, za), P(-1, -1, za), P(-1, -1, zb), P(-1, 1, zb));  // -u
            emitQuad('wall', 'int', T, false, P(1, 1, za), P(-1, 1, za), P(-1, 1, zb), P(1, 1, zb));      // outside
            emitQuad('wall', 'int', T, false, P(-1, -1, za), P(1, -1, za), P(1, -1, zb), P(-1, -1, zb));  // inside
            emitQuad('wall', 'int', T, false, P(-1, -1, zb), P(1, -1, zb), P(1, 1, zb), P(-1, 1, zb));    // top
            emitQuad('wall', 'int', T, false, P(-1, -1, za), P(-1, 1, za), P(1, 1, za), P(1, -1, za));    // bottom
        };
        // collision of a box like that, where the opening is near square to the grid (the collision boxes are axis aligned)
        const frameCol = (k, dn, bd, ua, ub, za, zb, type) => {
            const q = (((k.yaw * 180 / Math.PI) % 360) + 360) % 360, r90 = q % 90; if (Math.min(r90, 90 - r90) > 6) return;
            const horiz = Math.round(q / 90) % 2 === 0, c = Math.cos(k.yaw), s = Math.sin(k.yaw), sg = (horiz ? c : s) < 0 ? -1 : 1, u0 = Math.min(sg * ua, sg * ub), u1 = Math.max(sg * ua, sg * ub);
            if (horiz) { const cn = k.cy + c * dn; cbox(k.cx + u0, cn - bd / 2, za, k.cx + u1, cn + bd / 2, zb, type, 0); } else { const cn = k.cx - s * dn; cbox(cn - bd / 2, k.cy + u0, za, cn + bd / 2, k.cy + u1, zb, type, 0); }
        };
        (((project.import && project.import.cutters) || []).concat(fitCut)).forEach(k => {
            if (!k.face) return;
            // a placed model brings its own frame, glass and door; the pane of a window still stops you (collision across the opening)
            if (k.fit) { if (k.type === 'window' && !k.noglass) frameCol(k, 0, 0.03, -k.w / 2, k.w / 2, k.zb, k.zb + k.h, 112); return; }
            const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), dd = M.ImportModel.depthOf(k), hw = k.w / 2, zt = k.zb + k.h;
            // Gaps in the model's wall beside the cut-out (see-through slits the cut-out faces used to cover) are closed with trim boxes that reach the wall.
            const IMg = M.ImportModel; let gp = k.fill !== false && (k.type === 'window' || k.type === 'door') && IMg && IMg.gapAround ? IMg.gapAround(k) : null;
            // the model's wall is cut out to a door's frame when that is bigger than the opening, so that much of a gap is gone (the frame covers the rest)
            const fex = IMg && IMg.doorFrameExtent ? IMg.doorFrameExtent(k) : null;
            if (gp && fex) { const ex = Math.max(0, fex.cu - fex.hw), et = Math.max(0, fex.ct - fex.zt); gp = { l: Math.max(0, gp.l - ex), r: Math.max(0, gp.r - ex), b: gp.b, t: Math.max(0, gp.t - et), dw: gp.dw }; if (!gp.l && !gp.r && !gp.b && !gp.t) gp = null; }
            if (gp) {
                const lo = Math.min(dd - 0.035, gp.dw - 0.02), hi = Math.max(dd + 0.035, gp.dw + 0.02), dnc = (lo + hi) / 2, bdf = hi - lo, z0 = k.zb - gp.b, z1 = zt + gp.t;
                if (gp.l) frameBar(k, dnc, bdf, -hw - gp.l, -hw, z0, z1);
                if (gp.r) frameBar(k, dnc, bdf, hw, hw + gp.r, z0, z1);
                if (gp.b) frameBar(k, dnc, bdf, -hw, hw, z0, k.zb);
                if (gp.t) frameBar(k, dnc, bdf, -hw, hw, zt, z1);
            }
            if (k.type === 'window') {
                // The model's window is one painted picture (frame, bars and glass together) on a single face, so cutting it out takes the frame away too.
                // A plain frame is put back inside the opening, at the depth of the frame: bars all round, and a cross when asked for.
                // (k.vframe: the model's own frame is used: nothing is built, the glass goes behind what the model has left around the opening)
                const framed = k.frame !== false && !k.vframe, bw = k.bw || 0.055, bd = 0.07;
                if (framed) {
                    frameBar(k, dd, bd, -hw, hw, zt - bw, zt); frameBar(k, dd, bd, -hw, hw, k.zb, k.zb + bw);                                  // head and sill
                    frameBar(k, dd, bd, -hw, -hw + bw, k.zb + bw, zt - bw); frameBar(k, dd, bd, hw - bw, hw, k.zb + bw, zt - bw);                // the two sides
                    if (k.bars) {
                        if (k.w > 0.9) frameBar(k, dd, bd, -bw / 2, bw / 2, k.zb + bw, zt - bw);
                        if (k.h > 1.3) { const zm = (k.zb + zt) / 2; frameBar(k, dd, bd, -hw + bw, -bw / 2, zm - bw / 2, zm + bw / 2); frameBar(k, dd, bd, bw / 2, hw - bw, zm - bw / 2, zm + bw / 2); }
                    }
                }
                // The pane sits at the depth of the window's own frame (dd, behind the faces that were cut out) and is only as large as the frame's inner
                // opening plus 1 cm that is tucked into the bars; without a frame it is the opening plus 1 cm into the wall.
                const ov = 0.01, gu = framed ? Math.max(0.02, hw - bw + ov) : hw + ov, gz0 = framed ? k.zb + bw - ov : k.zb - ov, gz1 = framed ? zt - bw + ov : zt + ov;
                const Pt = (du, z, dn) => [k.cx + du * cs - (dn + dd) * sn, k.cy + du * sn + (dn + dd) * cs, z];
                emitQuad('glass', 'glass', 'glass', true, Pt(-gu, gz0, 0.003), Pt(-gu, gz1, 0.003), Pt(gu, gz1, 0.003), Pt(gu, gz0, 0.003));
                emitQuad('glass', 'glass', 'glass', true, Pt(-gu, gz0, -0.003), Pt(gu, gz0, -0.003), Pt(gu, gz1, -0.003), Pt(-gu, gz1, -0.003));
                frameCol(k, dd, 0.03, -hw, hw, k.zb, zt, 112);                                                                              // collision for the pane
            } else if (k.type === 'door' && k.leaf && k.frame !== false && !k.vframe) {
                // The door model keeps its own size (the game ignores the scale of an entity), so its frame is built to the door: the jambs and the head
                // run from the edges of the door out to the edges of the opening (at least bw wide, the rest is inside the wall) and close the gap.
                const IMod = M.ImportModel, dg = IMod && IMod.doorGroup ? IMod.doorGroup(k) : null; if (!dg) return;
                const bw = k.bw || 0.05, bd = 0.1, dn = dd + (k.lo || 0), dw = dg.w / 2, ju = Math.max(hw, dw + bw), dt = k.zb + dg.h, top = Math.max(zt, dt + bw), ct = TEX.colType(D.trim);
                [[-ju, -dw, k.zb, top], [dw, ju, k.zb, top], [-dw, dw, dt, top]].forEach(b => { frameBar(k, dn, bd, b[0], b[1], b[2], b[3]); frameCol(k, dn, bd, b[0], b[1], b[2], b[3], ct); });
            }
        });

        // ---------------- collision boxes the user built (Collision box tool): they only make collision, nothing is drawn ----------------
        // (a box whose centre is inside the interior belongs to its room, like the floor)
        ((project.import && project.import.cboxes) || []).forEach(k => {
            const m = COLMAT[k.mat] || COLMAT.concrete;
            cboxO(k.cx, k.cy, k.zb, k.zb + k.h, k.w / 2, k.d / 2, k.yaw || 0, m.type, inRegion(k.cx, k.cy) ? 1 : 0, k.id);
        });

        // ---------------- doors of the Window / door models tool that are made solid: a box of collision the size of the leaf ----------------
        (M.FitModels ? M.FitModels.solidBoxes(project) : []).forEach(b => cboxO(b.cx, b.cy, b.zb, b.zb + b.h, b.hu, b.hn, b.yaw, COLMAT.wood.type, inRegion(b.cx, b.cy) ? 1 : 0, b.id));          // (a doorway sits in the wall: its room is the walls' room unless its middle is inside)

        // ---------------- lights: one per ~3.5 m of every room (rooms are cut apart by partitions, doors and arches stay open) ----------------
        if (exportMode && opts.autoLights !== false) {
            const px = [], py = [];
            (S.parts || []).forEach(pt => { if (pt.o === 'H') { py.push(pt.c); px.push(pt.u0, pt.u1); } else { px.push(pt.c); py.push(pt.u0, pt.u1); } });
            const g2 = regionGrid(S, px, py), comp = [], blockedH = (i, j) => false;
            for (let i = 0; i < g2.nx; i++) comp.push(new Array(g2.ny).fill(-1));
            const blockedBetween = (i, j, i2, j2) => {
                // moving from cell (i,j) to (i2,j2): crosses a partition line?
                const vertical = i2 !== i, line = vertical ? g2.X[Math.max(i, i2)] : g2.Y[Math.max(j, j2)];
                const mid = vertical ? (g2.Y[j] + g2.Y[j + 1]) / 2 : (g2.X[i] + g2.X[i + 1]) / 2;
                return (S.parts || []).some(pt => {
                    if (vertical ? pt.o !== 'V' : pt.o !== 'H') return false;
                    if (Math.abs(pt.c - line) > PT / 2 + 0.02 || mid < pt.u0 || mid > pt.u1) return false;
                    return !(pt.open || []).some(op => mid > op.u0 && mid < op.u1);
                });
            };
            let nid = 0;
            for (let i = 0; i < g2.nx; i++) for (let j = 0; j < g2.ny; j++) {
                if (!g2.mask[i][j] || comp[i][j] >= 0) continue; const id = nid++, st = [[i, j]]; comp[i][j] = id;
                while (st.length) {
                    const [ci, cj] = st.pop();
                    [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]].forEach(n => {
                        if (n[0] < 0 || n[1] < 0 || n[0] >= g2.nx || n[1] >= g2.ny || !g2.mask[n[0]][n[1]] || comp[n[0]][n[1]] >= 0 || blockedBetween(ci, cj, n[0], n[1])) return;
                        comp[n[0]][n[1]] = id; st.push([n[0], n[1]]);
                    });
                }
            }
            const byId = new Map();
            for (let i = 0; i < g2.nx; i++) for (let j = 0; j < g2.ny; j++) if (comp[i][j] >= 0) { if (!byId.has(comp[i][j])) byId.set(comp[i][j], []); byId.get(comp[i][j]).push([i, j]); }
            byId.forEach(cs => {
                let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, area = 0;
                cs.forEach(c => { x0 = Math.min(x0, g2.X[c[0]]); x1 = Math.max(x1, g2.X[c[0] + 1]); y0 = Math.min(y0, g2.Y[c[1]]); y1 = Math.max(y1, g2.Y[c[1] + 1]); area += (g2.X[c[0] + 1] - g2.X[c[0]]) * (g2.Y[c[1] + 1] - g2.Y[c[1]]); });
                if (area < 1.0) return;
                const nx = Math.max(1, Math.round((x1 - x0) / 3.5)), ny = Math.max(1, Math.round((y1 - y0) / 3.5)), seen = new Set();
                for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
                    const cx = x0 + (a + 0.5) * (x1 - x0) / nx, cy = y0 + (b + 0.5) * (y1 - y0) / ny;
                    let best = null, bd = 1e9;
                    cs.forEach(c => { const mx = (g2.X[c[0]] + g2.X[c[0] + 1]) / 2, my = (g2.Y[c[1]] + g2.Y[c[1] + 1]) / 2, d = Math.hypot(mx - cx, my - cy); if (d < bd) { bd = d; best = [mx, my]; } });
                    const lk = best[0].toFixed(2) + ',' + best[1].toFixed(2); if (seen.has(lk)) continue; seen.add(lk);
                    lights.push({ x: best[0], y: best[1], z: H - 0.15 });
                }
            });
        }
        if (exportMode) (S.lights || []).forEach(l => lights.push({ x: l.x, y: l.y, z: H - 0.15 - (l.own && l.own.drop ? +l.own.drop : 0), own: l.own || null }));

        batches.forEach(b => { b.pos = new Float32Array(b.pos); b.nrm = new Float32Array(b.nrm); b.uv = new Float32Array(b.uv); b.idx = new Uint16Array(b.idx); });
        stats.boxes = boxes.length; stats.portals = portals.length; stats.lights = lights.length;
        const resolved = []; segs.forEach(sg => sg.ops.forEach(op => resolved.push({ o: sg.o, c: sg.c, inward: sg.inward, u0: op.u0, u1: op.u1, z0: op.z0, z1: op.z1, type: op.type, entrance: op.entrance })));
        return { batches, boxes, colTris, matList, portals, lights, entrance: null, bounds: { mn: bmn, mx: bmx }, stats, shell: { grid: g, segs, resolved } };
    }

    // the final region as a few rectangles (used to tell the patcher where the walkable interior is)
    function regionRects(shell) {
        const g = regionGrid(shell), used = [], out = [];
        for (let i = 0; i < g.nx; i++) used.push(new Array(g.ny).fill(false));
        for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
            if (!g.mask[i][j] || used[i][j]) continue;
            let i1 = i + 1; while (i1 < g.nx && g.mask[i1][j] && !used[i1][j]) i1++;
            let j1 = j + 1; for (; j1 < g.ny; j1++) { let ok = true; for (let x = i; x < i1; x++) if (!g.mask[x][j1] || used[x][j1]) { ok = false; break; } if (!ok) break; }
            for (let x = i; x < i1; x++) for (let y = j; y < j1; y++) used[x][y] = true;
            out.push([g.X[i], g.Y[j], g.X[i1], g.Y[j1]]);
        }
        return out;
    }

    M.Shell = { build, regionGrid, regionRects, boundary, OPEN, uniq };
})(window.MLO);
