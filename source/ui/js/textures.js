// Procedural, tileable, flat/muted materials. The same pixels feed the 3D preview and the exported .ytd.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const SIZE = 256;

    function hash(x, y, s) {
        let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
        return ((h >>> 0) & 0xFFFFFF) / 0x1000000;
    }
    function vnoise(x, y, per, seed) {
        const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per, y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
        const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function fbm(u, v, cells, seed) {
        let s = 0, amp = 0.5, tot = 0, per = cells;
        for (let o = 0; o < 4; o++) { s += amp * vnoise(u * per, v * per, per, seed + o * 17); tot += amp; amp *= 0.5; per *= 2; }
        return s / tot;
    }

    // ---------- pattern functions: (u, v in 0..1) -> [r, g, b, height] ----------
    // height 0..1 (1 = the face of a brick, a tile, a plank; 0 = the mortar, grout or gap between them): the normal map and the specular map are made from it
    const K = {
        flat(u, v, p) {
            const n = fbm(u, v, 3, p.seed || 5), g = vnoise(u * SIZE / 2, v * SIZE / 2, SIZE / 2, (p.seed || 5) + 3);
            let k = 1 + (n - 0.5) * (p.amp != null ? p.amp : 0.05) + (g - 0.5) * (p.grain != null ? p.grain : 0.03);
            let h = 0.5 + (n - 0.5) * 0.5 + (vnoise(u * 32, v * 32, 32, (p.seed || 5) + 9) - 0.5) * 0.25;          // (the bumps: softer than the colour grain)
            if (p.pits && hash(Math.floor(u * SIZE), Math.floor(v * SIZE), 91) < p.pits) { k *= 0.8; h = 0.1; }
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, h];
        },
        carpet(u, v, p) {
            const g = vnoise(u * SIZE, v * SIZE, SIZE, 17), g2 = vnoise(u * SIZE / 3, v * SIZE / 3, SIZE / 3, 21), n = fbm(u, v, 4, 33);
            const k = 1 + (g - 0.5) * 0.16 + (g2 - 0.5) * 0.06 + (n - 0.5) * 0.06;
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.5 + (n - 0.5) * 0.5 + (vnoise(u * 48, v * 48, 48, 23) - 0.5) * 0.3];          // (a soft pile: per-pixel noise would shimmer)
        },
        brick(u, v, p) {
            const ry = v * p.rows, r = Math.floor(ry), fv = ry - r;
            const off = p.shuffle ? hash(r, 3, 17) : (r % 2) * (p.shift != null ? p.shift : 0.5);
            const cx = u * p.cols + off, c = Math.floor(cx), fu = cx - c;
            const cw = ((c % p.cols) + p.cols) % p.cols, rw = ((r % p.rows) + p.rows) % p.rows;
            const bw = SIZE / p.cols, bh = SIZE / p.rows, mw = (p.mw || 2) * 0.5;
            const du = Math.min(fu, 1 - fu) * bw, dv = Math.min(fv, 1 - fv) * bh;
            const g = vnoise(u * SIZE / 2, v * SIZE / 2, SIZE / 2, 7);
            if (du < mw || dv < mw) { const k = 1 + (g - 0.5) * 0.08; return [p.mortar[0] * k, p.mortar[1] * k, p.mortar[2] * k, 0.08 + g * 0.08]; }
            const vary = p.vary != null ? p.vary : 0.12, f = fbm(u, v, 4, 13);
            let k = 1 + (hash(cw, rw, 41) - 0.5) * 2 * vary + (f - 0.5) * 0.10 + (g - 0.5) * 0.06;
            const edge = Math.min(1, Math.min(du, dv) - mw) / 1.6;                                 // (the brick's edge rounds down to the mortar)
            if (du < mw + 1.2 || dv < mw + 1.2) k *= 0.93;
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.55 + 0.35 * Math.min(1, edge) + (f - 0.5) * 0.2];
        },
        plank(u, v, p) {
            const n = p.n || 6, pu = u * n, pi = Math.floor(pu), fu = pu - pi;
            const segs = p.segs || 2, seg = v * segs + hash(pi, 0, 41) * segs, sj = Math.floor(seg), fv = seg - sj;
            const sid = ((sj % segs) + segs) % segs;
            const tone = 0.90 + hash(pi, sid, 43) * 0.20;
            const grain = vnoise(u * 14, v * 14, 14, 7 + pi), streak = vnoise(u * 30, v * 30, 30, 61 + pi);
            let k = tone * (0.95 + (grain - 0.5) * 0.10 + (streak - 0.5) * 0.06), h = 0.7 + (streak - 0.5) * 0.15;
            if (fu < 0.03 || fu > 0.97 || fv < 0.012 || fv > 0.988) { k *= 0.66; h = 0.1; }
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, h];
        },
        tile(u, v, p) {
            const n = p.n || 4, tu = u * n, tv = v * n, ti = Math.floor(tu), tj = Math.floor(tv), fu = tu - ti, fv = tv - tj;
            const edge = (p.grout || 3) / (SIZE / n) * 0.5;
            const g = vnoise(u * SIZE / 3, v * SIZE / 3, SIZE / 3, 13);
            const colr = p.b && ((ti + tj) & 1) ? p.b : p.base;
            const vari = 0.97 + hash(ti % n, tj % n, 77) * 0.06;
            const k = vari * (1 + (g - 0.5) * 0.03);
            if (fu < edge || fu > 1 - edge || fv < edge || fv > 1 - edge) return [p.groutCol[0] * k, p.groutCol[1] * k, p.groutCol[2] * k, 0.05];
            return [colr[0] * k, colr[1] * k, colr[2] * k, 0.85 + (g - 0.5) * 0.04];
        },
        shingle(u, v, p) {
            const rows = p.rows || 10, rv = v * rows, ri = Math.floor(rv), fv = rv - ri;
            const cols = p.cols || 5, ru = u * cols + (ri % 2) * 0.5, ci = Math.floor(ru), fu = ru - ci;
            const cw = ((ci % cols) + cols) % cols;
            const vari = 0.88 + hash(cw, ri % rows, 91) * 0.24, g = vnoise(u * SIZE / 3, v * SIZE / 3, SIZE / 3, 31);
            let k = vari * (0.95 + (g - 0.5) * 0.10);
            k *= fv < 0.12 ? 0.62 : (fv > 0.9 ? 1.05 : 1.0);
            if (fu < 0.03 || fu > 0.97) k *= 0.7;
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, fu < 0.03 || fu > 0.97 ? 0.2 : 0.25 + fv * 0.7];
        },
        corrugated(u, v, p) {
            const ribs = p.ribs || 16, s = Math.sin(u * ribs * Math.PI * 2);
            const g = vnoise(u * SIZE / 2, v * SIZE / 2, SIZE / 2, 35), n = fbm(u, v, 3, 37);
            const k = (0.86 + 0.14 * s) * (1 + (g - 0.5) * 0.05 + (n - 0.5) * 0.08);
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.5 + 0.45 * s];
        },
        panel(u, v, p) {
            const base = K.flat(u, v, p), np = p.n || 2, fu = (u * np) % 1, fv = (v * np) % 1;
            const du = Math.min(fu, 1 - fu) * SIZE / np, dv = Math.min(fv, 1 - fv) * SIZE / np;
            let k = 1, h = base[3];
            if (du < 1.6 || dv < 1.6) { k = 0.72; h = 0.1; }
            // tie holes
            const hx = (fu - 0.12) * SIZE / np, hy = (fv - 0.12) * SIZE / np;
            if (hx * hx + hy * hy < 5) { k = 0.65; h = 0.05; }
            return [base[0] * k, base[1] * k, base[2] * k, h];
        },
        // marble: soft veins through a polished slab, joints between slabs
        marble(u, v, p) {
            const n = fbm(u, v, 3, p.seed || 71), w = fbm(u + n * 0.7, v + n * 0.5, 2, (p.seed || 71) + 5);
            const vein = Math.pow(1 - Math.abs(Math.sin((u * 2 + v * 1.3 + w * 3.2) * Math.PI)), p.sharp || 12);
            const t = Math.min(1, vein * 0.9 + (n - 0.5) * 0.15), c0 = p.base, c1 = p.vein;
            const ns = p.n || 2, fu = (u * ns) % 1, fv = (v * ns) % 1, joint = Math.min(fu, 1 - fu, fv, 1 - fv) * SIZE / ns < 0.8;
            if (joint) return [c0[0] * 0.8, c0[1] * 0.8, c0[2] * 0.8, 0.3];
            return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, 0.9];
        },
        // terrazzo: chips of stone in a cement ground
        terrazzo(u, v, p) {
            const cells = 22, gu = u * cells, gv = v * cells, ci = Math.floor(gu), cj = Math.floor(gv);
            let best = 9, id = 0;
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const x = ci + dx, y = cj + dy, wx = ((x % cells) + cells) % cells, wy = ((y % cells) + cells) % cells;
                const px = x + hash(wx, wy, 3), py = y + hash(wx, wy, 5), d = Math.hypot(gu - px, gv - py) / (0.25 + hash(wx, wy, 9) * 0.3);
                if (d < best) { best = d; id = hash(wx, wy, 11); }
            }
            const g = vnoise(u * SIZE / 2, v * SIZE / 2, SIZE / 2, 15), k = 1 + (g - 0.5) * 0.05;
            if (best < 1) { const c = p.chips[Math.floor(id * p.chips.length) % p.chips.length]; return [c[0] * k, c[1] * k, c[2] * k, 0.88]; }
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.84];
        },
        // herringbone parquet: short planks at right angles
        herringbone(u, v, p) {
            const n = p.n || 4, x = u * n * 2, y = v * n * 2, row = Math.floor(y - x), col = Math.floor(x + y), up = (((row + col) % 2) + 2) % 2;
            const a = up ? (x + y) / 2 : (y - x) / 2, along = (a - Math.floor(a));
            const fx = up ? (y - x) - Math.floor(y - x) : (x + y) - Math.floor(x + y), fa = (((along * 2) % 1) + 1) % 1;
            const tone = 0.88 + hash(row & 63, col & 63, 13) * 0.22, grain = vnoise(u * 40, v * 40, 40, 7), k = tone * (0.95 + (grain - 0.5) * 0.12);
            if (fx < 0.05 || fx > 0.95 || fa < 0.02 || fa > 0.98) return [p.base[0] * k * 0.6, p.base[1] * k * 0.6, p.base[2] * k * 0.6, 0.1];
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.75];
        },
        // wallpaper: stripes or a diamond print over a paper grain
        paper(u, v, p) {
            const g = vnoise(u * SIZE, v * SIZE, SIZE, 19), k = 1 + (g - 0.5) * 0.03; let c = p.base, h = 0.5 + (g - 0.5) * 0.3;
            if (p.stripes) { const s = (u * p.stripes) % 1; if (s < p.width) { c = p.b; h += 0.05; } }
            else { const m = p.n || 6, du = Math.abs(((u * m) % 1) - 0.5), dv = Math.abs(((v * m) % 1) - 0.5); if (du + dv < 0.32 && du + dv > 0.22) { c = p.b; h += 0.06; } if (du + dv < 0.08) c = p.b; }
            return [c[0] * k, c[1] * k, c[2] * k, h];
        },
        // a carpet with a printed pattern (hotel and casino carpets)
        pcarpet(u, v, p) {
            const base = K.carpet(u, v, p), m = p.n || 4, fu = (u * m) % 1, fv = (v * m) % 1, d = Math.abs(fu - 0.5) + Math.abs(fv - 0.5), r = Math.hypot(fu - 0.5, fv - 0.5);
            let c = null; if (d > 0.42 && d < 0.5) c = p.b; else if (r < 0.14) c = p.c; else if (r > 0.2 && r < 0.24) c = p.b;
            if (!c) return base; const k = base[0] / p.base[0]; return [c[0] * k, c[1] * k, c[2] * k, base[3]];
        },
        // brushed metal: fine streaks one way
        brushed(u, v, p) {
            const s = vnoise(u * 3, v * SIZE, SIZE, 27), s2 = vnoise(u * 9, v * SIZE / 2, SIZE / 2, 29), k = 0.93 + (s - 0.5) * 0.14 + (s2 - 0.5) * 0.06;
            return [p.base[0] * k, p.base[1] * k, p.base[2] * k, 0.5 + (s - 0.5) * 0.25];
        },
        // wainscot / beadboard: vertical boards with grooves
        bead(u, v, p) {
            const n = p.n || 8, fu = (u * n) % 1, g = vnoise(u * SIZE / 2, v * SIZE / 2, SIZE / 2, 33), k = 1 + (g - 0.5) * 0.03;
            const groove = fu < 0.05 ? 0.15 : (fu < 0.1 ? 0.6 : 0.85), dark = fu < 0.05 ? 0.78 : 1;
            return [p.base[0] * k * dark, p.base[1] * k * dark, p.base[2] * k * dark, groove];
        }
    };

    const C = (r, g, b) => [r, g, b];
    // id, name, category, tile (metres per repeat), kind, params
    const LIST = [
        ['brick_red', 'Red Brick', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(150, 82, 66), mortar: C(184, 178, 168) }],
        ['brick_brown', 'Brown Brick', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(116, 82, 62), mortar: C(176, 170, 160) }],
        ['brick_cream', 'Cream Brick', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(198, 182, 150), mortar: C(196, 192, 184), vary: 0.08 }],
        ['brick_london', 'London Stock', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(172, 148, 106), mortar: C(190, 184, 172) }],
        ['brick_grey', 'Grey Brick', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(126, 127, 125), mortar: C(168, 166, 160) }],
        ['brick_charcoal', 'Charcoal Brick', 'Brick', 0.9, 'brick', { cols: 4, rows: 12, base: C(72, 74, 78), mortar: C(138, 136, 130) }],
        ['stone_ash', 'Ashlar Stone', 'Stone', 1.0, 'brick', { cols: 3, rows: 6, base: C(150, 148, 140), mortar: C(112, 110, 104), mw: 3, shuffle: true, vary: 0.10 }],
        ['stone_sand', 'Sandstone', 'Stone', 1.0, 'brick', { cols: 3, rows: 6, base: C(192, 174, 138), mortar: C(150, 136, 108), mw: 3, shuffle: true, vary: 0.09 }],
        ['stone_slate', 'Slate Flags', 'Stone', 1.0, 'brick', { cols: 2, rows: 4, base: C(88, 92, 96), mortar: C(60, 62, 66), mw: 4, shuffle: true, vary: 0.10 }],
        ['concrete', 'Smooth Concrete', 'Concrete', 1.0, 'flat', { base: C(166, 165, 160), amp: 0.10, grain: 0.06, pits: 0.003, seed: 51 }],
        ['concrete_dark', 'Dark Concrete', 'Concrete', 1.0, 'flat', { base: C(112, 112, 110), amp: 0.10, grain: 0.06, pits: 0.003, seed: 53 }],
        ['concrete_panel', 'Concrete Panels', 'Concrete', 1.0, 'panel', { base: C(170, 168, 162), amp: 0.08, grain: 0.05, n: 2, seed: 57 }],
        ['concrete_block', 'Concrete Block', 'Concrete', 1.0, 'brick', { cols: 2, rows: 5, base: C(158, 157, 150), mortar: C(128, 127, 122), mw: 3, vary: 0.05 }],
        ['plaster_white', 'White Plaster', 'Plaster', 1.0, 'flat', { base: C(232, 230, 224), amp: 0.03, grain: 0.015, seed: 3 }],
        ['plaster_cream', 'Cream Plaster', 'Plaster', 1.0, 'flat', { base: C(214, 205, 188), amp: 0.04, grain: 0.02, seed: 11 }],
        ['plaster_grey', 'Light Grey', 'Plaster', 1.0, 'flat', { base: C(190, 190, 188), amp: 0.03, grain: 0.02, seed: 23 }],
        ['plaster_warm', 'Warm Beige', 'Plaster', 1.0, 'flat', { base: C(200, 186, 168), amp: 0.04, grain: 0.02, seed: 13 }],
        ['plaster_sage', 'Sage Green', 'Plaster', 1.0, 'flat', { base: C(150, 168, 146), amp: 0.04, grain: 0.02, seed: 29 }],
        ['plaster_blue', 'Dusty Blue', 'Plaster', 1.0, 'flat', { base: C(146, 162, 178), amp: 0.04, grain: 0.02, seed: 31 }],
        ['plaster_terra', 'Terracotta', 'Plaster', 1.0, 'flat', { base: C(184, 124, 98), amp: 0.05, grain: 0.02, seed: 37 }],
        ['plaster_char', 'Charcoal', 'Plaster', 1.0, 'flat', { base: C(84, 86, 90), amp: 0.04, grain: 0.02, seed: 41 }],
        ['plaster_navy', 'Navy', 'Plaster', 1.0, 'flat', { base: C(56, 66, 86), amp: 0.04, grain: 0.02, seed: 43 }],
        ['tile_white', 'White Tile', 'Tile', 0.8, 'tile', { n: 4, grout: 3, base: C(198, 200, 198), groutCol: C(146, 148, 146) }],
        ['tile_grey', 'Grey Tile', 'Tile', 0.8, 'tile', { n: 4, grout: 3, base: C(138, 142, 144), groutCol: C(98, 100, 102) }],
        ['tile_black', 'Black Tile', 'Tile', 0.8, 'tile', { n: 4, grout: 3, base: C(58, 60, 62), groutCol: C(100, 100, 98) }],
        ['tile_check', 'Checker Tile', 'Tile', 0.8, 'tile', { n: 4, grout: 2, base: C(218, 218, 214), b: C(52, 54, 56), groutCol: C(120, 120, 118) }],
        ['tile_terra', 'Terracotta Tile', 'Tile', 0.8, 'tile', { n: 3, grout: 4, base: C(166, 104, 76), groutCol: C(128, 118, 108) }],
        ['wood_oak', 'Oak Planks', 'Wood', 1.2, 'plank', { n: 6, base: C(168, 130, 92) }],
        ['wood_walnut', 'Walnut Planks', 'Wood', 1.2, 'plank', { n: 6, base: C(98, 68, 48) }],
        ['wood_pine', 'Pine Planks', 'Wood', 1.2, 'plank', { n: 6, base: C(196, 164, 118) }],
        ['wood_ash', 'Grey Ash', 'Wood', 1.2, 'plank', { n: 6, base: C(170, 160, 146) }],
        ['wood_dark', 'Ebony Planks', 'Wood', 1.2, 'plank', { n: 6, base: C(60, 46, 38) }],
        ['wood_white', 'Painted Boards', 'Wood', 1.2, 'plank', { n: 8, base: C(220, 218, 210) }],
        ['roof_slate', 'Slate Roof', 'Roof', 1.0, 'shingle', { base: C(92, 92, 96) }],
        ['roof_terra', 'Clay Roof', 'Roof', 1.0, 'shingle', { base: C(150, 84, 62) }],
        ['roof_brown', 'Brown Shingle', 'Roof', 1.0, 'shingle', { base: C(100, 82, 66) }],
        ['roof_metal', 'Metal Sheet', 'Roof', 1.0, 'corrugated', { base: C(120, 126, 130) }],
        ['carpet_grey', 'Grey Carpet', 'Carpet', 1.0, 'carpet', { base: C(120, 120, 122) }],
        ['carpet_beige', 'Beige Carpet', 'Carpet', 1.0, 'carpet', { base: C(176, 162, 140) }],
        ['carpet_blue', 'Blue-Grey Carpet', 'Carpet', 1.0, 'carpet', { base: C(96, 110, 128) }],
        ['carpet_red', 'Wine Carpet', 'Carpet', 1.0, 'carpet', { base: C(124, 70, 72) }],
        ['metal_sheet', 'Corrugated Steel', 'Metal', 1.0, 'corrugated', { base: C(150, 154, 156), ribs: 12 }],
        ['marble_white', 'White Marble', 'Marble', 1.6, 'marble', { base: C(226, 224, 218), vein: C(150, 150, 154), n: 2, seed: 71 }],
        ['marble_black', 'Black Marble', 'Marble', 1.6, 'marble', { base: C(34, 34, 38), vein: C(170, 166, 160), n: 2, seed: 73, sharp: 18 }],
        ['marble_green', 'Green Marble', 'Marble', 1.6, 'marble', { base: C(40, 70, 58), vein: C(170, 190, 176), n: 2, seed: 77 }],
        ['marble_cream', 'Cream Marble', 'Marble', 1.6, 'marble', { base: C(214, 198, 170), vein: C(170, 140, 110), n: 2, seed: 79 }],
        ['terrazzo_grey', 'Grey Terrazzo', 'Marble', 1.2, 'terrazzo', { base: C(178, 176, 170), chips: [C(90, 90, 92), C(220, 218, 212), C(140, 120, 100), C(60, 62, 66)] }],
        ['terrazzo_warm', 'Warm Terrazzo', 'Marble', 1.2, 'terrazzo', { base: C(206, 190, 170), chips: [C(170, 110, 80), C(240, 232, 220), C(120, 90, 70), C(90, 80, 72)] }],
        ['concrete_polished', 'Polished Concrete', 'Concrete', 2.0, 'flat', { base: C(150, 150, 148), amp: 0.14, grain: 0.03, seed: 59 }],
        ['wood_herring_oak', 'Oak Herringbone', 'Wood', 1.2, 'herringbone', { n: 4, base: C(172, 132, 90) }],
        ['wood_herring_walnut', 'Walnut Herringbone', 'Wood', 1.2, 'herringbone', { n: 4, base: C(104, 72, 50) }],
        ['wood_bead_white', 'White Beadboard', 'Wood', 1.0, 'bead', { n: 8, base: C(226, 224, 216) }],
        ['wood_bead_green', 'Green Beadboard', 'Wood', 1.0, 'bead', { n: 8, base: C(90, 112, 96) }],
        ['paper_stripe_cream', 'Cream Stripe Paper', 'Wallpaper', 1.0, 'paper', { base: C(222, 212, 190), b: C(200, 186, 160), stripes: 8, width: 0.5 }],
        ['paper_stripe_green', 'Green Stripe Paper', 'Wallpaper', 1.0, 'paper', { base: C(76, 100, 82), b: C(96, 122, 100), stripes: 10, width: 0.4 }],
        ['paper_diamond_navy', 'Navy Diamond Paper', 'Wallpaper', 0.8, 'paper', { base: C(44, 52, 76), b: C(170, 150, 100), n: 6 }],
        ['paper_diamond_red', 'Red Diamond Paper', 'Wallpaper', 0.8, 'paper', { base: C(110, 32, 40), b: C(196, 160, 96), n: 6 }],
        ['carpet_casino_red', 'Casino Carpet Red', 'Carpet', 1.6, 'pcarpet', { base: C(120, 28, 36), b: C(196, 150, 70), c: C(40, 30, 60), n: 4 }],
        ['carpet_casino_blue', 'Casino Carpet Blue', 'Carpet', 1.6, 'pcarpet', { base: C(30, 44, 90), b: C(200, 160, 80), c: C(120, 30, 40), n: 4 }],
        ['carpet_hotel_beige', 'Hotel Carpet Beige', 'Carpet', 1.6, 'pcarpet', { base: C(168, 150, 124), b: C(120, 100, 80), c: C(200, 186, 160), n: 5 }],
        ['metal_brushed', 'Brushed Steel', 'Metal', 1.0, 'brushed', { base: C(176, 178, 182) }],
        ['metal_brass', 'Brushed Brass', 'Metal', 1.0, 'brushed', { base: C(190, 152, 80) }],
        ['metal_gold', 'Gold', 'Metal', 1.0, 'brushed', { base: C(212, 170, 76) }],
        ['metal_black', 'Black Metal', 'Metal', 1.0, 'brushed', { base: C(44, 44, 46) }],
        ['trim_white', 'White Trim', 'Trim', 1.0, 'flat', { base: C(236, 236, 232), amp: 0.01, grain: 0.015, seed: 61 }],
        ['trim_dark', 'Dark Trim', 'Trim', 1.0, 'flat', { base: C(60, 56, 52), amp: 0.02, grain: 0.02, seed: 63 }],
        ['trim_wood', 'Wood Trim', 'Trim', 1.0, 'flat', { base: C(112, 80, 56), amp: 0.06, grain: 0.04, seed: 65 }],
        ['trim_black', 'Black Trim', 'Trim', 1.0, 'flat', { base: C(30, 30, 32), amp: 0.01, grain: 0.015, seed: 67 }],
        ['trim_gold', 'Gold Trim', 'Trim', 1.0, 'brushed', { base: C(206, 166, 80) }],
        ['trim_walnut', 'Walnut Trim', 'Trim', 1.0, 'plank', { n: 1, segs: 1, base: C(96, 66, 46) }]
    ];
    // collision surface type by category (values the game's own pack uses)
    const COL = { Brick: 1, Stone: 1, Concrete: 1, Plaster: 101, Tile: 81, Wood: 72, Roof: 1, Carpet: 101, Metal: 1, Trim: 101, Marble: 81, Wallpaper: 101 };
    // how each kind of surface takes light in the game (normal_spec shader): bumpiness of the normal map, specular strength (0..1, then the spec map), and how tight the highlight is
    const SURF = {
        Brick: { bump: 1.2, spec: 0.08, fall: 12 }, Stone: { bump: 1.0, spec: 0.12, fall: 20 }, Concrete: { bump: 0.5, spec: 0.12, fall: 25 }, Plaster: { bump: 0.3, spec: 0.06, fall: 12 },
        Tile: { bump: 0.9, spec: 0.7, fall: 160 }, Wood: { bump: 0.7, spec: 0.35, fall: 60 }, Roof: { bump: 1.0, spec: 0.1, fall: 20 }, Carpet: { bump: 0.7, spec: 0.02, fall: 6 },
        Metal: { bump: 0.4, spec: 0.9, fall: 140 }, Trim: { bump: 0.3, spec: 0.45, fall: 80 }, Marble: { bump: 0.4, spec: 0.85, fall: 220 }, Wallpaper: { bump: 0.4, spec: 0.08, fall: 14 },
        Mine: { bump: 0.6, spec: 0.2, fall: 40 }
    };
    // polished versions of a material's own SURF (concrete_polished is shiny although concrete is not)
    const SURF_ID = { concrete_polished: { bump: 0.3, spec: 0.7, fall: 180 }, wood_white: { bump: 0.6, spec: 0.25, fall: 40 } };

    const byId = {}, cache = {}, maps = {};
    const cats = [];
    LIST.forEach(function (d) {
        const o = { id: d[0], name: d[1], cat: d[2], tile: d[3], kind: d[4], params: d[5], col: COL[d[2]] || 1 };
        byId[o.id] = o; if (cats.indexOf(o.cat) < 0) cats.push(o.cat);
    });

    function clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }

    function generate(id) {
        const d = byId[id]; if (!d) return null;
        const data = new Uint8ClampedArray(SIZE * SIZE * 4), height = new Float32Array(SIZE * SIZE); let r = 0, g = 0, b = 0;
        const fn = K[d.kind];
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
            const c = fn((x + 0.5) / SIZE, (y + 0.5) / SIZE, d.params), o = (y * SIZE + x) * 4;
            data[o] = clamp8(c[0]); data[o + 1] = clamp8(c[1]); data[o + 2] = clamp8(c[2]); data[o + 3] = 255;
            height[y * SIZE + x] = c[3] != null ? c[3] : 0.5;
            r += data[o]; g += data[o + 1]; b += data[o + 2];
        }
        const n = SIZE * SIZE;
        return { id, def: d, size: SIZE, data, height, avg: [r / n / 255, g / n / 255, b / n / 255] };
    }
    // a height for a picture (a photo, an image the user brought): its brightness, smoothed a little
    function heightFromColour(t) {
        const w = t.size, h = new Float32Array(w * w), d = t.data;
        for (let i = 0; i < w * w; i++) h[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        const o = new Float32Array(w * w);
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + w) % w) * w + ((x + dx + w) % w)]; o[y * w + x] = s / 9; }
        return o;
    }
    // the normal map (tangent space, x along u, y along v; flipY for the other convention) and the specular map, both tileable, from the height
    function makeMaps(t, flipY) {
        const w = t.size, H = t.height || (t.height = heightFromColour(t)), nrm = new Uint8ClampedArray(w * w * 4), spc = new Uint8ClampedArray(w * w * 4);
        const sf = SURF_ID[t.id] || SURF[t.def.cat] || SURF.Mine, strength = 2.5 * (w / 256);
        let lo = 1e9, hi = -1e9; for (let i = 0; i < w * w; i++) { if (H[i] < lo) lo = H[i]; if (H[i] > hi) hi = H[i]; }
        const span = Math.max(1e-6, hi - lo);
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
            const at = (xx, yy) => H[((yy + w) % w) * w + ((xx + w) % w)];
            const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
            const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
            let nx = -dx * strength, ny = -dy * strength * (flipY ? -1 : 1), nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
            const o = (y * w + x) * 4; nrm[o] = clamp8((nx * 0.5 + 0.5) * 255); nrm[o + 1] = clamp8((ny * 0.5 + 0.5) * 255); nrm[o + 2] = clamp8((nz * 0.5 + 0.5) * 255); nrm[o + 3] = 255;
            // the low parts (mortar, grout, gaps) shine less than the faces
            const hn = (H[y * w + x] - lo) / span, sv = clamp8(255 * (0.25 + 0.75 * hn));
            spc[o] = sv; spc[o + 1] = sv; spc[o + 2] = sv; spc[o + 3] = 255;
        }
        return { normal: nrm, spec: spc, size: w, bump: sf.bump, specMult: sf.spec, falloff: sf.fall };
    }

    const TEX = {
        SIZE, list: LIST.map(d => byId[d[0]]), cats, byId,
        def(id) { return byId[id] || byId.plaster_cream; },
        tile(id) { return (byId[id] || byId.plaster_cream).tile; },
        colType(id) { return (byId[id] || byId.plaster_cream).col; },
        pixels(id) { if (!byId[id]) id = 'plaster_cream'; return cache[id] || (cache[id] = generate(id)); },
        // swatch canvas for the palette
        swatch(id, px) {
            const t = TEX.pixels(id), c = document.createElement('canvas'); c.width = c.height = px || 64;
            const full = document.createElement('canvas'); full.width = full.height = t.size;
            full.getContext('2d').putImageData(new ImageData(t.data, t.size, t.size), 0, 0);
            const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(full, 0, 0, c.width, c.height); return c;
        },
        gl: {},
        glTexture(gl, id) {
            if (!byId[id]) id = 'plaster_cream';
            const key = id; if (TEX.gl[key]) return TEX.gl[key];
            const t = TEX.pixels(id), tx = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tx);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.size, t.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength));
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
            return (TEX.gl[key] = tx);
        },
        resetGL() { TEX.gl = {}; },
        // the normal and specular maps of a material, for the export (made the first time they are asked for)
        maps(id, flipY) {
            if (!byId[id]) id = 'plaster_cream'; const key = id + (flipY ? '|f' : ''); if (maps[key]) return maps[key];
            return (maps[key] = makeMaps(TEX.pixels(id), flipY));
        },
        // a small picture of a material's normal or specular map, for the texture bench
        mapSwatch(id, which, px) {
            const mp = TEX.maps(id), c = document.createElement('canvas'); c.width = c.height = px || 48; c.title = which === 'normal' ? 'normal map' : 'specular map';
            const full = document.createElement('canvas'); full.width = full.height = mp.size; full.getContext('2d').putImageData(new ImageData(which === 'normal' ? mp.normal : mp.spec, mp.size, mp.size), 0, 0);
            const x = c.getContext('2d'); x.drawImage(full, 0, 0, c.width, c.height); c.style.borderRadius = '3px'; return c;
        },
        surface(id) { const d = byId[id] || byId.plaster_cream; return SURF_ID[d.id] || SURF[d.cat] || SURF.Mine; },
        // Photographs that ship with the program (ui\tex\*.png): square tiles that repeat, 512 x 512 (twice the size of the generated ones), listed first under "Wood".
        // `tile` is how many metres one tile covers.
        PHOTOS: [
            { id: 'photo_oak_grey', name: 'Grey Oak Planks (photo)', file: 'photo_oak_grey.png', tile: 1.4 },
            { id: 'photo_oak_natural', name: 'Natural Oak Strips (photo)', file: 'photo_oak_natural.png', tile: 1.0 }
        ],
        addPhoto(p, source) {
            const w = source.naturalWidth || source.width, c = document.createElement('canvas'); c.width = c.height = w; const x = c.getContext('2d');
            x.drawImage(source, 0, 0, w, w); const img = x.getImageData(0, 0, w, w), d = img.data; let r = 0, g = 0, b = 0;
            for (let i = 0; i < d.length; i += 4) { d[i + 3] = 255; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
            const n = w * w, o = { id: p.id, name: p.name, cat: 'Wood', tile: p.tile, kind: 'photo', params: null, col: COL.Wood };
            if (!byId[p.id]) { const at = TEX.list.findIndex(t => t.cat === 'Wood' && t.kind !== 'photo'); TEX.list.splice(at < 0 ? TEX.list.length : at, 0, o); }          // (after the other photos, before the generated woods)
            byId[p.id] = o; cache[p.id] = { id: p.id, def: o, size: w, data: d, avg: [r / n / 255, g / n / 255, b / n / 255] }; delete maps[p.id]; delete maps[p.id + '|f'];
            if (TEX.gl[p.id]) delete TEX.gl[p.id]; return o;
        },
        loadPhotos() {
            // all the pictures are read first, then listed in the order of PHOTOS
            return Promise.all(TEX.PHOTOS.map(p => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'tex/' + p.file; })))
                .then(ims => { TEX.PHOTOS.forEach((p, i) => { if (ims[i]) { try { TEX.addPhoto(p, ims[i]); } catch (e) { M.Errors.report('textures', e, { quiet: true }); } } }); });
        },
        // images the user brought: drawn to the same size as the built-in textures, listed under "Mine"
        addUser(id, name, tile, source) {
            const c = document.createElement('canvas'); c.width = c.height = SIZE; const x = c.getContext('2d');
            x.drawImage(source, 0, 0, SIZE, SIZE); const img = x.getImageData(0, 0, SIZE, SIZE), d = img.data; let r = 0, g = 0, b = 0;
            for (let i = 0; i < d.length; i += 4) { d[i + 3] = 255; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
            const n = SIZE * SIZE, o = { id, name, cat: 'Mine', tile: tile || 1, kind: 'user', params: null, col: 1 };
            if (!byId[id]) TEX.list.push(o); byId[id] = o; if (cats.indexOf('Mine') < 0) cats.push('Mine');
            cache[id] = { id, def: o, size: SIZE, data: d, avg: [r / n / 255, g / n / 255, b / n / 255] }; delete maps[id]; delete maps[id + '|f'];
            if (TEX.gl[id]) delete TEX.gl[id]; return o;
        },
        clearUser() {
            for (let i = TEX.list.length - 1; i >= 0; i--) if (TEX.list[i].kind === 'user') { delete byId[TEX.list[i].id]; delete cache[TEX.list[i].id]; TEX.list.splice(i, 1); }
            const k = cats.indexOf('Mine'); if (k >= 0) cats.splice(k, 1); TEX.gl = {};
        },
        loadUser(list) {
            TEX.clearUser();
            return Promise.all((list || []).map(t => new Promise(res => { const im = new Image(); im.onload = () => { TEX.addUser(t.id, t.name, t.tile, im); res(); }; im.onerror = () => res(); im.src = t.url; })));
        },
        // the 256 x 256 picture as a PNG for saving with the project
        userUrl(id) {
            const t = cache[id]; if (!t) return ''; const c = document.createElement('canvas'); c.width = c.height = SIZE; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.data), SIZE, SIZE), 0, 0); return c.toDataURL('image/png');
        }
    };
    M.TEX = TEX;
})(window.MLO);
