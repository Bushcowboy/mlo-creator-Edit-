// Server and world: scan your server's resources folder, see every MLO on a map of the whole state, which files are encrypted, and what overlaps.
// A page of its own (world.html). The 3D view of an area (the game and your MLOs together) is in world3d.js.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TOKEN = (document.querySelector('meta[name="mlo-token"]') || {}).content || '';
    const $ = (id) => document.getElementById(id), el = M.el;
    const COLORS = ['#4f8cff', '#2fae62', '#e0a43a', '#c46bd6', '#4fc1c9', '#e06a5a', '#9fb24a', '#d68a4f', '#7a8cff', '#5ec7a0', '#d9b84f', '#b0709e'];
    async function api(path, method, body) {
        const r = await fetch('/api/' + path, { method: method || 'GET', headers: { 'X-Mlo-Token': TOKEN, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
        if (!r.ok) throw new Error((j && j.error) || ('request failed ' + r.status));
        return j;
    }
    function toast(text, kind) {
        const t = el('div', { class: 'toast ' + (kind || '') }, text); $('toasts').append(t);
        setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, kind === 'err' ? 6000 : 2800);
    }
    const W = M.World = { api, toast, $ };
    const S = W.S = { status: {}, data: null, sel: null, selPlace: null, view: { cx: 0, cy: 1500, scale: 0.06 }, showGame: true, showMaps: true, interiors: { ready: false } };
    const colorOf = (name) => { const rs = S.data ? S.data.resources : []; const i = rs.findIndex(r => r.name === name); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };

    // ---------- scanning ----------
    let poll = 0;
    async function pollStatus() {
        clearTimeout(poll);
        try { S.status = await api('server/status'); } catch (e) { S.status = { error: e.message }; }
        if (S.status.busy) poll = setTimeout(pollStatus, 600);
        else if (S.status.ready && (!S.data || S.data.root !== S.status.root || S.wantResult)) { S.wantResult = false; await loadResult(); }
        renderLeft();
    }
    async function loadResult() {
        try { S.data = await api('server/result'); } catch (e) { toast(e.message, 'err'); return; }
        renderAll(); if (!S.framed) { S.framed = true; frameAll(); }
    }
    async function scan() {
        const path = ($('spath') || {}).value || '';
        if (!path.trim()) { toast('Type or pick your server\'s resources folder first.', 'warn'); return; }
        try { const r = await api('server/scan', 'POST', { path }); if (r && r.ok === false) { toast(r.error, 'err'); return; } S.wantResult = true; S.framed = false; pollStatus(); }
        catch (e) { toast(e.message, 'err'); }
    }
    async function pick() { try { const r = await api('server/pick'); if (r.ok) { $('spath').value = r.path; } } catch (e) { toast(e.message, 'err'); } }
    // the game's interiors on the map: their list (built on the game interiors page, kept in the cache)
    async function loadInteriors() {
        try {
            const st = await api('interiors/status'); S.interiors = st;
            if (st.ready) { S.wantResult = true; await api('server/status'); if (S.status.ready) { toast('Scanning again with the game\'s interiors, so overlaps with them show too...', 'ok'); await rescan(); } return; }
            if (!st.busy) { const r = await api('interiors/index', 'POST', { gta: st.gta || '' }); if (r && r.ok === false) { toast(r.error, 'err'); return; } }
            toast('Reading the list of the game\'s interiors (a few minutes the first time)...', 'ok');
            const wait = async () => { const s2 = await api('interiors/status'); S.interiors = s2; renderLeft(); if (s2.busy) setTimeout(wait, 1000); else if (s2.ready) { if (S.status.ready) await rescan(); } else if (s2.error) toast(s2.error, 'err'); };
            setTimeout(wait, 1000);
        } catch (e) { toast(e.message, 'err'); }
    }
    async function rescan() { const path = S.status.root || ($('spath') || {}).value; if (!path) return; await api('server/scan', 'POST', { path }); S.wantResult = true; pollStatus(); }

    // ---------- the map ----------
    const cv = () => $('map');
    const toS = (x, y) => { const c = cv(), v = S.view, d = devicePixelRatio; return [c.width / 2 + (x - v.cx) * v.scale * d, c.height / 2 - (y - v.cy) * v.scale * d]; };
    const toW = (sx, sy) => { const c = cv(), v = S.view, d = devicePixelRatio; return [v.cx + (sx * d - c.width / 2) / (v.scale * d), v.cy - (sy * d - c.height / 2) / (v.scale * d)]; };
    function resize() { const c = cv(), r = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width * devicePixelRatio)); c.height = Math.max(1, Math.round(r.height * devicePixelRatio)); draw(); if (W.view3d) W.view3d.resize(); }
    function frameAll() {
        const mn = [1e9, 1e9], mx = [-1e9, -1e9]; let any = false;
        (S.data ? S.data.resources : []).forEach(r => r.places.forEach(p => { any = true; mn[0] = Math.min(mn[0], p.wmin[0]); mn[1] = Math.min(mn[1], p.wmin[1]); mx[0] = Math.max(mx[0], p.wmax[0]); mx[1] = Math.max(mx[1], p.wmax[1]); }));
        if (!any) { mn[0] = -4000; mn[1] = -4000; mx[0] = 4500; mx[1] = 8000; }
        const r = cv().getBoundingClientRect(); S.view.cx = (mn[0] + mx[0]) / 2; S.view.cy = (mn[1] + mx[1]) / 2;
        S.view.scale = Math.max(0.02, Math.min(40, 0.85 * Math.min(r.width / Math.max(40, mx[0] - mn[0]), r.height / Math.max(40, mx[1] - mn[1])))); draw();
    }
    W.flyTo = function (x, y, size) { const r = cv().getBoundingClientRect(); S.view.cx = x; S.view.cy = y; S.view.scale = Math.max(0.05, Math.min(40, Math.min(r.width, r.height) / Math.max(20, size || 80))); draw(); };
    let queued = false; function draw() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; drawNow(); }); }
    W.draw = draw;
    function drawNow() {
        const c = cv(), g = c.getContext('2d'), d = devicePixelRatio; g.clearRect(0, 0, c.width, c.height);
        const step = S.view.scale > 2 ? 10 : (S.view.scale > 0.3 ? 100 : 1000), w0 = toW(0, c.height / d), w1 = toW(c.width / d, 0);
        g.lineWidth = 1; g.strokeStyle = 'rgba(130,160,210,0.07)'; g.beginPath();
        for (let x = Math.floor(w0[0] / step) * step; x <= w1[0]; x += step) { const s = toS(x, 0)[0]; g.moveTo(s, 0); g.lineTo(s, c.height); }
        for (let y = Math.floor(w0[1] / step) * step; y <= w1[1]; y += step) { const s = toS(0, y)[1]; g.moveTo(0, s); g.lineTo(c.width, s); }
        g.stroke();
        // where the game has things (a rough map from its map files), when it was read
        if (S.grid && S.grid.img) { const G = S.grid, a = toS(G.ox, G.oy + G.h * G.cell), b = toS(G.ox + G.w * G.cell, G.oy); g.imageSmoothingEnabled = S.view.scale < 0.5; g.drawImage(G.img, a[0], a[1], b[0] - a[0], b[1] - a[1]); }
        // the state's outline (roughly): Los Santos and Blaine County lie in x -4000..4500, y -4000..8000
        const a0 = toS(-4000, -4000), a1 = toS(4500, 8000); g.strokeStyle = 'rgba(130,160,210,0.18)'; g.setLineDash([6 * d, 6 * d]); g.strokeRect(a0[0], a1[1], a1[0] - a0[0], a0[1] - a1[1]); g.setLineDash([]);
        // the places of a building looked up by name
        (S.pick.places || []).forEach((p, i) => { const s = toS(p.x, p.y); g.strokeStyle = '#e0a43a'; g.lineWidth = 2 * d; g.beginPath(); g.arc(s[0], s[1], 7 * d, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#e0a43a'; g.font = (11 * d) + 'px Segoe UI, sans-serif'; g.fillText(String(i + 1), s[0] + 9 * d, s[1] - 6 * d); });
        if (!S.data) return;
        // the game's interiors: small grey dots
        if (S.showGame) { g.fillStyle = 'rgba(170,180,200,0.45)'; const ds = Math.max(2, 2.5 * d); (S.data.gameInteriors || []).forEach(p => { const s = toS(p[0], p[1]); g.fillRect(s[0] - ds / 2, s[1] - ds / 2, ds, ds); }); }
        // plain map files of the resources: faint outlines
        if (S.showMaps) S.data.resources.forEach(r => { g.strokeStyle = colorOf(r.name) + '55'; g.lineWidth = 1 * d; r.mapBoxes.forEach(b => { const s0 = toS(b[0], b[1]), s1 = toS(b[3], b[4]); g.strokeRect(s0[0], s1[1], s1[0] - s0[0], s0[1] - s1[1]); }); });
        // the MLOs: their boxes, at least a dot when the map is zoomed out
        let n = 0;
        S.data.resources.forEach(r => r.places.forEach((p, i) => {
            n++; const col = colorOf(r.name), on = S.sel === r.name, ps = S.selPlace && S.selPlace.r === r.name && S.selPlace.i === i;
            const s0 = toS(p.wmin[0], p.wmin[1]), s1 = toS(p.wmax[0], p.wmax[1]), w = s1[0] - s0[0], h = s0[1] - s1[1];
            if (w < 5 * d) { g.fillStyle = col; g.beginPath(); g.arc((s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2, (ps ? 5 : (on ? 4 : 3)) * d, 0, Math.PI * 2); g.fill(); if (ps || on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5 * d; g.stroke(); } }
            else { g.fillStyle = col + (on || ps ? '40' : '22'); g.fillRect(s0[0], s1[1], w, h); g.strokeStyle = ps ? '#fff' : col; g.lineWidth = (ps ? 2 : 1.2) * d; g.strokeRect(s0[0], s1[1], w, h); if (w > 60 * d) { g.fillStyle = '#dfe6f3'; g.font = (11 * d) + 'px Segoe UI, sans-serif'; g.fillText(p.name, s0[0] + 3 * d, s1[1] + 13 * d); } }
        }));
        // overlaps: red rings
        (S.data.conflicts || []).forEach((cf, i) => { if (!cf.at) return; const s = toS(cf.at[0], cf.at[1]); g.strokeStyle = S.selConflict === i ? '#fff' : '#ff5c5c'; g.lineWidth = 2 * d; g.beginPath(); g.arc(s[0], s[1], (S.selConflict === i ? 11 : 8) * d, 0, Math.PI * 2); g.stroke(); });
        // the 3D area being looked at
        if (S.area) { const s = toS(S.area.x, S.area.y), rr = S.area.r * S.view.scale * d; g.strokeStyle = 'rgba(94,224,143,0.8)'; g.setLineDash([5 * d, 4 * d]); g.lineWidth = 1.5 * d; g.beginPath(); g.arc(s[0], s[1], rr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
        $('stats').textContent = S.data.resources.length + ' resources · ' + n + ' placed MLOs · ' + (S.data.conflicts || []).length + ' things to look at';
    }
    // the MLO under the mouse (the smallest box that holds the point, or the nearest dot)
    function hit(sx, sy) {
        if (!S.data) return null; const w = toW(sx, sy); let best = null, bestA = 1e18;
        S.data.resources.forEach(r => r.places.forEach((p, i) => {
            const inside = w[0] >= p.wmin[0] && w[0] <= p.wmax[0] && w[1] >= p.wmin[1] && w[1] <= p.wmax[1];
            const cx = (p.wmin[0] + p.wmax[0]) / 2, cy = (p.wmin[1] + p.wmax[1]) / 2, dpx = Math.hypot((cx - w[0]) * S.view.scale, (cy - w[1]) * S.view.scale);
            const area = inside ? (p.wmax[0] - p.wmin[0]) * (p.wmax[1] - p.wmin[1]) : (dpx < 8 ? 1e12 + dpx : 1e18);
            if (area < bestA) { bestA = area; best = { r: r.name, i, p }; }
        }));
        return best;
    }
    function bindMap() {
        const c = cv(); let drag = null;
        c.addEventListener('mousedown', e => { drag = { x: e.offsetX, y: e.offsetY, cx: S.view.cx, cy: S.view.cy, moved: false }; c.classList.add('dragging'); });
        window.addEventListener('mousemove', e => {
            const r = c.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
            if (drag) { if (Math.abs(ox - drag.x) + Math.abs(oy - drag.y) > 3) drag.moved = true; S.view.cx = drag.cx - (ox - drag.x) / S.view.scale; S.view.cy = drag.cy + (oy - drag.y) / S.view.scale; draw(); return; }
            if (ox < 0 || oy < 0 || ox > r.width || oy > r.height || c.style.display === 'none') { $('tip').style.display = 'none'; return; }
            const h = hit(ox, oy), t = $('tip');
            if (h) { t.style.display = 'block'; t.style.left = (ox + 14) + 'px'; t.style.top = (oy + 10) + 'px'; t.innerHTML = ''; t.append(el('b', null, h.p.name), el('div', null, h.r + ' · ' + h.p.ymap), el('div', { style: { color: 'var(--muted)' } }, h.p.p.map(v => v.toFixed(1)).join(', '))); }
            else t.style.display = 'none';
        });
        window.addEventListener('mouseup', e => {
            if (!drag) return; c.classList.remove('dragging'); const d0 = drag; drag = null; if (d0.moved) return;
            const h = hit(d0.x, d0.y); if (h) { S.sel = h.r; S.selPlace = { r: h.r, i: h.i }; S.selConflict = null; } else { const w = toW(d0.x, d0.y); S.pickedSpot = { x: w[0], y: w[1] }; S.selPlace = null; }
            renderAll();
        });
        c.addEventListener('wheel', e => { e.preventDefault(); const b = toW(e.offsetX, e.offsetY); S.view.scale = Math.max(0.01, Math.min(60, S.view.scale * Math.pow(1.0015, -e.deltaY))); const a = toW(e.offsetX, e.offsetY); S.view.cx += b[0] - a[0]; S.view.cy += b[1] - a[1]; draw(); }, { passive: false });
        window.addEventListener('keydown', e => { if (e.key === 'Home' && document.activeElement && document.activeElement.tagName !== 'INPUT') frameAll(); });
        window.addEventListener('resize', resize);
    }

    // ---------- a building in the game: find it by its model name (as CodeWalker shows it) or by coordinates, then pick it in 3D ----------
    S.pick = { q: '', places: null, busy: false, err: '' };
    const coordsOf = (q) => { const t = (q || '').replace(/vec(tor)?[234]?/gi, ' ').replace(/[xyzh]\s*=/gi, ' '); if (/[a-df-wyz_]/i.test(t.replace(/e[-+]?\d/gi, ''))) return null; const n = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); return n.length >= 2 ? n : null; };
    async function findBuilding() {
        const q = ($('pickq') || {}).value || S.pick.q; S.pick.q = q.trim(); if (!S.pick.q) return;
        const c = coordsOf(S.pick.q);
        if (c) { S.pick.places = null; S.pick.err = ''; W.flyTo(c[0], c[1], 120); if (W.open3d) W.open3d(c[0], c[1], c.length > 2 ? c[2] : null, 60, { x: c[0], y: c[1] }); return; }
        S.pick.busy = true; S.pick.err = ''; S.pick.places = null; renderLeft();
        const poll = setInterval(async () => { try { const st = await api('vanilla/status'); if (st.status) { S.pick.status = st.status; const e = $('pickst'); if (e) e.textContent = st.status; } } catch (e) { } }, 600);
        try { const r = await api('game/find', 'POST', { name: S.pick.q.replace(/\.(ydr|yft)$/i, ''), gta: '' }); if (r.ok === false) throw new Error(r.error); S.pick.places = r.places || []; if (!S.pick.places.length) S.pick.err = 'The game\'s map files do not place a model called ' + S.pick.q + '.'; else { const p = S.pick.places[0]; W.flyTo(p.x, p.y, 300); } }
        catch (e) { S.pick.err = e.message; }
        clearInterval(poll); S.pick.busy = false; renderAll();
    }
    // the rough map of the city: asked for once (the game's map index takes a few minutes the first time)
    async function loadGrid(start) {
        try {
            const r = await api('game/mapgrid', start ? 'POST' : 'GET', start ? { gta: '' } : undefined); S.gridState = r;
            if (r.ready && r.grid) {
                const u = atob(r.grid), c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const x = c.getContext('2d'), im = x.createImageData(r.w, r.h);
                for (let row = 0; row < r.h; row++) for (let col = 0; col < r.w; col++) { const v = u.charCodeAt(row * r.w + col), o = ((r.h - 1 - row) * r.w + col) * 4; if (!v) continue; im.data[o] = 120; im.data[o + 1] = 150; im.data[o + 2] = 200; im.data[o + 3] = Math.min(150, 30 + v * 18); }
                x.putImageData(im, 0, 0); S.grid = { img: c, ox: r.ox, oy: r.oy, w: r.w, h: r.h, cell: r.cell }; renderAll(); return;
            }
            if (r.busy) setTimeout(() => loadGrid(false), 2000);
            renderLeft();
        } catch (e) { S.gridState = { error: e.message }; renderLeft(); }
    }
    function pickSection(L) {
        L.append(el('div', { class: 'h' }, 'A building in the game'), el('div', { class: 'note' }, 'Turn one of the game\'s buildings into an interior: type its model name (CodeWalker shows it when you click the building) or the coordinates of the spot, then click the building in the 3D view.'));
        const inp = el('input', { id: 'pickq', class: 'txt grow', placeholder: 'dt1_02_build1, or 25.7, -1347.3', spellcheck: 'false', value: S.pick.q, onkeydown: (e) => { if (e.key === 'Enter') findBuilding(); } });
        L.append(el('div', { class: 'row' }, inp, el('button', { class: 'btn sm primary', disabled: S.pick.busy ? true : null, onclick: findBuilding }, 'Find')));
        if (S.pick.busy) L.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note', id: 'pickst' }, S.pick.status || 'Looking in the game\'s map files...'));
        if (S.pick.err) L.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, S.pick.err));
        (S.pick.places || []).forEach((p, i) => L.append(el('div', { class: 'res', style: { '--c': '#e0a43a' }, onclick: () => { if (W.open3d) W.open3d(p.x, p.y, p.z, 60, { name: S.pick.q.replace(/\.(ydr|yft)$/i, '').toLowerCase(), x: p.x, y: p.y }); } },
            el('div', { class: 't' }, (i + 1) + '. ' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1)), el('div', { class: 'm' }, p.ymap + ' · click to look in 3D'))));
        const gs = S.gridState || {};
        if (!S.grid) L.append(el('div', { class: 'row' }, el('button', { class: 'btn sm', disabled: gs.busy ? true : null, title: 'Draw where the game has buildings on the map (reads the game\'s map files; the first time takes a few minutes)', onclick: () => loadGrid(true) }, gs.busy ? 'Reading the game\'s map...' : 'Show the game\'s map')),
            gs.busy && gs.status ? el('div', { class: 'note' }, gs.status) : null, gs.error ? el('div', { class: 'note', style: { color: '#f0a4a3' } }, gs.error) : null);
        else L.append(el('div', { class: 'note' }, 'Click a spot on the map, then "Look in 3D here", to look around for a building.'));
    }

    // ---------- panels ----------
    function renderLeft() {
        const L = $('wleft'), st = S.status, keep = document.activeElement && document.activeElement.id === 'spath', val = $('spath') ? $('spath').value : null, keepPick = document.activeElement && document.activeElement.id === 'pickq'; L.innerHTML = '';
        if (S.pickFirst) pickSection(L);
        L.append(el('div', { class: 'h' }, 'Your server'), el('div', { class: 'note' }, 'The server\'s resources folder (or one resource). Every resource under it is read; files that are encrypted (asset escrow) are listed and left out.'));
        L.append(el('div', { class: 'row' }, el('input', { id: 'spath', class: 'txt grow', placeholder: 'C:\\FXServer\\server-data\\resources', spellcheck: 'false', value: val != null ? val : (st.root || st.last || '') }), el('button', { class: 'btn sm', onclick: pick, title: 'Pick the folder' }, 'Pick')));
        if (st.busy) L.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note' }, st.status || 'Reading...'));
        else L.append(el('button', { class: 'btn primary', style: { width: '100%' }, onclick: scan }, S.data ? 'Scan again' : 'Scan the folder'));
        if (st.error) L.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, st.error));
        if (S.data) {
            const rs = S.data.resources.slice().sort((a, b) => (b.places.length + b.mlos.length) - (a.places.length + a.mlos.length) || a.name.localeCompare(b.name));
            const enc = rs.filter(r => r.encrypted > 0).length;
            L.append(el('div', { class: 'h' }, 'Resources (' + rs.length + ')'), el('div', { class: 'note' }, rs.filter(r => r.places.length || r.mlos.length).length + ' with MLOs, ' + enc + ' with encrypted files.'));
            rs.forEach(r => {
                if (!r.places.length && !r.mlos.length && !r.encrypted && !r.files.length) return;
                L.append(el('div', { class: 'res' + (S.sel === r.name ? ' on' : ''), style: { '--c': colorOf(r.name) }, onclick: () => { S.sel = S.sel === r.name ? null : r.name; S.selPlace = null; if (S.sel && r.places.length) { const p = r.places[0]; W.flyTo((p.wmin[0] + p.wmax[0]) / 2, (p.wmin[1] + p.wmax[1]) / 2, Math.max(60, p.wmax[0] - p.wmin[0]) * 3); } renderAll(); } },
                    el('div', { class: 't' }, r.name),
                    el('div', { class: 'm' }, r.escrow ? el('span', { class: 'badge lock' }, 'escrow') : null, r.encrypted ? el('span', { class: 'badge lock' }, r.encrypted + ' encrypted') : null, r.unreadable ? el('span', { class: 'badge bad' }, r.unreadable + ' unreadable') : null,
                        r.mlos.length ? el('span', { class: 'badge good' }, r.mlos.length + ' MLO' + (r.mlos.length > 1 ? 's' : '')) : null, r.places.length ? el('span', { class: 'badge' }, r.places.length + ' placed') : null, el('span', { class: 'badge' }, r.ok + ' files read'))));
            });
        }
        if (!S.pickFirst) pickSection(L);
        if (keep) { const i = $('spath'); i.focus(); }
        if (keepPick) { const i = $('pickq'); if (i) { i.focus(); i.selectionStart = i.selectionEnd = i.value.length; } }
    }
    function renderRight() {
        const R = $('wright'); R.innerHTML = '';
        if (!S.data && S.pickedSpot && W.open3d) R.append(el('div', { class: 'h' }, 'This spot'), el('div', { class: 'note' }, S.pickedSpot.x.toFixed(1) + ', ' + S.pickedSpot.y.toFixed(1)), el('button', { class: 'btn sm primary', onclick: () => W.open3d(S.pickedSpot.x, S.pickedSpot.y, null, 60) }, 'Look in 3D here'));
        if (!S.data) { R.append(el('div', { class: 'h' }, 'What it finds'), el('div', { class: 'note' }, 'Every MLO your resources place, on the map; MLOs whose boxes overlap each other or the game\'s own interiors; archetype names defined by two resources; file names streamed by two resources (only one copy loads); and the files that are encrypted.')); return; }
        // the selected MLO / resource
        if (S.selPlace) {
            const r = S.data.resources.find(x => x.name === S.selPlace.r), p = r && r.places[S.selPlace.i];
            if (p) {
                const m = r.mlos.find(x => x.hash === p.hash);
                R.append(el('div', { class: 'h' }, 'MLO'), el('div', { class: 'res on', style: { '--c': colorOf(r.name), cursor: 'default' } }, el('div', { class: 't' }, p.name), el('div', { class: 'm' }, r.name + ' · ' + p.ymap),
                    el('div', { class: 'm' }, 'at ' + p.p.map(v => v.toFixed(2)).join(', ') + ' heading ' + p.heading), m ? el('div', { class: 'm' }, m.rooms + ' rooms · ' + m.ents + ' entities · collision: ' + (m.bounds.length ? m.bounds.join(', ') : 'none found')) : el('div', { class: 'm' }, 'its type file is not in this resource (or is encrypted)'),
                    el('div', { class: 'row', style: { marginTop: '6px' } }, el('button', { class: 'btn sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(p.p.map(v => v.toFixed(2)).join(', ')).then(() => toast('Copied', 'ok')); } }, 'Copy position'),
                        W.open3d ? el('button', { class: 'btn sm primary', onclick: () => W.open3d((p.wmin[0] + p.wmax[0]) / 2, (p.wmin[1] + p.wmax[1]) / 2, (p.wmin[2] + p.wmax[2]) / 2, Math.max(40, (p.wmax[0] - p.wmin[0]) * 0.8 + 25)) }, 'Look in 3D') : null)));
            }
        }
        if (S.pickedSpot && !S.selPlace && W.open3d) R.append(el('div', { class: 'h' }, 'This spot'), el('div', { class: 'note' }, S.pickedSpot.x.toFixed(1) + ', ' + S.pickedSpot.y.toFixed(1)), el('button', { class: 'btn sm primary', onclick: () => W.open3d(S.pickedSpot.x, S.pickedSpot.y, null, 60) }, 'Look in 3D here'));
        const cfs = S.data.conflicts || [];
        R.append(el('div', { class: 'h' }, 'To look at (' + cfs.length + ')'));
        if (!cfs.length) R.append(el('div', { class: 'note' }, 'Nothing overlaps or clashes.'));
        const order = { overlap: 0, file: 1, archetype: 2 };
        cfs.map((c, i) => ({ c, i })).filter(x => !S.sel || x.c.resources.indexOf(S.sel) >= 0).sort((a, b) => order[a.c.kind] - order[b.c.kind]).slice(0, 300).forEach(({ c, i }) => {
            R.append(el('div', { class: 'cf ' + c.kind, onclick: () => { S.selConflict = i; if (c.at) W.flyTo(c.at[0], c.at[1], 80); draw(); } }, el('b', null, c.kind === 'overlap' ? 'Overlap' : (c.kind === 'file' ? 'Same file' : 'Same archetype')), ' · ', c.text));
        });
        if (S.sel) {
            const r = S.data.resources.find(x => x.name === S.sel);
            if (r) {
                R.append(el('div', { class: 'h' }, 'Files of ' + r.name), el('div', { class: 'note' }, r.dir));
                const fl = el('div', { class: 'flist' }); r.files.slice().sort((a, b) => (a.state === 'ok') - (b.state === 'ok') || a.rel.localeCompare(b.rel)).forEach(f => fl.append(el('div', { class: f.state === 'ok' ? 'ok' : (f.state === 'encrypted' ? 'enc' : 'bad'), title: f.why || '' }, (f.state === 'ok' ? '  ' : (f.state === 'encrypted' ? '🔒 ' : '! ')) + f.rel + (f.state !== 'ok' ? '  (' + (f.why || f.state) + ')' : ''))));
                R.append(fl);
                if (r.encrypted) R.append(el('div', { class: 'note' }, 'Encrypted files (asset escrow) cannot be read or changed by any tool: their MLOs show only where an unencrypted map file places them, with a guessed size.'));
            }
        }
    }
    function renderHud() {
        const H = $('maphud'); H.innerHTML = '';
        const chk = (label, key) => el('label', { class: 'btn sm', style: { display: 'flex', gap: '5px', alignItems: 'center' } }, el('input', { type: 'checkbox', checked: S[key] ? true : null, onchange: (e) => { S[key] = e.target.checked; draw(); } }), label);
        H.append(el('button', { class: 'btn sm', onclick: frameAll }, 'Frame all (Home)'), chk('Map files', 'showMaps'), chk('Game interiors', 'showGame'));
        if (!(S.data && S.data.gameInteriors && S.data.gameInteriors.length)) H.append(el('button', { class: 'btn sm', title: 'Add the game\'s own interiors to the map and to the overlap check', onclick: loadInteriors }, S.interiors && S.interiors.busy ? 'Reading the game\'s interiors...' : 'Add the game\'s interiors'));
        H.append(el('span', { class: 'legend', style: { marginLeft: '6px' } }, el('span', null, el('i', { style: { background: '#ff5c5c' } }), 'overlap'), el('span', null, el('i', { style: { background: 'rgba(170,180,200,.6)' } }), 'game interior')));
    }
    function renderAllNow() { renderLeft(); renderRight(); renderHud(); draw(); }
    W.renderAll = renderAllNow; const renderAll = () => W.renderAll();

    async function start() {
        $('b-back').onclick = () => { try { sessionStorage.setItem('mlo.noauto', '1'); } catch (e) { } location.href = 'index.html'; };
        setInterval(() => { api('ping').catch(() => { }); }, 4000);
        // world.html?pick=1: the page is opened to pick a building (from the start screen); ?q=name or coordinates looks it up straight away
        const qs = new URLSearchParams(location.search); S.pickFirst = qs.has('pick') || qs.has('q'); S.projectName = qs.get('project') || '';
        if (S.pickFirst) { $('toptext').textContent = 'Pick a building of the game to turn into an interior'; $('hint').textContent = 'Find the building by name or coordinates (left), then click it in the 3D view.'; }
        bindMap(); resize(); renderAll(); loadGrid(false);
        if (qs.get('q')) { S.pick.q = qs.get('q'); renderLeft(); findBuilding(); }
        try { S.interiors = await api('interiors/status'); } catch (e) { }
        await pollStatus();
        if (S.status.ready) await loadResult();
        if (W.init3d) W.init3d();
    }
    window.addEventListener('load', () => { start().catch(e => { console.error(e); document.body.append(el('pre', { style: { position: 'fixed', top: '50px', left: '320px', color: '#f88' } }, String(e.stack || e))); }); });
})(window.MLO);
