// The walk check: a player-sized capsule is walked through the interior as the game will have it, and what it finds is listed.
// Solid things are: the interior's own collision (walls, floor, door frames, window glass), the boxes you built (Collision box tool) and what is left of the building's own
// collision after the export's cuts (the host cuts it the same way, IM.colFinalLoad). Everything is put on a 5 cm grid (a cell counts as solid when the thing touches it, so
// a gap is never found where there is none; the price is up to 5 cm per side). A thing blocks the player when it reaches into the height band between the step height and the
// player's height; a cell is free when the capsule (a disk of the player's radius) fits there and there is a floor under it. Then the free cells are flooded from a start.
// It finds: parts of the rooms you cannot reach, doorways you cannot walk through (and what blocks them), places where you could walk out of the rooms through a gap in
// the walls, pieces of the building's collision standing in the rooms, holes in the floor and boxes that float. Never run in the game: it tests the files' collision, not the
// game's character controller.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, bus = Model.bus, IM = M.ImportModel;
    const W = M.Walk = { result: null, busy: false, note: '', start: null, focus: null };
    const cfg = () => (S.walkCfg = S.walkCfg || { r: 0.3, h: 1.75, step: 0.35 });
    W.cfg = cfg;
    const BIT = { 1: 'a wall or frame the interior makes', 2: 'one of your collision boxes', 4: 'the building\'s own collision' };
    const causeOf = (bits) => [1, 2, 4].filter(b => bits & b).map(b => BIT[b]).join(' and ') || 'something';
    const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

    // what the result depends on: when any of it changes the result is out of date
    W.key = function () {
        const P = S.project, I = P.import;
        return JSON.stringify([P.shell.ops, P.shell.parts, P.shell.openings, P.shell.floors, P.settings.ceilH, P.settings.wallThick, P.settings.wallDepth, P.settings.walls, I.cboxes, I.colDeletes, I.frame, I.clearCollision,
            I.cutters.map(k => [k.id, k.cx, k.cy, k.zb, k.w, k.h, k.yaw, k.type, k.frame, k.vframe, k.fill, k.leaf, k.dd]), I.deletes.length, (I.fills || []).length, cfg(), W.start]);
    };
    W.done = () => !!(W.result && !W.result.empty && W.result.key === W.key() && !W.result.problems.some(p => p.sev === 'bad'));
    W.stale = () => !!(W.result && W.result.key !== W.key());
    const refresh = () => { try { M.UI.renderLeft(); } catch (e) { /* the panel is not there */ } };

    W.setStart = function (x, y) { W.start = [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; if (W.result) W.run(); else refresh(); };
    W.clear = function () { W.result = null; W.focus = null; W.note = ''; refresh(); };
    W.run = async function () {
        if (W.busy) return; W.busy = true; W.note = 'Reading the building\'s collision...'; refresh(); const t0 = performance.now();
        try {
            const key = W.key(); let fin = null, finNote = '';
            try { fin = await IM.colFinalLoad(); } catch (e) { finNote = 'The building\'s collision could not be read (' + e.message + '): the check only knows the interior\'s own collision.'; }
            if (!fin && !finNote) finNote = 'No collision of the building is imported (or the placement is not set): the check only knows the interior\'s own collision.';
            W.note = 'Walking...'; refresh(); await new Promise(r => setTimeout(r, 30));
            const P = S.project, built = M.Shell.build(P, { mode: 'export', autoLights: false });
            const res = analyse(P, built, fin, cfg()); res.key = key; res.finNote = finNote; res.ms = Math.round(performance.now() - t0);
            W.result = res; W.focus = null; W.note = '';
        } catch (e) { W.note = 'The check failed: ' + e.message; M.Errors.report('walk', e, { quiet: true }); }
        W.busy = false; refresh();
    };

    // ---------- geometry helpers ----------
    function hull(pts) {                                          // convex hull of 2D points (counter-clockwise)
        const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        if (p.length < 3) return p; const lo = [], up = [];
        p.forEach(q => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
        for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
        lo.pop(); up.pop(); return lo.concat(up);
    }

    function analyse(P, built, fin, cf) {
        const R = cf.r, HH = cf.h, STEP = cf.step, rects = M.Shell.regionRects(P.shell);
        if (!rects.length) return { empty: true, problems: [], stats: {}, note: 'Draw a room first.' };
        let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; rects.forEach(r => { bx0 = Math.min(bx0, r[0]); by0 = Math.min(by0, r[1]); bx1 = Math.max(bx1, r[2]); by1 = Math.max(by1, r[3]); });
        const MARG = 2.0, gx0 = bx0 - MARG, gy0 = by0 - MARG; let cs = 0.05, nx, ny;
        for (;;) { nx = Math.ceil((bx1 + MARG - gx0) / cs); ny = Math.ceil((by1 + MARG - gy0) / cs); if (nx * ny <= 700000) break; cs *= 1.25; }
        const N = nx * ny, solid = new Uint8Array(N), floor = new Uint8Array(N), inReg = new Uint8Array(N), ca = cs * cs, EPS = 1e-6;
        const cx = (i) => gx0 + (i + 0.5) * cs, cy = (j) => gy0 + (j + 0.5) * cs;
        rects.forEach(r => {
            const i0 = Math.max(0, Math.ceil((r[0] - gx0) / cs - 0.5)), i1 = Math.min(nx - 1, Math.floor((r[2] - gx0) / cs - 0.5 - 1e-9)), j0 = Math.max(0, Math.ceil((r[1] - gy0) / cs - 0.5)), j1 = Math.min(ny - 1, Math.floor((r[3] - gy0) / cs - 0.5 - 1e-9));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) inReg[j * nx + i] = 1;
        });

        // ---- put the solid things on the grid ----
        const touchBand = (zlo, zhi) => zhi > STEP + 1e-3 && zlo < HH - 1e-3, floorTop = (zhi) => zhi >= -0.12 && zhi <= STEP + 1e-3;
        function markBox(xa, xb, ya, yb, zlo, zhi, bit) {
            const band = touchBand(zlo, zhi), fl = floorTop(zhi); if (!band && !fl) return;
            const i0 = Math.max(0, Math.floor((xa - gx0) / cs + EPS)), j0 = Math.max(0, Math.floor((ya - gy0) / cs + EPS));
            const i1 = Math.min(nx - 1, Math.max(i0, Math.ceil((xb - gx0) / cs - EPS) - 1)), j1 = Math.min(ny - 1, Math.max(j0, Math.ceil((yb - gy0) / cs - EPS) - 1));
            if (xb < gx0 || xa > gx0 + nx * cs || yb < gy0 || ya > gy0 + ny * cs) return;
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (band) solid[k] |= bit; if (fl) floor[k] = 1; }
        }
        // a convex polygon (2D points) against the cell squares in its bounding box
        function markPoly(pts, zfn, bit) {
            let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9; pts.forEach(p => { xa = Math.min(xa, p[0]); xb = Math.max(xb, p[0]); ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); });
            if (xb < gx0 || xa > gx0 + nx * cs || yb < gy0 || ya > gy0 + ny * cs) return;
            const i0 = Math.max(0, Math.floor((xa - gx0) / cs + EPS)), j0 = Math.max(0, Math.floor((ya - gy0) / cs + EPS));
            const i1 = Math.min(nx - 1, Math.max(i0, Math.ceil((xb - gx0) / cs - EPS) - 1)), j1 = Math.min(ny - 1, Math.max(j0, Math.ceil((yb - gy0) / cs - EPS) - 1));
            const ed = []; for (let a = 0; a < pts.length; a++) { const p = pts[a], q = pts[(a + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); if (l < 1e-9) continue; const nxx = -dy / l, nyy = dx / l; let lo = 1e9, hi = -1e9; pts.forEach(r => { const d = r[0] * nxx + r[1] * nyy; if (d < lo) lo = d; if (d > hi) hi = d; }); ed.push([nxx, nyy, lo, hi]); }
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const ax = gx0 + i * cs, ay = gy0 + j * cs; let hit = true;
                for (let e = 0; e < ed.length && hit; e++) { const E = ed[e], c1 = ax * E[0] + ay * E[1], c2 = (ax + cs) * E[0] + ay * E[1], c3 = ax * E[0] + (ay + cs) * E[1], c4 = (ax + cs) * E[0] + (ay + cs) * E[1], lo = Math.min(c1, c2, c3, c4), hi = Math.max(c1, c2, c3, c4); if (hi < E[2] - EPS || lo > E[3] + EPS) hit = false; }
                if (!hit) continue; const z = zfn(ax + cs / 2, ay + cs / 2); if (!z) continue;
                const k = j * nx + i; if (touchBand(z[0], z[1])) solid[k] |= bit; if (z[2] && floorTop(z[1])) floor[k] = 1;
            }
        }
        // the interior's own collision and your boxes
        (built.boxes || []).forEach(b => {
            const ex = b[7], bit = ex && ex.user ? 2 : 1;
            if (ex && ex.yaw != null) { const c = Math.cos(ex.yaw), s = Math.sin(ex.yaw), pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(q => [ex.cx + q[0] * ex.hu * c - q[1] * ex.hn * s, ex.cy + q[0] * ex.hu * s + q[1] * ex.hn * c]); markPoly(pts, () => [b[2], b[5], true], bit); }
            else markBox(b[0], b[3], b[1], b[4], b[2], b[5], bit);
        });
        // what is left of the building's collision
        if (fin) for (let i = 0; i < fin.n; i++) {
            const o = i * 12;
            if (fin.kind[i] === 0) {
                const a = [fin.c[o], fin.c[o + 1], fin.c[o + 2]], b = [fin.c[o + 3], fin.c[o + 4], fin.c[o + 5]], c = [fin.c[o + 6], fin.c[o + 7], fin.c[o + 8]];
                const zmin = Math.min(a[2], b[2], c[2]), zmax = Math.max(a[2], b[2], c[2]); if (zmax < -0.12 || zmin >= HH) continue;
                const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2], nxv = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nzv = ux * vy - uy * vx, nl = Math.hypot(nxv, nyv, nzv) || 1;
                const flat = Math.abs(nzv) / nl > 0.7, slant = Math.abs(nzv) / nl > 0.2, sx = slant ? Math.abs(nxv / nzv) : 0, sy = slant ? Math.abs(nyv / nzv) : 0;
                markPoly([a, b, c], (px, py) => {
                    if (!slant) return [zmin, zmax, false];
                    const z = a[2] - (nxv * (px - a[0]) + nyv * (py - a[1])) / nzv, h = (sx + sy) * cs / 2; return [Math.max(zmin, z - h), Math.min(zmax, z + h), flat];
                }, 4);
            } else {
                const cs8 = IM.colBoxCorners(fin.c, o); let zlo = 1e9, zhi = -1e9; cs8.forEach(p => { zlo = Math.min(zlo, p[2]); zhi = Math.max(zhi, p[2]); }); if (zhi < -0.12 || zlo >= HH) continue;
                markPoly(hull(cs8.map(p => [p[0], p[1]])), () => [zlo, zhi, true], 4);
            }
        }

        // ---- the capsule: a cell is blocked when a solid cell is within the player's radius ----
        const rc = R / cs, rci = Math.ceil(rc), offs = []; for (let dy = -rci; dy <= rci; dy++) for (let dx = -rci; dx <= rci; dx++) if (dx * dx + dy * dy <= rc * rc + 0.25) offs.push([dx, dy]);
        const blk = new Uint8Array(N);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const b = solid[j * nx + i]; if (!b) continue; for (let o = 0; o < offs.length; o++) { const ii = i + offs[o][0], jj = j + offs[o][1]; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) blk[jj * nx + ii] |= b; } }
        const standable = (k) => !blk[k] && (!inReg[k] || floor[k]);

        // ---- where to start ----
        const cellOf = (x, y) => { const i = Math.floor((x - gx0) / cs), j = Math.floor((y - gy0) / cs); return (i < 0 || j < 0 || i >= nx || j >= ny) ? -1 : j * nx + i; };
        let sx, sy, startNote = '';
        if (W.start) { sx = W.start[0]; sy = W.start[1]; } else { let br = null, ba = 0; rects.forEach(r => { const a = (r[2] - r[0]) * (r[3] - r[1]); if (a > ba) { ba = a; br = r; } }); sx = (br[0] + br[2]) / 2; sy = (br[1] + br[3]) / 2; }
        let s0 = cellOf(sx, sy), best = -1;
        if (s0 >= 0 && standable(s0)) best = s0; else {
            const si = s0 >= 0 ? s0 % nx : Math.floor((sx - gx0) / cs), sj = s0 >= 0 ? Math.floor(s0 / nx) : Math.floor((sy - gy0) / cs), maxr = Math.ceil(2.0 / cs);
            for (let rr = 1; rr <= maxr && best < 0; rr++) for (let dj = -rr; dj <= rr && best < 0; dj++) for (let di = -rr; di <= rr; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue; const i = si + di, j = sj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue; if (standable(j * nx + i) && inReg[j * nx + i]) { best = j * nx + i; break; } }
            if (best >= 0 && W.start) startNote = 'The start you chose is not on a free floor: the nearest free spot is used.';
        }
        const problems = [], stats = { cell: cs };
        if (best < 0) { problems.push({ sev: 'bad', kind: 'start', text: 'There is no free floor to start from: the capsule (' + f2(R * 2) + ' m wide) does not fit anywhere near ' + f2(sx) + ', ' + f2(sy) + '. Click the floor of a room to choose where to start.', at: [sx, sy] }); return { problems, stats, empty: false, start: [sx, sy], grid: { gx0, gy0, cs, nx, ny }, overlay: { reach: [], pockets: [], holes: [], blockers: [], doors: [], leaks: [] }, cfg: Object.assign({}, cf), startNote }; }

        // ---- flood the free cells ----
        const reach = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0; reach[best] = 1; q[qt++] = best;
        while (qh < qt) {
            const k = q[qh++], i = k % nx, j = (k / nx) | 0;
            for (let d = 0; d < 8; d++) {
                const di = [1, -1, 0, 0, 1, 1, -1, -1][d], dj = [0, 0, 1, -1, 1, -1, 1, -1][d], ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const n = jj * nx + ii; if (reach[n] || !standable(n)) continue;
                if (di && dj && (!standable(j * nx + ii) || !standable(jj * nx + i))) continue;
                reach[n] = 1; q[qt++] = n;
            }
        }
        const comps = (test, minCells) => {                                      // 8-connected groups of cells; {cells, area, bbox, centre}
            const seen = new Uint8Array(N), out = [], st = [];
            for (let k0 = 0; k0 < N; k0++) {
                if (seen[k0] || !test(k0)) continue; let n = 0, sxx = 0, syy = 0, ax = 1e9, ay = 1e9, bx = -1e9, by = -1e9, bits = 0; seen[k0] = 1; st.push(k0);
                while (st.length) {
                    const k = st.pop(), i = k % nx, j = (k / nx) | 0; n++; sxx += cx(i); syy += cy(j); ax = Math.min(ax, cx(i) - cs / 2); bx = Math.max(bx, cx(i) + cs / 2); ay = Math.min(ay, cy(j) - cs / 2); by = Math.max(by, cy(j) + cs / 2); bits |= solid[k];
                    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const m = jj * nx + ii; if (!seen[m] && test(m)) { seen[m] = 1; st.push(m); } }
                }
                if (n >= minCells) out.push({ n, area: n * ca, bbox: [ax, ay, bx, by], at: [sxx / n, syy / n], bits });
            }
            return out;
        };
        const rectsOf = (test) => {                                              // the cells as a few rectangles for drawing (rows merged downwards)
            const out = []; let prev = new Map();
            for (let j = 0; j < ny; j++) {
                const cur = new Map(); let i = 0;
                while (i < nx) { if (!test(j * nx + i)) { i++; continue; } let i1 = i; while (i1 + 1 < nx && test(j * nx + i1 + 1)) i1++; const key = i + ':' + i1, p = prev.get(key); if (p) { p[3] = j + 1; cur.set(key, p); } else { const r = [i, j, i1 + 1, j + 1]; out.push(r); cur.set(key, r); } i = i1 + 1; }
                prev = cur;
            }
            return out.map(r => [gx0 + r[0] * cs, gy0 + r[1] * cs, gx0 + r[2] * cs, gy0 + r[3] * cs]);
        };

        // ---- 1. parts of the rooms you cannot reach ----
        let regionFree = 0, regionReach = 0; for (let k = 0; k < N; k++) if (inReg[k] && standable(k)) { regionFree++; if (reach[k]) regionReach++; }
        stats.regionFree = regionFree * ca; stats.regionReach = regionReach * ca;
        const pockets = comps(k => inReg[k] && standable(k) && !reach[k], Math.ceil(0.3 / ca));
        pockets.sort((a, b) => b.area - a.area).slice(0, 8).forEach(p => problems.push({ sev: 'bad', kind: 'pocket', text: 'A part of the rooms of ' + f2(p.area) + ' m2 around ' + f2(p.at[0]) + ', ' + f2(p.at[1]) + ' cannot be reached from the start: it is closed in by walls, boxes or something of the building (there is no doorway to it that the player fits through).', at: p.at, bbox: p.bbox }));
        // ---- 2. holes in the floor ----
        const holes = comps(k => inReg[k] && !floor[k], Math.ceil(0.05 / ca));
        holes.sort((a, b) => b.area - a.area).slice(0, 6).forEach(p => problems.push({ sev: 'bad', kind: 'hole', text: 'No floor collision under ' + f2(p.area) + ' m2 around ' + f2(p.at[0]) + ', ' + f2(p.at[1]) + ': the player would fall through.', at: p.at, bbox: p.bbox }));
        // ---- 3. what is left of the building's collision standing in the rooms (not the strip next to the walls) ----
        const wallBand = Math.ceil(0.2 / cs), nearOut = new Uint8Array(N);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { if (inReg[j * nx + i]) continue; for (let dj = -wallBand; dj <= wallBand; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue; for (let di = -wallBand; di <= wallBand; di++) { const ii = i + di; if (ii >= 0 && ii < nx) nearOut[jj * nx + ii] = 1; } } }
        const blockers = comps(k => inReg[k] && !nearOut[k] && (solid[k] & 4), 4);
        blockers.sort((a, b) => b.area - a.area).slice(0, 10).forEach(p => problems.push({ sev: 'warn', kind: 'blocker', text: 'A piece of the building\'s own collision stands in the room around ' + f2(p.at[0]) + ', ' + f2(p.at[1]) + ' (' + f2(p.bbox[2] - p.bbox[0]) + ' x ' + f2(p.bbox[3] - p.bbox[1]) + ' m): you cannot see it, but it blocks the player.', at: p.at, bbox: p.bbox, act: 'selectCollision' }));
        // ---- 4. doorways ----
        const ops = (built.shell && built.shell.resolved) || [], doors = [];
        const rawAt = (x, y) => { const k = cellOf(x, y); return k < 0 ? 7 : solid[k]; };
        const reachNear = (x, y, r) => { const k = cellOf(x, y); if (k < 0) return false; const i = k % nx, j = (k / nx) | 0, rr = Math.ceil(r / cs); for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && reach[jj * nx + ii]) return true; } return false; };
        ops.filter(op => op.type === 'door' || op.type === 'arch').forEach((op, n) => {
            const uc = (op.u0 + op.u1) / 2, horiz = op.o === 'H', pt = (u, d) => horiz ? [u, op.c + op.inward * d] : [op.c + op.inward * d, u], pin = pt(uc, 0.7), pout = pt(uc, -0.7);
            const name = (op.type === 'arch' ? 'Archway' : 'Door') + ' at ' + f2(horiz ? uc : op.c) + ', ' + f2(horiz ? op.c : uc), at = pt(uc, 0);
            // free width of the opening at the wall (the narrowest over the thickness of the wall), from the solid cells
            let width = 1e9; for (const d of [-0.04, 0.02, 0.06, 0.1]) { let a = uc, b = uc; while (a > uc - 1.6 && !rawAt(...pt(a - cs, d))) a -= cs; while (b < uc + 1.6 && !rawAt(...pt(b + cs, d))) b += cs; width = Math.min(width, b - a); }
            const inR = reachNear(pin[0], pin[1], 0.3); let blockedBits = 0, firstBlock = null;
            for (let d = 0.7; d >= -0.7; d -= cs) { const p = pt(uc, d), k = cellOf(p[0], p[1]); if (k < 0 || blk[k]) { blockedBits |= k < 0 ? 0 : blk[k]; if (!firstBlock) firstBlock = p; } }
            // what stops the player: something of yours or of the building in the way first, then a doorway that is simply too narrow, then the interior's own frame, then a room nobody can reach
            let status, text; const narrow = width < 2 * R + 0.02, where = firstBlock ? ' near ' + f2(firstBlock[0]) + ', ' + f2(firstBlock[1]) : '';
            if (blockedBits & 2) { status = 'blocked'; text = name + ' (' + f2(op.u1 - op.u0) + ' m wide) is blocked by ' + causeOf(2) + where + ': the player cannot walk through.'; }
            else if (narrow) { status = 'narrow'; text = name + ' is only ' + f2(width) + ' m wide between its frame and the walls: the player needs ' + f2(2 * R) + ' m.'; }
            else if (blockedBits & 4) { status = 'blocked'; text = name + ' (' + f2(op.u1 - op.u0) + ' m wide) is blocked by ' + causeOf(4) + where + ': the player cannot walk through.'; }
            else if (blockedBits) { status = 'blocked'; text = name + ' (' + f2(op.u1 - op.u0) + ' m wide) is blocked by ' + causeOf(blockedBits) + where + ': the player cannot walk through (the opening is too low or has something across it).'; }
            else if (!inR) { status = 'closed'; text = name + ': the room in front of it cannot be reached from the start (see the closed-off parts).'; }
            else { status = 'ok'; text = name + ': you can walk through it (' + f2(width) + ' m clear).'; }
            doors.push({ status, at, text, bbox: null });
            if (status !== 'ok') problems.push({ sev: status === 'narrow' ? 'warn' : 'bad', kind: 'door', text, at: firstBlock || at, bbox: null, act: status === 'blocked' && (blockedBits & 4) ? 'selectCollision' : null, box: [Math.min(pin[0], pout[0]) - 0.3, Math.min(pin[1], pout[1]) - 0.3, Math.max(pin[0], pout[0]) + 0.3, Math.max(pin[1], pout[1]) + 0.3] });
        });
        // ---- 5. ways out of the rooms that are not a doorway ----
        const cross = [], seenX = new Set();
        for (let k = 0; k < N; k++) {
            if (!reach[k] || !inReg[k]) continue; const i = k % nx, j = (k / nx) | 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const m = jj * nx + ii; if (!inReg[m] && reach[m] && !seenX.has(m)) { seenX.add(m); cross.push([cx(ii), cy(jj)]); } }
        }
        const clusters = []; cross.forEach(p => { const c = clusters.find(c => Math.hypot(c.x - p[0], c.y - p[1]) < 0.7); if (c) { c.x = (c.x * c.n + p[0]) / (c.n + 1); c.y = (c.y * c.n + p[1]) / (c.n + 1); c.n++; } else clusters.push({ x: p[0], y: p[1], n: 1 }); });
        const nearOp = (c, types, slack) => ops.some(op => types.indexOf(op.type) >= 0 && ((op.o === 'H') ? (Math.abs(c.y - op.c) <= 1.0 && c.x >= op.u0 - slack && c.x <= op.u1 + slack) : (Math.abs(c.x - op.c) <= 1.0 && c.y >= op.u0 - slack && c.y <= op.u1 + slack)));
        const leaks = [];
        clusters.forEach(c => {
            if (nearOp(c, ['door', 'arch'], 0.6)) return;
            const win = nearOp(c, ['window'], 0.6); leaks.push([c.x, c.y]);
            problems.push({ sev: 'bad', kind: 'leak', text: win ? 'You can walk out through the window near ' + f2(c.x) + ', ' + f2(c.y) + ': it has no collision across it.' : 'You can walk out of the rooms through a gap in the walls near ' + f2(c.x) + ', ' + f2(c.y) + ' (the opening is at least ' + f2(R * 2) + ' m wide).', at: [c.x, c.y], bbox: null });
        });
        // ---- 6. boxes that float ----
        const cb = (P.import.cboxes || []), cbBoxes = (built.boxes || []).filter(b => b[7] && b[7].user);
        cb.forEach(b => {
            if (b.zb <= 0.05) return; const mine = cbBoxes.find(x => x[7].user === b.id); if (!mine) return;
            const lo = [mine[0] - 0.03, mine[1] - 0.03, mine[2] - 0.03], hi = [mine[3] + 0.03, mine[4] + 0.03, mine[5] + 0.03], hit = (x0, y0, z0, x1, y1, z1) => x0 <= hi[0] && x1 >= lo[0] && y0 <= hi[1] && y1 >= lo[1] && z0 <= hi[2] && z1 >= lo[2];
            let touch = (built.boxes || []).some(o => o !== mine && hit(o[0], o[1], o[2], o[3], o[4], o[5]));
            if (!touch && fin) for (let i = 0; i < fin.n && !touch; i++) { const o = i * 12, np = fin.kind[i] === 0 ? 3 : 4; let a = 1e9, bq = 1e9, c = 1e9, d = -1e9, e = -1e9, f = -1e9; for (let k = 0; k < np; k++) { const x = fin.c[o + k * 3], y = fin.c[o + k * 3 + 1], z = fin.c[o + k * 3 + 2]; a = Math.min(a, x); bq = Math.min(bq, y); c = Math.min(c, z); d = Math.max(d, x); e = Math.max(e, y); f = Math.max(f, z); } if (hit(a, bq, c, d, e, f)) touch = true; }
            if (!touch) problems.push({ sev: 'warn', kind: 'float', text: 'A collision box of yours floats: its bottom is ' + f2(b.zb) + ' m above the floor and it touches nothing (' + M.COLMATS.get(b.mat).name + ', at ' + f2(b.cx) + ', ' + f2(b.cy) + ').', at: [b.cx, b.cy], bbox: null, boxId: b.id });
        });

        // ---- what to draw ----
        const overlay = { reach: rectsOf(k => inReg[k] && reach[k]), pockets: rectsOf(k => inReg[k] && standable(k) && !reach[k]), holes: rectsOf(k => inReg[k] && !floor[k]), blockers: rectsOf(k => inReg[k] && !nearOut[k] && (solid[k] & 4)), doors, leaks };
        problems.sort((a, b) => (a.sev === b.sev ? 0 : (a.sev === 'bad' ? -1 : 1)));
        const info = { gx0, gy0, cs, nx, ny, solid, blk, reach, inReg, floor };
        return { problems, stats, empty: false, start: [sx, sy], startCell: best, overlay, cfg: Object.assign({}, cf), startNote, nDoors: doors.length, nOk: doors.filter(d => d.status === 'ok').length, grid: info, building: fin ? fin.n : 0 };
    }

    W._analyse = analyse;                                 // (for tests: the check on a build that was changed by hand)

    // ---------- the view ----------
    W.show = function (p) {
        const cam = M.App.renderer.camera; if (!p || !p.at) return; cam.target = [p.at[0], p.at[1], 0.6]; cam.dist = Math.min(cam.dist, 7); W.focus = { at: p.at.slice(), t: performance.now() };
    };
    W.draw = function (R, label) {
        const res = W.result, z = 0.035, quad = (r, col, zz) => { const h = zz || z; R.ovTopQuad([r[0], r[1], h], [r[2], r[1], h], [r[2], r[3], h], [r[0], r[3], h], col); };
        const c = cfg(), st = res && res.start ? res.start : (W.start || null);
        if (res && res.overlay && S.showWalkOverlay !== false) {
            const ov = res.overlay, stale = W.stale();
            ov.reach.forEach(r => quad(r, stale ? [0.6, 0.6, 0.6, 0.10] : [0.35, 0.9, 0.55, 0.16]));
            ov.pockets.forEach(r => quad(r, [1, 0.6, 0.2, 0.40], z + 0.002)); ov.holes.forEach(r => quad(r, [0.95, 0.3, 0.9, 0.55], z + 0.003)); ov.blockers.forEach(r => quad(r, [1, 0.25, 0.25, 0.60], z + 0.004));
            ov.doors.forEach(d => { const col = d.status === 'ok' ? [0.4, 1, 0.5, 0.95] : (d.status === 'narrow' ? [1, 0.85, 0.3, 0.95] : [1, 0.3, 0.3, 0.95]); R.ovTopLine([d.at[0], d.at[1], 0.0], [d.at[0], d.at[1], 2.0], col); R.ovTopLine([d.at[0] - 0.25, d.at[1], 1.0], [d.at[0] + 0.25, d.at[1], 1.0], col); R.ovTopLine([d.at[0], d.at[1] - 0.25, 1.0], [d.at[0], d.at[1] + 0.25, 1.0], col); });
            ov.leaks.forEach(p => { R.ovTopLine([p[0], p[1], 0], [p[0], p[1], 2.2], [1, 0.3, 0.3, 1]); R.ovTopQuad([p[0] - 0.3, p[1] - 0.3, 0.06], [p[0] + 0.3, p[1] - 0.3, 0.06], [p[0] + 0.3, p[1] + 0.3, 0.06], [p[0] - 0.3, p[1] + 0.3, 0.06], [1, 0.3, 0.3, 0.5]); });
        }
        if (st) R.ovOBox([st[0], st[1], c.h / 2], c.r, c.r, c.h / 2, 0, [0.45, 0.8, 1, 0.22], [0.7, 0.92, 1, 1]);
        if (W.focus) { const a = W.focus.at, s = 0.35 + 0.1 * Math.sin((performance.now() - W.focus.t) / 150); R.ovTopQuad([a[0] - s, a[1] - s, 0.08], [a[0] + s, a[1] - s, 0.08], [a[0] + s, a[1] + s, 0.08], [a[0] - s, a[1] + s, 0.08], [1, 0.95, 0.4, 0.45]); for (let i = 0; i < 4; i++) { const p = [[-s, -s], [s, -s], [s, s], [-s, s]][i], q = [[-s, -s], [s, -s], [s, s], [-s, s]][(i + 1) % 4]; R.ovTopLine([a[0] + p[0], a[1] + p[1], 0.09], [a[0] + q[0], a[1] + q[1], 0.09], [1, 1, 0.6, 1]); } }
        if (label) label(null, null);
    };
})(window.MLO);
