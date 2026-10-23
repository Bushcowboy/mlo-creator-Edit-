// A human-scale figure (1.8 m by default) to judge floor, ceiling and door heights against. It is only a view aid: it lives in the editor session
// (Model.state.figure), is never saved in the project and never exported. Flat, muted boxes, drawn with the overlay.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state;
    const BODY = [0.58, 0.64, 0.74, 0.96], BODY_HOT = [0.80, 0.83, 0.92, 0.98], EDGE = [0.14, 0.20, 0.31, 0.9], EDGE_HOT = [1, 1, 1, 0.95], GHOST = [0.58, 0.64, 0.74, 0.45];
    // [centre across, centre front, bottom, top, half width, half depth] for a 1.8 m figure: legs, torso, arms, head, nose
    const PARTS = [[-0.10, 0, 0, 0.84, 0.075, 0.11], [0.10, 0, 0, 0.84, 0.075, 0.11], [0, 0, 0.84, 1.46, 0.21, 0.11], [-0.285, 0, 0.86, 1.42, 0.055, 0.07], [0.285, 0, 0.86, 1.42, 0.055, 0.07], [0, 0, 1.50, 1.80, 0.095, 0.105], [0, 0.115, 1.60, 1.68, 0.025, 0.03]];

    function draw(R, f, mode) {
        const k = f.h / 1.8, cs = Math.cos(f.yaw), sn = Math.sin(f.yaw), col = mode === 'ghost' ? GHOST : (mode === 'hot' ? BODY_HOT : BODY), edge = mode === 'hot' ? EDGE_HOT : EDGE;
        PARTS.forEach(p => {
            const u = p[0] * k, n = p[1] * k, z0 = p[2] * k, z1 = p[3] * k;
            R.ovOBox([f.x + u * cs - n * sn, f.y + u * sn + n * cs, f.z + (z0 + z1) / 2], p[4] * k, p[5] * k, (z1 - z0) / 2, f.yaw, col, edge);
        });
    }
    // where a pointer ray meets the ground: the grid's floor (z = 0) or a floor-like surface of the model, whichever is nearer
    function spot(ray, pickModel) {
        let best = null;
        if (Math.abs(ray.d[2]) > 1e-6) { const t = -ray.o[2] / ray.d[2]; if (t > 0) best = { t, x: ray.o[0] + ray.d[0] * t, y: ray.o[1] + ray.d[1] * t, z: 0 }; }
        const m = pickModel && pickModel(ray);
        if (m && m.n[2] > 0.8 && (!best || m.t < best.t)) best = { t: m.t, x: m.p[0], y: m.p[1], z: m.p[2] };
        return best;
    }
    // does the ray touch the figure (a box around it)?
    function hit(ray, f, rayBox) { return !!f && rayBox(ray, [f.x - 0.4, f.y - 0.4, f.z], [f.x + 0.4, f.y + 0.4, f.z + f.h]) != null; }

    M.Figure = { draw, spot, hit, DEFAULT_H: 1.8 };
})(window.MLO);
