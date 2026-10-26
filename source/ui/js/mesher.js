// Project (grid of cells, edge walls, stairs...) -> triangles, collision boxes, portals and lights.
// One mesher feeds both the 3D preview and the export, so what you see is what is exported.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TEX = M.TEX;
    const OPEN = {
        door: { w: 0.9, sill: 0, head: 2.1, portal: 8192 },
        window: { w: 0.8, sill: 0.9, head: 2.1, portal: 0, glass: true },
        arch: { w: 1.0, sill: 0, head: 2.3, portal: 8192 }
    };
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const MAXV = 60000;

    // ---------- stairs: one straight flight, footprint in whole cells ----------
    function stairInfo(cfg, s) {
        const H = cfg.storyHeight, f = DIRS[s.dir & 3], l = [-f[1], f[0]];
        const wid = Math.max(0.6, s.wid || 1.0), wc = Math.max(1, Math.ceil(wid - 1e-6));
        const n = s.steps > 0 ? s.steps : Math.max(3, Math.round(H / 0.18));
        const run = s.run > 0 ? s.run : 0.30;
        const len = Math.max(1, Math.ceil(n * run - 1e-6));
        const cells = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let a = 0; a < len; a++) for (let b = 0; b < wc; b++) {
            const ci = s.i + a * f[0] + b * l[0], cj = s.j + a * f[1] + b * l[1];
            cells.push([ci, cj]); x0 = Math.min(x0, ci); y0 = Math.min(y0, cj); x1 = Math.max(x1, ci + 1); y1 = Math.max(y1, cj + 1);
        }
        const m0 = (wc - wid) / 2, m1 = m0 + wid, d = s.dir & 3;
        const P = (t, m) => d === 0 ? [x0 + t, y0 + m] : d === 1 ? [x1 - m, y0 + t] : d === 2 ? [x1 - t, y1 - m] : [x0 + m, y1 - t];
        return { n, rise: H / n, tread: len / n, len, wc, wid, cells, f, l, m0, m1, P, rect: [x0, y0, x1, y1], angle: Math.atan2(H / n, len / n) * 180 / Math.PI };
    }
    // the cell beyond the top of the flight (where you step off)
    function stairLanding(si, s) { return [s.i + si.len * si.f[0], s.j + si.len * si.f[1]]; }

    // ---------- main build ----------
    function build(project, opts) {
        opts = opts || {};
        const cfg = project.settings, D = project.defaults, lv = project.levels, nLev = lv.length;
        const H = cfg.storyHeight, T = cfg.wallThickness, S = cfg.slab, FOUND = cfg.foundation;
        const exportMode = opts.mode === 'export';
        const wallMode = exportMode ? 'up' : (opts.wallMode || 'up');
        const capH = wallMode === 'up' ? Infinity : (wallMode === 'half' ? 1.2 : 0.25);

        const acc = new Map(), batches = [], boxes = [], matList = [], matIdx = new Map(), portals = [], lights = [];
        const bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
        const stats = { tris: 0, boxes: 0, portals: 0, lights: 0, warnings: [] };
        let entranceInfo = null;

        // ---- level lookups ----
        const holes = lv.map(() => new Set()), stairCellsAt = lv.map(() => new Set());
        lv.forEach((l, k) => (l.stairs || []).forEach(s => {
            const si = stairInfo(cfg, s);
            si.cells.forEach(c => { const key = c[0] + ',' + c[1]; stairCellsAt[k].add(key); if (k + 1 < nLev) holes[k + 1].add(key); });
        }));
        const floorTex = (k, key) => (k >= 0 && k < nLev) ? lv[k].floor[key] : undefined;
        const isFloor = (k, key) => floorTex(k, key) !== undefined && !holes[k].has(key);
        // "inside" = enclosed by walls: not reachable from far outside without crossing a wall (an opening still counts as wall).
        // Porches and balconies are therefore outside; rooms behind a door are inside even before any floor is laid.
        const enclosedSets = lv.map((l, k) => {
            const ks = Object.keys(l.walls); if (!ks.length) return new Set();
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            ks.forEach(wk => { const ij = M.parseKey(wk.slice(2)); x0 = Math.min(x0, ij[0]); y0 = Math.min(y0, ij[1]); x1 = Math.max(x1, ij[0] + 1); y1 = Math.max(y1, ij[1] + 1); });
            x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;                                 // cells x0..x1-1, y0..y1-1; the outer ring is open ground
            const blocked = (o, i, j) => !!l.walls[o + ':' + i + ',' + j];   // doors, windows and archways all count as wall here; they get portals instead
            const reach = new Set(), q = [];
            const push = (i, j) => { const key = i + ',' + j; if (i < x0 || i >= x1 || j < y0 || j >= y1 || reach.has(key)) return; reach.add(key); q.push([i, j]); };
            for (let i = x0; i < x1; i++) { push(i, y0); push(i, y1 - 1); } for (let j = y0; j < y1; j++) { push(x0, j); push(x1 - 1, j); }
            while (q.length) {
                const c = q.pop(), i = c[0], j = c[1];
                if (!blocked('V', i + 1, j)) push(i + 1, j); if (!blocked('V', i, j)) push(i - 1, j);
                if (!blocked('H', i, j + 1)) push(i, j + 1); if (!blocked('H', i, j)) push(i, j - 1);
            }
            const enc = new Set();
            for (let i = x0; i < x1; i++) for (let j = y0; j < y1; j++) { const key = i + ',' + j; if (!reach.has(key)) enc.add(key); }
            return enc;
        });
        const isInside = (k, key) => k >= 0 && k < nLev && enclosedSets[k].has(key);
        const hasRoof = (k, key) => k >= 0 && k < nLev && lv[k].roof && lv[k].roof[key] !== undefined;
        const wallAt = (k, o, i, j) => (k >= 0 && k < nLev) ? lv[k].walls[o + ':' + i + ',' + j] : undefined;
        const slabKind = (kk, key) => {
            if (kk < nLev && isFloor(kk, key)) return 'floor';
            if (kk >= 1 && hasRoof(kk - 1, key) && (kk >= nLev || (lv[kk].floor[key] === undefined && !holes[kk].has(key)))) return 'roof';
            return null;
        };

        // ---- emit helpers ----
        function emitQuad(level, kind, group, tex, glass, a, b, c, d) {
            const key = level + '|' + kind + '|' + group + '|' + tex + '|' + (glass ? 1 : 0);
            let m = acc.get(key);
            if (!m || m.pos.length / 3 + 4 > MAXV) { m = { level, kind, group, tex, glass: !!glass, pos: [], nrm: [], uv: [], idx: [] }; acc.set(key, m); batches.push(m); }
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
            const tile = glass ? 1 : TEX.tile(tex), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
            const base = m.pos.length / 3;
            [a, b, c, d].forEach(p => {
                m.pos.push(p[0], p[1], p[2]); m.nrm.push(nx, ny, nz);
                if (ax >= ay && ax >= az) m.uv.push(p[1] / tile, -p[2] / tile);
                else if (ay >= ax && ay >= az) m.uv.push(p[0] / tile, -p[2] / tile);
                else m.uv.push(p[0] / tile, p[1] / tile);
                for (let q = 0; q < 3; q++) { if (p[q] < bmn[q]) bmn[q] = p[q]; if (p[q] > bmx[q]) bmx[q] = p[q]; }
            });
            m.idx.push(base, base + 1, base + 2, base + 2, base + 3, base);
            stats.tris += 2;
        }
        const mapUW = (axis, u, w, z) => axis === 'H' ? [u, w, z] : [w, u, z];
        function quadUW(level, kind, axis, d, p0, p1, p2, p3) {
            const a = mapUW(axis, p0[0], p0[1], p0[2]), b = mapUW(axis, p1[0], p1[1], p1[2]), c = mapUW(axis, p2[0], p2[1], p2[2]), e = mapUW(axis, p3[0], p3[1], p3[2]);
            if (axis === 'V') emitQuad(level, kind, d.group, d.tex, d.glass, a, e, c, b); else emitQuad(level, kind, d.group, d.tex, d.glass, a, b, c, e);
        }
        // box in (u along the wall, w across it, z); f = faces to draw {lw,hw,lu,hu,top,bot} each {tex,group}
        function boxUW(level, kind, axis, u0, u1, w0, w1, z0, z1, f) {
            if (f.lw) quadUW(level, kind, axis, f.lw, [u0, w0, z0], [u1, w0, z0], [u1, w0, z1], [u0, w0, z1]);
            if (f.hw) quadUW(level, kind, axis, f.hw, [u1, w1, z0], [u0, w1, z0], [u0, w1, z1], [u1, w1, z1]);
            if (f.lu) quadUW(level, kind, axis, f.lu, [u0, w1, z0], [u0, w0, z0], [u0, w0, z1], [u0, w1, z1]);
            if (f.hu) quadUW(level, kind, axis, f.hu, [u1, w0, z0], [u1, w1, z0], [u1, w1, z1], [u1, w0, z1]);
            if (f.top) quadUW(level, kind, axis, f.top, [u0, w0, z1], [u1, w0, z1], [u1, w1, z1], [u0, w1, z1]);
            if (f.bot) quadUW(level, kind, axis, f.bot, [u0, w1, z0], [u1, w1, z0], [u1, w0, z0], [u0, w0, z0]);
        }
        function cbox(x0, y0, z0, x1, y1, z1, type, room) {
            if (!exportMode) return;
            if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
            const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            boxes.push([x0, y0, z0, x1, y1, z1, mi]);
        }
        function cboxUW(axis, u0, u1, w0, w1, z0, z1, type, room) {
            if (axis === 'H') cbox(u0, w0, z0, u1, w1, z1, type, room); else cbox(w0, u0, z0, w1, u1, z1, type, room);
        }

        // =========================== walls ===========================
        function buildWall(k, o, i, j, wall) {
            const base = o === 'H' ? i : j, wc = o === 'H' ? j : i, w0 = wc - T / 2, w1 = wc + T / 2;
            const cellA = o === 'H' ? i + ',' + (j - 1) : (i - 1) + ',' + j, cellB = i + ',' + j;
            const insA = isInside(k, cellA), insB = isInside(k, cellB);
            const texA = wall.a || (insA ? D.wallInt : D.wallExt), texB = wall.b || (insB ? D.wallInt : D.wallExt);
            const fA = { tex: texA, group: insA ? 'int' : 'ext' }, fB = { tex: texB, group: insB ? 'int' : 'ext' };
            const revGroup = (insA || insB) ? 'int' : 'ext', topGroup = (insA && insB) ? 'int' : 'ext';
            const REV = { tex: D.trim, group: revGroup }, TOP = { tex: D.trim, group: topGroup };
            // free ends and corner overlaps
            let colLo, perpLo, colHi, perpHi;
            if (o === 'H') {
                colLo = wallAt(k, 'H', i - 1, j); perpLo = wallAt(k, 'V', i, j - 1) || wallAt(k, 'V', i, j);
                colHi = wallAt(k, 'H', i + 1, j); perpHi = wallAt(k, 'V', i + 1, j - 1) || wallAt(k, 'V', i + 1, j);
            } else {
                colLo = wallAt(k, 'V', i, j - 1); perpLo = wallAt(k, 'H', i - 1, j) || wallAt(k, 'H', i, j);
                colHi = wallAt(k, 'V', i, j + 1); perpHi = wallAt(k, 'H', i - 1, j + 1) || wallAt(k, 'H', i, j + 1);
            }
            const extLo = (!colLo && perpLo) ? T / 2 : 0, extHi = (!colHi && perpHi) ? T / 2 : 0;
            const capLo = (!colLo && !perpLo) ? REV : null, capHi = (!colHi && !perpHi) ? REV : null;
            const uLo = base - extLo, uHi = base + 1 + extHi;
            const z0w = k === 0 ? -FOUND : k * H - S, z1w = (k + 1) * H - S, zcap = k * H + capH;
            const wallAbove = k + 1 < nLev && !!wallAt(k + 1, o, i, j);
            const topWanted = !wallAbove ? TOP : null;
            const ctype = TEX.colType(texA);
            const piece = (u0, u1, za, zb, cLo, cHi, top, bot) => {
                const zt = Math.min(zb, zcap);
                if (u1 - u0 < 1e-6 || zt - za < 1e-6) return;
                const f = { lw: fA, hw: fB };
                if (cLo) f.lu = cLo; if (cHi) f.hu = cHi;
                if (zt < zb - 1e-9) f.top = TOP; else if (top) f.top = top;
                if (bot) f.bot = bot;
                boxUW(k, 'wall', o, u0, u1, w0, w1, za, zt, f);
                cboxUW(o, u0, u1, w0, w1, za, zt, ctype, 0);
            };
            const op = wall.open && OPEN[wall.open];
            if (!op) { piece(uLo, uHi, z0w, z1w, capLo, capHi, topWanted, null); return; }

            const c = base + 0.5, ua = c - op.w / 2, ub = c + op.w / 2, zs = k * H + op.sill, zh = k * H + op.head;
            piece(uLo, ua, z0w, z1w, capLo, REV, topWanted, null);
            piece(ub, uHi, z0w, z1w, REV, capHi, topWanted, null);
            piece(ua, ub, zh, z1w, null, null, topWanted, REV);
            piece(ua, ub, z0w, zs, null, null, REV, null);

            // casing: thin trim plates around the opening on both wall faces
            if (zs < zcap) {
                const cw = 0.06, cd = 0.02, zt = Math.min(zh + cw, z1w - 0.02);
                const plate = (u0, u1, za, zb2, side) => {
                    const zt2 = Math.min(zb2, zcap); if (u1 - u0 < 1e-6 || zt2 - za < 1e-6) return;
                    const d = side < 0 ? { tex: D.trim, group: fA.group } : { tex: D.trim, group: fB.group };
                    const f = { lu: d, hu: d, top: d, bot: d };
                    if (side < 0) { f.lw = d; boxUW(k, 'wall', o, u0, u1, w0 - cd, w0, za, zt2, f); }
                    else { f.hw = d; boxUW(k, 'wall', o, u0, u1, w1, w1 + cd, za, zt2, f); }
                };
                [-1, 1].forEach(side => {
                    plate(ua - cw, ua, wall.open === 'window' ? zs - cw : k * H, zt, side);
                    plate(ub, ub + cw, wall.open === 'window' ? zs - cw : k * H, zt, side);
                    plate(ua, ub, zh, zt, side);
                    if (wall.open === 'window') plate(ua, ub, zs - cw, zs, side);
                });
            }
            // window: frame, mullions, glass
            if (wall.open === 'window' && zs < zcap) {
                const fb = 0.05, fd = 0.04, F6 = { tex: D.trim, group: revGroup };
                const all = { lw: F6, hw: F6, lu: F6, hu: F6, top: F6, bot: F6 };
                const fz1 = Math.min(zh, zcap);
                boxUW(k, 'wall', o, ua, ua + fb, wc - fd, wc + fd, zs, fz1, all);
                boxUW(k, 'wall', o, ub - fb, ub, wc - fd, wc + fd, zs, fz1, all);
                boxUW(k, 'wall', o, ua + fb, ub - fb, wc - fd, wc + fd, zs, zs + fb, all);
                if (zh <= zcap) boxUW(k, 'wall', o, ua + fb, ub - fb, wc - fd, wc + fd, zh - fb, zh, all);
                if (zh <= zcap) {
                    boxUW(k, 'wall', o, c - 0.015, c + 0.015, wc - 0.03, wc + 0.03, zs + fb, zh - fb, all);
                    const zm = (zs + zh) / 2; boxUW(k, 'wall', o, ua + fb, ub - fb, wc - 0.03, wc + 0.03, zm - 0.015, zm + 0.015, all);
                    const gl = { tex: 'glass', group: 'glass', glass: true };
                    quadUW(k, 'glass', o, gl, [ua + fb, wc + 0.003, zs + fb], [ub - fb, wc + 0.003, zs + fb], [ub - fb, wc + 0.003, zh - fb], [ua + fb, wc + 0.003, zh - fb]);
                    quadUW(k, 'glass', o, gl, [ub - fb, wc - 0.003, zs + fb], [ua + fb, wc - 0.003, zs + fb], [ua + fb, wc - 0.003, zh - fb], [ub - fb, wc - 0.003, zh - fb]);
                    cboxUW(o, ua + fb, ub - fb, wc - 0.015, wc + 0.015, zs + fb, zh - fb, 112, 0);
                }
            }
            // portal to the outside when exactly one side is inside
            if (exportMode && (insA !== insB)) {
                const outSign = insA ? 1 : -1, U0 = ua, U1 = ub, Z0 = zs, Z1 = zh;
                let a, b, cc, d;
                if (o === 'H') {
                    if (outSign < 0) { a = [U0, wc, Z0]; b = [U1, wc, Z0]; cc = [U1, wc, Z1]; d = [U0, wc, Z1]; }
                    else { a = [U1, wc, Z0]; b = [U0, wc, Z0]; cc = [U0, wc, Z1]; d = [U1, wc, Z1]; }
                } else {
                    if (outSign < 0) { a = [wc, U1, Z0]; b = [wc, U0, Z0]; cc = [wc, U0, Z1]; d = [wc, U1, Z1]; }
                    else { a = [wc, U0, Z0]; b = [wc, U1, Z0]; cc = [wc, U1, Z1]; d = [wc, U0, Z1]; }
                }
                const corners = [].concat(a, b, cc, d);
                // doors first so the main entrance portal is portal 0
                const pr = { flags: op.portal, corners };
                if (wall.open !== 'window') portals.unshift(pr); else portals.push(pr);
            }
            // entrance marker
            if (project.entrance && project.entrance.level === k && project.entrance.key === o + ':' + i + ',' + j) {
                const inward = o === 'H' ? [0, insB ? 1 : -1] : [insB ? 1 : -1, 0];
                entranceInfo = { level: k, center: o === 'H' ? [c, wc] : [wc, c], inward, ok: insA !== insB, zFloor: k * H };
            }
        }

        // =========================== slabs: floors and roofs ===========================
        function mergeRects(keys) {
            const set = new Set(keys), used = new Set(), out = [];
            const arr = keys.map(k2 => M.parseKey(k2)).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
            for (const [i, j] of arr) {
                if (used.has(i + ',' + j)) continue;
                let i1 = i + 1; while (set.has(i1 + ',' + j) && !used.has(i1 + ',' + j)) i1++;
                let j1 = j + 1;
                for (;;) {
                    let ok = true; for (let x = i; x < i1; x++) { const kk = x + ',' + j1; if (!set.has(kk) || used.has(kk)) { ok = false; break; } }
                    if (!ok) break; j1++;
                }
                for (let x = i; x < i1; x++) for (let y = j; y < j1; y++) used.add(x + ',' + y);
                out.push([i, j, i1, j1]);
            }
            return out;
        }

        function buildSlabs(kk) {
            const zt = kk * H, zb = zt - S;
            const cells = [];
            if (kk < nLev) Object.keys(lv[kk].floor).forEach(key => { if (!holes[kk].has(key)) cells.push(key); });
            if (kk >= 1) Object.keys(lv[kk - 1].roof || {}).forEach(key => { if (slabKind(kk, key) === 'roof') cells.push(key); });
            const eave = T / 2 + 0.05;
            const colGroups = new Map();
            cells.forEach(key => {
                const [i, j] = M.parseKey(key), kind = slabKind(kk, key); if (!kind) return;
                const isRoof = kind === 'roof', level = isRoof ? kk - 1 : kk, bk = isRoof ? 'roof' : 'floor';
                const nb = (di, dj) => slabKind(kk, (i + di) + ',' + (j + dj)) !== null;
                const ew = isRoof && !nb(-1, 0) ? eave : 0, ee = isRoof && !nb(1, 0) ? eave : 0, es = isRoof && !nb(0, -1) ? eave : 0, en = isRoof && !nb(0, 1) ? eave : 0;
                const x0 = i - ew, x1 = i + 1 + ee, y0 = j - es, y1 = j + 1 + en;
                const topTex = isRoof ? lv[kk - 1].roof[key] : lv[kk].floor[key];
                const covered = slabKind(kk + 1, key) !== null;
                const topGroup = isRoof ? 'ext' : (isInside(kk, key) ? 'int' : 'ext');
                emitQuad(level, bk, topGroup, topTex, false, [x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]);
                if (kk >= 1) {
                    const below = isInside(kk - 1, key), ct = (lv[kk - 1].ceil && lv[kk - 1].ceil[key]) || D.ceiling;
                    emitQuad(level, bk, below ? 'int' : 'ext', ct, false, [x0, y1, zb], [x1, y1, zb], [x1, y0, zb], [x0, y0, zb]);
                }
                // exposed edges
                const edge = (cond, q0, q1, q2, q3, grp) => { if (cond) emitQuad(level, bk, grp, D.slab, false, q0, q1, q2, q3); };
                const wallE = (o, a, b) => kk < nLev && !!wallAt(kk, o, a, b);
                const insN = (di, dj) => { const k2 = (i + di) + ',' + (j + dj); return isInside(kk, k2); };
                if (!nb(1, 0) && (isRoof || !wallE('V', i + 1, j))) edge(true, [x1, y0, zb], [x1, y1, zb], [x1, y1, zt], [x1, y0, zt], isRoof ? 'ext' : (insN(1, 0) ? 'int' : 'ext'));
                if (!nb(-1, 0) && (isRoof || !wallE('V', i, j))) edge(true, [x0, y1, zb], [x0, y0, zb], [x0, y0, zt], [x0, y1, zt], isRoof ? 'ext' : (insN(-1, 0) ? 'int' : 'ext'));
                if (!nb(0, 1) && (isRoof || !wallE('H', i, j + 1))) edge(true, [x1, y1, zb], [x0, y1, zb], [x0, y1, zt], [x1, y1, zt], isRoof ? 'ext' : (insN(0, 1) ? 'int' : 'ext'));
                if (!nb(0, -1) && (isRoof || !wallE('H', i, j))) edge(true, [x0, y0, zb], [x1, y0, zb], [x1, y0, zt], [x0, y0, zt], isRoof ? 'ext' : (insN(0, -1) ? 'int' : 'ext'));
                if (exportMode) {
                    const type = TEX.colType(topTex), room = (!isRoof && isInside(kk, key)) ? 1 : 0;
                    const ck = type + '|' + room; if (!colGroups.has(ck)) colGroups.set(ck, { type, room, keys: [] });
                    colGroups.get(ck).keys.push(key);
                }
            });
            if (exportMode) colGroups.forEach(g => {
                mergeRects(g.keys).forEach(r => cbox(r[0], r[1], kk === 0 ? -0.4 : zb, r[2], r[3], zt, g.type, g.room));
            });
        }

        // =========================== stairs ===========================
        function buildStair(k, s) {
            const si = stairInfo(cfg, s), n = si.n, h = si.rise, r = si.tread, zb = k * H, P = si.P;
            const land = stairLanding(si, s);
                        const group = isInside(k, s.i + ',' + s.j) ? 'int' : 'ext';
            const stepTex = s.tex || D.stair, sideTex = s.sideTex || D.slab, ctype = TEX.colType(stepTex);
            const open = s.style === 'open';
            const m0 = si.m0, m1 = si.m1;
            const Q = (tex, a, b, c, d) => emitQuad(k, 'stair', group, tex, false, a, b, c, d);
            const pt = (t, m, z) => { const p = P(t, m); return [p[0], p[1], z]; };
            // sloped prism: cross-section (t, z) swept across lateral m
            const prism = (tA, tB, zA0, zA1, zB0, zB1, mLo, mHi, tex) => {
                Q(tex, pt(tA, mLo, zA0), pt(tB, mLo, zB0), pt(tB, mLo, zB1), pt(tA, mLo, zA1));          // right side (-l)
                Q(tex, pt(tB, mHi, zB0), pt(tA, mHi, zA0), pt(tA, mHi, zA1), pt(tB, mHi, zB1));          // left side (+l)
                Q(tex, pt(tA, mLo, zA1), pt(tB, mLo, zB1), pt(tB, mHi, zB1), pt(tA, mHi, zA1));          // top
                Q(tex, pt(tA, mHi, zA0), pt(tB, mHi, zB0), pt(tB, mLo, zB0), pt(tA, mLo, zA0));          // bottom
                Q(tex, pt(tA, mHi, zA0), pt(tA, mLo, zA0), pt(tA, mLo, zA1), pt(tA, mHi, zA1));          // start end (-f)
                Q(tex, pt(tB, mLo, zB0), pt(tB, mHi, zB0), pt(tB, mHi, zB1), pt(tB, mLo, zB1));          // far end (+f)
            };
            for (let m = 1; m <= n; m++) {
                const t0 = (m - 1) * r, t1 = m * r, zTop = zb + m * h, zPrev = zb + (m - 1) * h;
                if (!open) {
                    Q(stepTex, pt(t0, m0, zTop), pt(t1, m0, zTop), pt(t1, m1, zTop), pt(t0, m1, zTop));                       // tread
                    Q(stepTex, pt(t0, m1, zPrev), pt(t0, m0, zPrev), pt(t0, m0, zTop), pt(t0, m1, zTop));                     // riser
                    Q(sideTex, pt(t0, m0, zb), pt(t1, m0, zb), pt(t1, m0, zTop), pt(t0, m0, zTop));                           // right side
                    Q(sideTex, pt(t1, m1, zb), pt(t0, m1, zb), pt(t0, m1, zTop), pt(t1, m1, zTop));                           // left side
                    if (m === n) Q(sideTex, pt(t1, m0, zb), pt(t1, m1, zb), pt(t1, m1, zb + H - S), pt(t1, m0, zb + H - S));  // back
                    const a = P(t0, m0), b = P(t1, m1);
                    cbox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), zb - 0.05, Math.max(a[0], b[0]), Math.max(a[1], b[1]), zTop, ctype, 1);
                } else {
                    const th = 0.05;
                    prism(t0, t1 + 0.02, zTop - th, zTop, zTop - th, zTop, m0 + 0.06, m1 - 0.06, stepTex);
                    const a = P(t0, m0), b = P(t1, m1);
                    cbox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), zTop - 0.12, Math.max(a[0], b[0]), Math.max(a[1], b[1]), zTop, ctype, 1);
                }
            }
            if (open) {
                const L = n * r;
                [[m0, m0 + 0.06], [m1 - 0.06, m1]].forEach(mm => prism(0, L, zb - 0.28, zb - 0.06, zb + H - 0.28, zb + H - 0.06, mm[0], mm[1], sideTex));
            }
            if (s.rail) {
                const L = n * r, RT = D.trim;
                [[m0, m0 + 0.05], [m1 - 0.05, m1]].forEach(mm => {
                    prism(0, L, zb + 0.90, zb + 0.97, zb + H + 0.90, zb + H + 0.97, mm[0], mm[1], RT);
                    for (let t = r * 0.5; t < L; t += r * 3) {
                        const mStep = Math.min(n, Math.ceil(t / r)), zT = zb + mStep * h;
                        prism(t - 0.025, t + 0.025, zT, zb + 0.9 + (t / L) * H, zT, zb + 0.9 + (t / L) * H, mm[0], mm[1], RT);
                    }
                });
            }
        }

        // =========================== lights ===========================
        function buildLights(k) {
            const zl = (k + 1) * H - S - 0.15;
            const cellsList = Object.keys(lv[k].floor).filter(key => isFloor(k, key) && isInside(k, key));
            const comp = new Map(); let nid = 0;
            const cset = new Set(cellsList);
            const blocked = (a, b, o, i, j) => { const w = wallAt(k, o, i, j); return w && w.open !== 'arch'; };
            cellsList.forEach(key => {
                if (comp.has(key)) return; const id = nid++, q = [key]; comp.set(key, id);
                while (q.length) {
                    const cur = q.pop(), [i, j] = M.parseKey(cur);
                    const nbs = [[i + 1, j, 'V', i + 1, j], [i - 1, j, 'V', i, j], [i, j + 1, 'H', i, j + 1], [i, j - 1, 'H', i, j]];
                    nbs.forEach(nbv => {
                        const nk = nbv[0] + ',' + nbv[1];
                        if (!cset.has(nk) || comp.has(nk) || blocked(cur, nk, nbv[2], nbv[3], nbv[4])) return;
                        comp.set(nk, id); q.push(nk);
                    });
                }
            });
            const byComp = new Map(); comp.forEach((id, key) => { if (!byComp.has(id)) byComp.set(id, []); byComp.get(id).push(M.parseKey(key)); });
            byComp.forEach(cs => {
                let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; cs.forEach(c => { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0] + 1); y1 = Math.max(y1, c[1] + 1); });
                const nx = Math.max(1, Math.round((x1 - x0) / 3.5)), ny = Math.max(1, Math.round((y1 - y0) / 3.5)), seen = new Set();
                for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
                    const cx = x0 + (a + 0.5) * (x1 - x0) / nx, cy = y0 + (b + 0.5) * (y1 - y0) / ny;
                    let best = null, bd = 1e9; cs.forEach(c => { const d = Math.hypot(c[0] + 0.5 - cx, c[1] + 0.5 - cy); if (d < bd) { bd = d; best = c; } });
                    const lk = best[0] + ',' + best[1]; if (seen.has(lk)) continue; seen.add(lk);
                    lights.push({ x: best[0] + 0.5, y: best[1] + 0.5, z: zl });
                }
            });
        }

        // =========================== run ===========================
        for (let k = 0; k < nLev; k++) {
            const walls = lv[k].walls;
            Object.keys(walls).forEach(wk => { const p = wk.split(':'), ij = M.parseKey(p[1]); buildWall(k, p[0], ij[0], ij[1], walls[wk]); });
            (lv[k].stairs || []).forEach(s => buildStair(k, s));
        }
        for (let kk = 0; kk <= nLev; kk++) buildSlabs(kk);
        if (exportMode) {
            if (opts.autoLights !== false) for (let k = 0; k < nLev; k++) buildLights(k);
            for (let k = 0; k < nLev; k++) (lv[k].lights || []).forEach(l => lights.push({ x: l.x, y: l.y, z: (k + 1) * H - S - 0.15 }));
        }

        // ---- finish ----
        batches.forEach(b => { b.pos = new Float32Array(b.pos); b.nrm = new Float32Array(b.nrm); b.uv = new Float32Array(b.uv); b.idx = new Uint16Array(b.idx); });
        stats.boxes = boxes.length; stats.portals = portals.length; stats.lights = lights.length;
        return { batches, boxes, matList, portals, lights, entrance: entranceInfo, bounds: { mn: bmn, mx: bmx }, stats };
    }

    // ---------- export model for the C# exporter ----------
    function toExport(project, built, extra) {
        const groups = {
            ext: { name: 'ext', room: 0, flags: 1572864, lod: 500, mats: [], lights: [] },
            int: { name: 'int', room: 1, flags: 1572864, lod: 300, mats: [], lights: [] },
            glass: { name: 'glass', room: 1, flags: 32, lod: 200, mats: [], lights: [] }
        };
        const cur = new Map(), usedTex = new Set();
        built.batches.forEach(b => {
            const g = groups[b.group]; if (!g) return;
            const key = b.group + '|' + b.tex + '|' + b.glass; let m = cur.get(key);
            const nv = b.pos.length / 3;
            if (!m || m.pos.length / 3 + nv > MAXV) { m = { tex: b.tex, glass: b.glass, pos: [], nrm: [], uv: [], idx: [] }; cur.set(key, m); g.mats.push(m); }
            const off = m.pos.length / 3;
            for (let i = 0; i < b.pos.length; i++) m.pos.push(b.pos[i]);
            for (let i = 0; i < b.nrm.length; i++) m.nrm.push(b.nrm[i]);
            for (let i = 0; i < b.uv.length; i++) m.uv.push(b.uv[i]);
            for (let i = 0; i < b.idx.length; i++) m.idx.push(b.idx[i] + off);
            if (!b.glass) usedTex.add(b.tex);
        });
        const L = extra.light || {};
        groups.int.lights = built.lights.slice(0, 48).map(l => ({ x: l.x, y: l.y, z: l.z, r: 255, g: 238, b: 210, intensity: L.intensity || 4, falloff: L.falloff || 6, exponent: L.exponent || 24 }));
        const look = (M.Model && M.Model.mergeLook) ? M.Model.mergeLook(project.look) : { normalMaps: false }, nm = look.normalMaps !== false;
        // a material with a normal map and a specular map: the game's normal_spec shader, with the bumpiness and shine of its kind of surface
        const matOut = (m) => {
            const o = { tex: m.tex, glass: m.glass, pos: M.toB64(new Float32Array(m.pos)), nrm: M.toB64(new Float32Array(m.nrm)), uv: M.toB64(new Float32Array(m.uv)), idx: M.toB64(new Int32Array(m.idx)) };
            if (nm && !m.glass) { const sf = TEX.surface(m.tex); o.nm = true; o.bump = sf.bump; o.spec = sf.spec; o.fall = sf.fall; }
            return o;
        };
        const outGroups = Object.keys(groups).map(k => groups[k]).filter(g => g.mats.length > 0).map(g => ({
            name: g.name, room: g.room, flags: g.flags, lod: g.lod, lights: g.lights, set: g.set || undefined,
            mats: g.mats.map(matOut)
        }));
        // collision: 8 vertices per box
        const verts = [], tris = [];
        built.boxes.forEach(b => {
            const x0 = b[0], y0 = b[1], z0 = b[2], x1 = b[3], y1 = b[4], z1 = b[5], mi = b[6], v = verts.length / 3, o = b[7];
            if (o && o.yaw != null) {
                // a box that is turned about Z: the same 8 corners, turned (the winding stays the same)
                const c = Math.cos(o.yaw), s = Math.sin(o.yaw), P = (su, sn, z) => [o.cx + su * o.hu * c - sn * o.hn * s, o.cy + su * o.hu * s + sn * o.hn * c, z];
                [P(-1, -1, z0), P(1, -1, z0), P(1, 1, z0), P(-1, 1, z0), P(-1, -1, z1), P(1, -1, z1), P(1, 1, z1), P(-1, 1, z1)].forEach(p => verts.push(p[0], p[1], p[2]));
            } else verts.push(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
            const quad = (a, b2, c, d) => { tris.push(v + a, v + b2, v + c, mi, v + c, v + d, v + a, mi); };
            quad(1, 2, 6, 5); quad(3, 0, 4, 7); quad(2, 3, 7, 6); quad(0, 1, 5, 4); quad(4, 5, 6, 7); quad(3, 2, 1, 0);
        });
        const textures = [];
        [...usedTex].forEach(id => {
            const t = TEX.pixels(id), b64 = (a) => M.toB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
            textures.push({ name: id, size: t.size, rgba: b64(t.data) });
            if (nm) { const mp = TEX.maps(id, look.flipGreen); textures.push({ name: id + '_n', size: mp.size, rgba: b64(mp.normal), usage: 'NORMAL' }, { name: id + '_s', size: mp.size, rgba: b64(mp.spec), usage: 'SPECULAR' }); }
        });
        return Object.assign({
            groups: outGroups,
            collision: { mats: built.matList, verts: M.toB64(new Float32Array(verts)), tris: M.toB64(new Int32Array(tris)) },
            portals: built.portals, textures
        }, extra.model || {});
    }

    M.Mesher = { build, toExport, stairInfo, stairLanding, OPEN, DIRS };
})(window.MLO);


