// The game's own interiors: find them, put one or several on a plan, snap their doorways together, and export them as one MLO.
// A page of its own (interiors.html); a combination is saved as a project of kind "combo". No framework, no build step.
(function () {
    'use strict';
    const TOKEN = (document.querySelector('meta[name="mlo-token"]') || {}).content || '';
    const $ = (id) => document.getElementById(id);
    const COLORS = ['#4f8cff', '#2fae62', '#e0a43a', '#c46bd6', '#4fc1c9', '#e06a5a', '#9fb24a', '#d68a4f'];

    async function api(path, method, body) {
        const r = await fetch('/api/' + path, { method: method || 'GET', headers: { 'X-Mlo-Token': TOKEN, 'Content-Type': 'application/json' }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
        if (!r.ok) throw new Error((j && j.error) || ('request failed ' + r.status));
        return j;
    }
    function el(tag, attrs, ...kids) {
        const e = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            const v = attrs[k]; if (v == null || v === false) continue;
            if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
            else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
            else if (k === 'class') e.className = v; else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v; else e.setAttribute(k, v === true ? '' : v);
        }
        kids.flat().forEach(k => { if (k == null || k === false) return; e.append(k.nodeType ? k : document.createTextNode(String(k))); });
        return e;
    }
    function toast(text, kind) {
        const t = el('div', { class: 'toast ' + (kind || '') }, text); $('toasts').append(t);
        setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, kind === 'err' ? 6000 : 2800);
    }
    const safeName = (n) => (n || '').replace(/[^A-Za-z0-9 _\-]/g, '').trim().slice(0, 60);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const fmt = (v) => String(r3(v));

    // ---------- turns (quaternions x y z w) and placements ----------
    const qYaw = (deg) => { const r = deg * Math.PI / 360; return [0, 0, Math.sin(r), Math.cos(r)]; };
    const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
    const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
    const qRot = (q, v) => {
        const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
        return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
    };
    const qHeading = (q) => Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180 / Math.PI;
    const pieceQ = (p) => p.q ? qNorm(p.q) : qYaw(p.heading || 0);
    const apply = (p, v) => { const r = qRot(pieceQ(p), v); return [r[0] + p.x, r[1] + p.y, r[2] + p.z]; };
    const normDeg = (d) => { d = d % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return r3(d); };

    // ---------- state ----------
    const S = {
        name: '', saved: true, diskName: '', developer: '', sel: null, details: {}, loading: {}, index: { ready: false, busy: false, status: '', error: '', gta: '' },
        query: '', results: null, total: 0, view: { cx: 0, cy: 0, scale: 8 }, zlo: '', zhi: '', result: null, exporting: false, undo: [], redo: [],
        combo: null
    };
    const newCombo = () => ({ version: 1, resource: 'combined_interior', prefix: 'cmb', label: '', placement: { x: 0, y: 0, z: 0, heading: 0 }, placementSet: false, linkPortals: true, collision: true, loadOriginals: false, pieces: [] });
    let nextId = 1;
    const pieceById = (id) => S.combo.pieces.find(p => p.id === id);
    const colorOf = (p) => COLORS[S.combo.pieces.indexOf(p) % COLORS.length];

    function snapshot() { S.undo.push(JSON.stringify(S.combo)); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; }
    function changed(noSnap) { if (!noSnap) snapshot(); S.saved = false; renderTop(); scheduleSave(); draw(); }
    function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.combo)); S.combo = JSON.parse(S.undo.pop()); afterHistory(); }
    function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.combo)); S.combo = JSON.parse(S.redo.pop()); afterHistory(); }
    function afterHistory() { if (!pieceById(S.sel)) S.sel = null; S.saved = false; scheduleSave(); renderAll(); }

    // ---------- saving: a project of its own kind ----------
    let saveTimer = 0;
    function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save().catch(e => toast('Save failed: ' + e.message, 'err')), 1500); }
    async function save() {
        const n = safeName(S.name); if (!n) return;
        await api('project?name=' + encodeURIComponent(n), 'POST', JSON.stringify({ kind: 'combo', name: n, combo: S.combo }));
        S.saved = true; S.diskName = n; renderTop(); saveThumb();
        try { localStorage.setItem('mlo.last', n); } catch (e) { }
    }
    let thumbAt = 0;
    function saveThumb() {
        if (Date.now() - thumbAt < 20000 || !S.combo.pieces.length) return; thumbAt = Date.now();
        try {
            const c = $('plan'), t = document.createElement('canvas'); t.width = 320; t.height = 200; const g = t.getContext('2d');
            g.fillStyle = '#0b111d'; g.fillRect(0, 0, 320, 200); const s = Math.min(320 / c.width, 200 / c.height); g.drawImage(c, (320 - c.width * s) / 2, (200 - c.height * s) / 2, c.width * s, c.height * s);
            api('thumb?name=' + encodeURIComponent(S.diskName), 'POST', t.toDataURL('image/jpeg', 0.72).split(',')[1]).catch(() => { });
        } catch (e) { }
    }
    async function rename(to) {
        to = safeName(to); if (!to || to === S.diskName) { $('projname').value = S.name; return; }
        try {
            if (S.diskName) await api('project-rename?name=' + encodeURIComponent(S.diskName) + '&to=' + encodeURIComponent(to), 'POST');
            S.name = to; S.diskName = to; await save(); history.replaceState(null, '', 'interiors.html?name=' + encodeURIComponent(to)); toast('Renamed to "' + to + '"', 'ok');
        } catch (e) { toast('Could not rename: ' + e.message, 'err'); }
        $('projname').value = S.name;
    }

    // ---------- the game's interior list ----------
    let pollTimer = 0;
    async function pollIndex() {
        clearTimeout(pollTimer);
        try { S.index = await api('interiors/status'); } catch (e) { S.index.error = e.message; }
        if (S.index.busy) pollTimer = setTimeout(pollIndex, 800);
        else if (S.index.ready && S.results == null) { search(S.query); loadDetails(); }
        renderLeft();
    }
    async function buildIndex(force) {
        const gta = ($('gtapath') || {}).value || S.index.gta || '';
        try { const r = await api('interiors/index', 'POST', { gta, force: !!force }); if (r && r.ok === false) { toast(r.error, 'err'); return; } S.results = null; pollIndex(); }
        catch (e) { toast(e.message, 'err'); }
    }
    let searchTimer = 0, searchSeq = 0;
    function search(q) {
        S.query = q; clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const seq = ++searchSeq;
            try { const r = await api('interiors/list?max=300&q=' + encodeURIComponent(q)); if (seq !== searchSeq) return; S.results = r.items || []; S.total = r.total || 0; S.all = r.all || 0; }
            catch (e) { S.results = []; toast(e.message, 'err'); }
            renderResults();
        }, 180);
    }
    async function detail(hash) {
        if (S.details[hash]) return S.details[hash];
        if (!S.loading[hash]) S.loading[hash] = api('interiors/detail?name=' + encodeURIComponent(hash)).then(d => { if (d && d.ok === false) throw new Error(d.error); S.details[hash] = d; return d; }).finally(() => { delete S.loading[hash]; });
        return S.loading[hash];
    }
    function loadDetails() {
        if (!S.index.ready) return;
        S.combo.pieces.forEach(p => { if (!S.details[p.hash]) detail(p.hash).then(() => { renderRight(); draw(); }).catch(e => toast(p.label + ': ' + e.message, 'err')); });
    }

    // ---------- pieces ----------
    async function addPiece(hash) {
        let d; try { d = await detail(hash); } catch (e) { toast(e.message, 'err'); return; }
        snapshot();
        const p = { id: nextId++, hash: d.hash, name: d.name, label: d.name.startsWith('hash_') ? d.ytyp : d.name, x: 0, y: 0, z: 0, heading: 0, q: null, sets: [], place: 0 };
        // the entity sets the game shows at its own copy are on to begin with
        if (d.places && d.places[0]) p.sets = (d.places[0].sets || []).slice();
        // a new piece goes next to the others (to their right), unless it is the first
        if (S.combo.pieces.length) {
            let maxX = -1e9; S.combo.pieces.forEach(o => { const b = pieceBox(o); if (b) maxX = Math.max(maxX, b.mx[0]); });
            p.x = r3(maxX + 4 - d.bmin[0]);
        }
        S.combo.pieces.push(p); S.sel = p.id;
        // the first piece: the joined interior stands where the game has this one, until a place is typed in
        if (S.combo.pieces.length === 1 && !S.combo.placementSet && d.places && d.places[0]) { const pl = d.places[0]; S.combo.placement = { x: r3(pl.p[0]), y: r3(pl.p[1]), z: r3(pl.p[2]), heading: r3(pl.heading) }; }
        if (!S.combo.label) S.combo.label = p.label;
        changed(true); renderRight(); frameAll();
    }
    function removePiece(id) { snapshot(); S.combo.pieces = S.combo.pieces.filter(p => p.id !== id); if (S.sel === id) S.sel = null; changed(true); renderRight(); }
    function duplicatePiece(id) {
        const o = pieceById(id); if (!o) return; snapshot();
        const b = pieceBox(o), p = JSON.parse(JSON.stringify(o)); p.id = nextId++; p.x = r3(o.x + (b ? b.mx[0] - b.mn[0] + 4 : 10));
        S.combo.pieces.push(p); S.sel = p.id; changed(true); renderRight();
    }
    // the pieces placed relative to each other the way the game places its own copies (the casino floor, its penthouse, its garage...)
    function arrangeAsInGame() {
        const placed = S.combo.pieces.filter(p => { const d = S.details[p.hash]; return d && d.places && d.places.length; });
        if (placed.length < 1) { toast('The game does not place any of these pieces itself.', 'warn'); return; }
        snapshot();
        const pl0 = S.details[placed[0].hash].places[placed[0].place || 0] || S.details[placed[0].hash].places[0], q0 = qNorm(pl0.q), inv = qConj(q0);
        placed.forEach(p => {
            const d = S.details[p.hash], pl = d.places[p.place || 0] || d.places[0], q = qNorm(qMul(inv, qNorm(pl.q))), t = qRot(inv, [pl.p[0] - pl0.p[0], pl.p[1] - pl0.p[1], pl.p[2] - pl0.p[2]]);
            p.x = r3(t[0]); p.y = r3(t[1]); p.z = r3(t[2]); p.heading = normDeg(qHeading(q));
            p.q = (Math.abs(q[0]) > 1e-4 || Math.abs(q[1]) > 1e-4) ? q.map(r3) : null;         // (a tilted copy keeps its exact turn)
        });
        if (!S.combo.placementSet) S.combo.placement = { x: r3(pl0.p[0]), y: r3(pl0.p[1]), z: r3(pl0.p[2]), heading: r3(qHeading(q0)) };
        const left = S.combo.pieces.length - placed.length;
        toast('Placed ' + placed.length + ' piece(s) as the game has them' + (left ? '; ' + left + ' the game never places stay where they were' : ''), 'ok');
        changed(true); renderRight(); frameAll();
    }

    // ---------- geometry of a piece in the joined interior's frame ----------
    function pieceRooms(p) {
        const d = S.details[p.hash]; if (!d) return [];
        const out = [];
        (d.roomList || []).forEach((r, i) => {
            if (i === 0) return;              // (limbo: the outside)
            const mn = r.mn, mx = r.mx, cs = [[mn[0], mn[1]], [mx[0], mn[1]], [mx[0], mx[1]], [mn[0], mx[1]]].map(c => apply(p, [c[0], c[1], mn[2]]));
            const z0 = apply(p, [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]])[2], z1 = z0 + (mx[2] - mn[2]);
            out.push({ i, name: r.name, poly: cs, z0, z1 });
        });
        return out;
    }
    function pieceBox(p) {
        const d = S.details[p.hash]; if (!d) return null; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < 8; i++) { const w = apply(p, [(i & 1) ? d.bmax[0] : d.bmin[0], (i & 2) ? d.bmax[1] : d.bmin[1], (i & 4) ? d.bmax[2] : d.bmin[2]]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } }
        return { mn, mx };
    }
    function piecePortals(p) {
        const d = S.details[p.hash]; if (!d) return [];
        return (d.portalList || []).map((po, i) => {
            const c = po.c || []; if (c.length < 12) return null;
            const w = [0, 1, 2, 3].map(k => apply(p, [c[k * 3], c[k * 3 + 1], c[k * 3 + 2]]));
            const ctr = [0, 1, 2].map(k => (w[0][k] + w[1][k] + w[2][k] + w[3][k]) / 4), a = [0, 1, 2].map(k => w[2][k] - w[0][k]), b = [0, 1, 2].map(k => w[3][k] - w[1][k]);
            const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(n[0], n[1], n[2]);
            return { i, w, c: ctr, n: l > 1e-9 ? n.map(v => v / l) : [0, 0, 1], area: l / 2, outside: po.from === 0 || po.to === 0, piece: p.id };
        }).filter(Boolean);
    }
    // doorways of two pieces that the export joins into one portal (same test as the export)
    function meets(a, b) {
        if (!a.outside || !b.outside || a.piece === b.piece || a.area <= 0 || b.area <= 0) return false;
        const dot = Math.abs(a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2]), ratio = a.area / b.area;
        return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]) <= 0.35 && dot >= 0.9 && ratio >= 0.5 && ratio <= 2;
    }
    function allPortals() { const l = []; S.combo.pieces.forEach(p => l.push(...piecePortals(p))); return l; }
    function linkedPairs() {
        const ps = allPortals().filter(p => p.outside), pairs = [], used = new Set();
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { if (used.has(i) || used.has(j)) continue; if (meets(ps[i], ps[j])) { pairs.push([ps[i], ps[j]]); used.add(i); used.add(j); } }
        return pairs;
    }
    const inZ = (z0, z1) => { const lo = S.zlo === '' ? -1e9 : +S.zlo, hi = S.zhi === '' ? 1e9 : +S.zhi; return z1 >= lo && z0 <= hi; };

    // ---------- the plan ----------
    const cv = () => $('plan');
    function toScreen(x, y) { const c = cv(), v = S.view; return [c.width / 2 + (x - v.cx) * v.scale * devicePixelRatio, c.height / 2 - (y - v.cy) * v.scale * devicePixelRatio]; }
    function toWorld(sx, sy) { const c = cv(), v = S.view, d = devicePixelRatio; return [v.cx + (sx * d - c.width / 2) / (v.scale * d), v.cy - (sy * d - c.height / 2) / (v.scale * d)]; }
    function resize() { const c = cv(), r = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width * devicePixelRatio)); c.height = Math.max(1, Math.round(r.height * devicePixelRatio)); draw(); }
    function frameAll() {
        const mn = [1e9, 1e9], mx = [-1e9, -1e9]; let any = false;
        S.combo.pieces.forEach(p => { const b = pieceBox(p); if (!b) return; any = true; mn[0] = Math.min(mn[0], b.mn[0]); mn[1] = Math.min(mn[1], b.mn[1]); mx[0] = Math.max(mx[0], b.mx[0]); mx[1] = Math.max(mx[1], b.mx[1]); });
        const r = cv().getBoundingClientRect();
        if (!any) { S.view = { cx: 0, cy: 0, scale: 8 }; draw(); return; }
        S.view.cx = (mn[0] + mx[0]) / 2; S.view.cy = (mn[1] + mx[1]) / 2; S.view.scale = Math.max(0.5, Math.min(60, 0.85 * Math.min(r.width / Math.max(4, mx[0] - mn[0]), r.height / Math.max(4, mx[1] - mn[1]))));
        draw();
    }
    let drawQueued = false;
    function draw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawNow(); }); }
    function drawNow() {
        const c = cv(), g = c.getContext('2d'), d = devicePixelRatio; g.clearRect(0, 0, c.width, c.height);
        // grid every 1 / 10 m depending on the zoom
        const step = S.view.scale > 14 ? 1 : (S.view.scale > 2.5 ? 10 : 50), w0 = toWorld(0, c.height / d), w1 = toWorld(c.width / d, 0);
        g.lineWidth = 1; g.strokeStyle = 'rgba(130,160,210,0.07)'; g.beginPath();
        for (let x = Math.floor(w0[0] / step) * step; x <= w1[0]; x += step) { const s = toScreen(x, 0)[0]; g.moveTo(s, 0); g.lineTo(s, c.height); }
        for (let y = Math.floor(w0[1] / step) * step; y <= w1[1]; y += step) { const s = toScreen(0, y)[1]; g.moveTo(0, s); g.lineTo(c.width, s); }
        g.stroke();
        const o = toScreen(0, 0); g.strokeStyle = 'rgba(130,160,210,0.25)'; g.beginPath(); g.moveTo(o[0] - 8 * d, o[1]); g.lineTo(o[0] + 8 * d, o[1]); g.moveTo(o[0], o[1] - 8 * d); g.lineTo(o[0], o[1] + 8 * d); g.stroke();
        let rooms = 0, ents = 0;
        S.combo.pieces.forEach(p => {
            const dt = S.details[p.hash], col = colorOf(p), on = p.id === S.sel;
            if (!dt) { const s = toScreen(p.x, p.y); g.fillStyle = col; g.font = (12 * d) + 'px Segoe UI, sans-serif'; g.fillText((S.index.ready ? 'loading ' : 'waiting for the interior list: ') + p.label, s[0], s[1]); return; }
            ents += dt.ents;
            // entities as dots (where the furniture and walls stand)
            const pts = dt.points || [], q = pieceQ(p); g.fillStyle = col; g.globalAlpha = on ? 0.55 : 0.32; const ds = Math.max(1, 1.4 * d);
            for (let i = 0; i + 2 < pts.length; i += 3) { const w = qRot(q, [pts[i], pts[i + 1], pts[i + 2]]); const wz = w[2] + p.z; if (!inZ(wz, wz)) continue; const s = toScreen(w[0] + p.x, w[1] + p.y); g.fillRect(s[0] - ds / 2, s[1] - ds / 2, ds, ds); }
            g.globalAlpha = 1;
            pieceRooms(p).forEach(r => {
                if (!inZ(r.z0, r.z1)) return; rooms++;
                g.beginPath(); r.poly.forEach((v, k) => { const s = toScreen(v[0], v[1]); if (k) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]); }); g.closePath();
                g.fillStyle = col + (on ? '30' : '18'); g.fill(); g.strokeStyle = col + (on ? 'ff' : '99'); g.lineWidth = (on ? 1.8 : 1) * d; g.stroke();
            });
            const b = pieceBox(p); if (b) { const s = toScreen((b.mn[0] + b.mx[0]) / 2, b.mx[1]); g.fillStyle = on ? '#fff' : col; g.font = (on ? '600 ' : '') + (12 * d) + 'px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText(p.label, s[0], s[1] - 6 * d); g.textAlign = 'left'; }
        });
        // portals: amber = a doorway to the outside, green = two pieces' doorways that become one, grey = between rooms
        const pairs = linkedPairs(), linked = new Set(); pairs.forEach(pr => { linked.add(pr[0].piece + ':' + pr[0].i); linked.add(pr[1].piece + ':' + pr[1].i); });
        allPortals().forEach(po => {
            const zs = po.w.map(v => v[2]); if (!inZ(Math.min(...zs), Math.max(...zs))) return;
            // the portal seen from above: the two corners that are farthest apart
            let a = po.w[0], b = po.w[1], best = -1; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const dd = Math.hypot(po.w[i][0] - po.w[j][0], po.w[i][1] - po.w[j][1]); if (dd > best) { best = dd; a = po.w[i]; b = po.w[j]; } }
            const sa = toScreen(a[0], a[1]), sb = toScreen(b[0], b[1]), lk = linked.has(po.piece + ':' + po.i);
            g.strokeStyle = lk ? '#5ee08f' : (po.outside ? '#e0a43a' : 'rgba(200,210,230,0.35)'); g.lineWidth = (lk ? 4 : (po.outside ? 2.5 : 1.2)) * d;
            g.beginPath(); g.moveTo(sa[0], sa[1]); g.lineTo(sb[0], sb[1]); g.stroke();
        });
        $('stats').textContent = S.combo.pieces.length + ' piece(s) · ' + rooms + ' rooms shown · ' + ents.toLocaleString() + ' entities · ' + pairs.length + ' doorway(s) joined';
        const empty = $('planempty');
        empty.textContent = S.combo.pieces.length ? '' : (S.index.ready ? 'Search the game\'s interiors on the left and press Add. Add several to join them into one MLO: drag them so their doorways meet (they snap), or use "Arrange as in the game".' : 'Build the list of the game\'s interiors first (left).');
    }

    // ---------- mouse and keys on the plan ----------
    let drag = null;
    function pickPiece(wx, wy) {
        for (let k = S.combo.pieces.length - 1; k >= 0; k--) {
            const p = S.combo.pieces[k];
            for (const r of pieceRooms(p)) {
                if (!inZ(r.z0, r.z1)) continue; let inside = false; const pl = r.poly;
                for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) { if (((pl[i][1] > wy) !== (pl[j][1] > wy)) && (wx < (pl[j][0] - pl[i][0]) * (wy - pl[i][1]) / (pl[j][1] - pl[i][1]) + pl[i][0])) inside = !inside; }
                if (inside) return p;
            }
        }
        return null;
    }
    // while a piece is dragged: when one of its doorways comes near another piece's (parallel, within 0.8 m), it moves so they meet exactly
    function doorSnap(p) {
        const mine = piecePortals(p).filter(x => x.outside), others = []; S.combo.pieces.forEach(o => { if (o.id !== p.id) others.push(...piecePortals(o).filter(x => x.outside)); });
        let best = null;
        mine.forEach(a => others.forEach(b => {
            const dot = Math.abs(a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2]), ratio = a.area / b.area; if (dot < 0.9 || ratio < 0.5 || ratio > 2) return;
            const dd = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]); if (dd < 0.8 && (!best || dd < best.d)) best = { d: dd, dx: b.c[0] - a.c[0], dy: b.c[1] - a.c[1], dz: b.c[2] - a.c[2] };
        }));
        if (best) { p.x = r3(p.x + best.dx); p.y = r3(p.y + best.dy); p.z = r3(p.z + best.dz); return true; }
        return false;
    }
    function turnPiece(p, deg) {
        const d = S.details[p.hash]; snapshot();
        const lc = d ? [(d.bmin[0] + d.bmax[0]) / 2, (d.bmin[1] + d.bmax[1]) / 2, (d.bmin[2] + d.bmax[2]) / 2] : [0, 0, 0], before = apply(p, lc);
        if (p.q) { p.q = qNorm(qMul(qYaw(deg), qNorm(p.q))).map(r3); p.heading = normDeg(qHeading(p.q)); } else p.heading = normDeg((p.heading || 0) + deg);
        const after = apply(p, lc); p.x = r3(p.x + before[0] - after[0]); p.y = r3(p.y + before[1] - after[1]); p.z = r3(p.z + before[2] - after[2]);       // (it turns about its own middle)
        changed(true); renderRight();
    }
    function bindPlan() {
        const c = cv();
        c.addEventListener('mousedown', e => {
            c.focus(); const w = toWorld(e.offsetX, e.offsetY), p = e.button === 0 ? pickPiece(w[0], w[1]) : null;
            if (p) { S.sel = p.id; snapshot(); drag = { kind: 'piece', p, w, x: p.x, y: p.y, z: p.z }; renderRight(); }
            else { drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, cx: S.view.cx, cy: S.view.cy }; if (e.button === 0 && S.sel != null) { S.sel = null; renderRight(); } }
            c.classList.add('dragging'); draw(); e.preventDefault();
        });
        window.addEventListener('mousemove', e => {
            if (!drag) return; const r = c.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
            if (drag.kind === 'pan') { S.view.cx = drag.cx - (ox - drag.sx) / S.view.scale; S.view.cy = drag.cy + (oy - drag.sy) / S.view.scale; draw(); return; }
            const w = toWorld(ox, oy), p = drag.p, snap = e.altKey ? 0.001 : 0.05;
            p.x = Math.round((drag.x + w[0] - drag.w[0]) / snap) * snap; p.y = Math.round((drag.y + w[1] - drag.w[1]) / snap) * snap; p.z = drag.z; p.x = r3(p.x); p.y = r3(p.y);
            drag.snapped = !e.shiftKey && doorSnap(p);
            $('hint').textContent = drag.snapped ? 'Doorways meet: this piece snapped to the other one (hold Shift to place it freely).' : 'Moving ' + p.label + ' to ' + fmt(p.x) + ', ' + fmt(p.y) + ' (Alt: no 5 cm steps, Shift: no doorway snap)';
            draw(); updatePieceFields(p);
        });
        window.addEventListener('mouseup', () => {
            if (!drag) return; c.classList.remove('dragging');
            if (drag.kind === 'piece') { const p = drag.p; if (p.x === drag.x && p.y === drag.y && p.z === drag.z) S.undo.pop(); else changed(true); renderRight(); }
            drag = null; $('hint').textContent = 'Drag a piece to move it, R turns it 90 degrees (Shift+R: 15), Delete removes it. Wheel zooms, drag empty space to pan, Home frames everything.';
        });
        c.addEventListener('wheel', e => {
            e.preventDefault(); const before = toWorld(e.offsetX, e.offsetY); S.view.scale = Math.max(0.3, Math.min(120, S.view.scale * Math.pow(1.0015, -e.deltaY)));
            const after = toWorld(e.offsetX, e.offsetY); S.view.cx += before[0] - after[0]; S.view.cy += before[1] - after[1]; draw();
        }, { passive: false });
        c.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('keydown', e => {
            const tag = (document.activeElement && document.activeElement.tagName) || ''; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save().then(() => toast('Saved "' + S.name + '"', 'ok')).catch(err => toast('Save failed: ' + err.message, 'err')); return; }
            if (typing) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
            const p = pieceById(S.sel);
            if (e.key === 'Home') { frameAll(); return; }
            if (!p) return;
            if (e.key.toLowerCase() === 'r') { turnPiece(p, e.shiftKey ? 15 : 90); e.preventDefault(); }
            else if (e.key === 'Delete' || e.key === 'Backspace') { removePiece(p.id); e.preventDefault(); }
            else if (e.key.startsWith('Arrow')) {
                const st = e.shiftKey ? 1 : 0.05; snapshot();
                if (e.key === 'ArrowLeft') p.x = r3(p.x - st); if (e.key === 'ArrowRight') p.x = r3(p.x + st); if (e.key === 'ArrowUp') p.y = r3(p.y + st); if (e.key === 'ArrowDown') p.y = r3(p.y - st);
                changed(true); updatePieceFields(p); e.preventDefault();
            }
            else if (e.key === 'PageUp' || e.key === 'PageDown') { snapshot(); p.z = r3(p.z + (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? 0.05 : 1)); changed(true); updatePieceFields(p); e.preventDefault(); }
        });
        window.addEventListener('resize', resize);
    }

    // ---------- panels ----------
    function renderTop() { $('savestate').textContent = S.saved ? 'saved' : 'not saved yet'; if (document.activeElement !== $('projname')) $('projname').value = S.name; }

    const CHIPS = [['casino', 'casino'], ['casino pack', 'mpvinewood'], ['casino heist', 'mpheist3'], ['penthouse', 'penthouse'], ['apartment', 'apartment'], ['office', 'office'], ['garage', 'garage'], ['nightclub', 'nightclub'], ['arcade', 'arcade'], ['bunker', 'bunker'], ['hangar', 'hangar'], ['facility', 'facility']];
    function renderLeft() {
        const L = $('ileft'); const keepFocus = document.activeElement && document.activeElement.id === 'isearch'; L.innerHTML = '';
        const I = S.index;
        L.append(el('div', { class: 'h' }, 'The game\'s interiors'));
        if (!I.ready || I.busy) {
            L.append(el('div', { class: 'note' }, I.cached && I.busy ? 'Opening the game\'s archives and the saved list of interiors...' : 'MLO Creator reads every type file (.ytyp) and map file (.ymap) of your GTA V install to find the game\'s own interiors and where it places them. This takes a few minutes the first time and is kept in the cache afterwards.'));
            L.append(el('div', { class: 'row' }, el('input', { id: 'gtapath', class: 'txt grow', placeholder: 'GTA V folder (with GTA5.exe)', value: I.gta || '', spellcheck: 'false' })));
            if (I.busy) L.append(el('div', { class: 'bar' }, el('div')), el('div', { class: 'note' }, I.status || 'Working...'));
            else L.append(el('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => buildIndex(false) }, 'Build the list'));
            if (I.error) L.append(el('div', { class: 'note bad' }, I.error));
            return;
        }
        const inp = el('input', { id: 'isearch', class: 'txt', style: { width: '100%' }, placeholder: 'Search: casino, apartment, a room or file name...', value: S.query, spellcheck: 'false', oninput: (e) => search(e.target.value) });
        L.append(inp, el('div', { class: 'chips' }, CHIPS.map(c => el('button', { class: 'cat' + (S.query === c[1] ? ' on' : ''), onclick: () => { search(c[1]); renderLeft(); } }, c[0]))));
        L.append(el('div', { id: 'results' }));
        L.append(el('div', { class: 'note', style: { marginTop: '14px' } }, 'Most interiors are known to the game only by a number (hash_...). Typing an interior\'s real name finds it and names it from then on.'),
            el('button', { class: 'btn sm', onclick: () => buildIndex(true), title: 'Read the game files again (after a game update)' }, 'Rebuild the list'));
        renderResults();
        if (keepFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    function renderResults() {
        const R = $('results'); if (!R) return; R.innerHTML = '';
        if (S.results == null) { R.append(el('div', { class: 'note' }, 'Searching...')); return; }
        R.append(el('div', { class: 'note' }, S.total ? (S.total > S.results.length ? 'Showing ' + S.results.length + ' of ' + S.total : S.total + (S.total === 1 ? ' interior' : ' interiors')) + (S.query ? '' : ' (of ' + S.all + ' in the game)') : 'Nothing found.'));
        let pack = null;
        S.results.forEach(it => {
            if (it.pack !== pack) { pack = it.pack; R.append(el('div', { class: 'pack' }, pack)); }
            const sz = it.size || [0, 0, 0], inCombo = S.combo.pieces.some(p => p.hash === it.hash);
            R.append(el('div', { class: 'res' },
                el('div', { class: 'rowb' }, el('div', { class: 't' }, it.name.startsWith('hash_') ? it.ytyp : it.name), el('button', { class: 'btn sm' + (inCombo ? '' : ' primary'), onclick: () => addPiece(it.hash) }, inCombo ? 'Add again' : 'Add')),
                el('div', { class: 'm' }, (it.name.startsWith('hash_') ? it.name + ' · ' : it.ytyp + '.ytyp · ') + it.rooms + ' rooms · ' + it.ents.toLocaleString() + ' entities' + (it.sets ? ' · ' + it.sets + ' entity sets' : '') + ' · ' + sz[0] + ' x ' + sz[1] + ' x ' + sz[2] + ' m'),
                el('div', { class: 'm' }, (it.ymaps && it.ymaps.length ? 'placed by ' + it.ymaps.slice(0, 3).join(', ') + (it.ymaps.length > 3 ? ' +' + (it.ymaps.length - 3) : '') : 'not placed by the game') + (it.collision ? '' : ' · no collision listed')),
                it.roomNames && it.roomNames.length ? el('div', { class: 'm' }, 'rooms: ' + it.roomNames.join(', ')) : null));
        });
    }

    function num(label, value, onchange, step) {
        return el('div', null, el('label', null, label), el('input', { class: 'num', type: 'number', step: step || '0.05', value: String(value), onchange: (e) => onchange(parseFloat(e.target.value) || 0) }));
    }
    function updatePieceFields(p) {
        const box = document.querySelector('.piece[data-id="' + p.id + '"]'); if (!box) return;
        const ins = box.querySelectorAll('input.num'); if (ins.length >= 4) { ins[0].value = fmt(p.x); ins[1].value = fmt(p.y); ins[2].value = fmt(p.z); ins[3].value = fmt(p.heading || 0); }
    }
    function pieceCard(p) {
        const d = S.details[p.hash], on = p.id === S.sel;
        const set = (k) => (v) => { snapshot(); p[k] = r3(v); if (k === 'heading') p.q = null; changed(true); };
        const card = el('div', { class: 'piece' + (on ? ' on' : ''), 'data-id': p.id, style: { '--c': colorOf(p) }, onclick: (e) => { if (S.sel !== p.id && !e.target.closest('input,button,select')) { S.sel = p.id; renderRight(); draw(); } } },
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' } }, el('div', { class: 't' }, p.label), el('div', { class: 'acts' },
                el('button', { class: 'btn sm', title: 'Turn 90 degrees (R)', onclick: () => turnPiece(p, 90) }, '↻ 90'),
                el('button', { class: 'btn sm', title: 'Another copy of this piece', onclick: () => duplicatePiece(p.id) }, 'Copy'),
                el('button', { class: 'btn sm danger', title: 'Remove (Delete)', onclick: () => removePiece(p.id) }, '✕'))),
            el('div', { class: 'note', style: { margin: '2px 0' } }, d ? (d.name.startsWith('hash_') ? d.name + ' · ' : '') + d.ytyp + '.ytyp · ' + d.rooms + ' rooms · ' + d.ents.toLocaleString() + ' entities' + (d.collision ? '' : ' · no collision in the game\'s list') : 'loading...'),
            el('div', { class: 'grid4' }, num('x', fmt(p.x), set('x')), num('y', fmt(p.y), set('y')), num('z', fmt(p.z), set('z')), num('heading', fmt(p.heading || 0), set('heading'), '1')));
        if (on && d) {
            if (d.places && d.places.length > 1) card.append(el('div', { class: 'row' }, el('label', null, 'Game copy'), el('select', { class: 'txt grow', onchange: (e) => { snapshot(); p.place = +e.target.value; changed(true); } }, d.places.map((pl, i) => el('option', { value: i, selected: i === (p.place || 0) ? true : null }, pl.ymap + ' (' + pl.p.map(v => Math.round(v)).join(', ') + ')')))));
            if (d.setList && d.setList.length) {
                const sets = el('div', { class: 'sets' });
                d.setList.forEach(s => sets.append(el('label', null, el('input', { type: 'checkbox', checked: p.sets.indexOf(s.name) >= 0, onchange: (e) => { snapshot(); if (e.target.checked) { if (p.sets.indexOf(s.name) < 0) p.sets.push(s.name); } else p.sets = p.sets.filter(n => n !== s.name); changed(true); } }), s.name + ' (' + s.n + ')')));
                card.append(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('span', { class: 'note', style: { margin: 0 } }, 'Entity sets on (' + p.sets.length + ' of ' + d.setList.length + ')'),
                    el('span', null, el('button', { class: 'btn sm', onclick: () => { snapshot(); p.sets = d.setList.map(s => s.name); changed(true); renderRight(); } }, 'All'), ' ', el('button', { class: 'btn sm', onclick: () => { snapshot(); p.sets = []; changed(true); renderRight(); } }, 'None'),
                        d.places && d.places[p.place || 0] ? el('button', { class: 'btn sm', style: { marginLeft: '4px' }, title: 'The sets the game shows at its own copy', onclick: () => { snapshot(); p.sets = (d.places[p.place || 0].sets || []).slice(); changed(true); renderRight(); } }, 'As in game') : null)), sets);
            }
            card.append(el('div', { class: 'row' }, el('label', null, 'Label'), el('input', { class: 'txt grow', value: p.label, onchange: (e) => { snapshot(); p.label = e.target.value.trim() || p.name; changed(true); renderRight(); } })));
        }
        return card;
    }
    // ---- the steps, one after the other: what is done, what is next, and what the page can do itself ----
    function steps() {
        const C = S.combo, L = [], add = (o) => L.push(Object.assign({ need: 'must' }, o)), pairs = C.pieces.length > 1 ? linkedPairs().length : 0;
        add({ id: 'index', title: 'The list of the game\'s interiors', done: !!S.index.ready, how: 'Type your GTA V folder on the left and read the list (once, a few minutes).', auto: S.index.ready || S.index.busy ? null : () => buildIndex(false) });
        add({ id: 'pieces', title: 'The interiors you want', done: C.pieces.length > 0, how: 'Search on the left (casino, apartment, office...) and press Add on each piece.' });
        if (C.pieces.length > 1) add({ id: 'join', title: 'The pieces joined', need: 'should', done: pairs > 0 || !!C.arranged, how: 'Drag a piece so its doorway (amber) meets another\'s, or put them where the game has them.', auto: () => { arrangeAsInGame(); S.combo.arranged = true; } });
        add({ id: 'place', title: 'Where it stands in the world', done: !!C.placementSet, how: 'Paste the coordinates (vec4) of the spot under "Where it stands in the world".' });
        add({ id: 'dev', title: 'Your developer name', need: 'should', done: !!S.developer, how: 'Type it under Export: it starts every file name.' });
        add({ id: 'export', title: 'Export', need: 'final', done: !!S.result && S.result.ok, how: 'Press "Export the resource".' });
        return L;
    }
    async function autopilot() {
        for (let i = 0; i < 6; i++) { const s = steps().find(x => !x.done && x.need !== 'final'); if (!s || !s.auto) break; await s.auto(); renderAll(); await new Promise(r => setTimeout(r, 200)); if (steps().find(x => x.id === s.id && !x.done && x.need === 'must')) break; }
        renderAll();
    }
    function guideCard(R) {
        const L = steps(), need = L.filter(s => s.need !== 'final'), done = need.filter(s => s.done).length, nx = L.find(s => !s.done && s.need !== 'final');
        const card = el('div', { class: 'route' }, el('div', { class: 'rtop' }, el('span', { class: 'rt' }, 'Steps'), el('span', { class: 'rn' }, done + ' of ' + need.length + ' done')), el('div', { class: 'rbar' }, el('i', { style: { width: Math.round(done / Math.max(1, need.length) * 100) + '%' } })));
        if (nx) {
            card.append(el('div', { style: { fontWeight: 600 } }, 'Next: ' + nx.title), el('div', { class: 'note' }, nx.how));
            if (nx.auto) card.append(el('div', { class: 'row' }, el('button', { class: 'btn sm primary', onclick: async () => { await nx.auto(); renderAll(); } }, 'Do it for me'), el('button', { class: 'btn sm', onclick: autopilot }, 'Do every step it can')));
        } else card.append(el('div', { class: 'note' }, S.result && S.result.ok ? 'Exported. Change anything and export again.' : 'Everything is ready: press "Export the resource" below.'));
        card.append(el('div', { class: 'note', style: { marginTop: '4px' } }, L.map(s => (s.done ? '✓ ' : (s.need === 'must' ? '✗ ' : (s.need === 'final' ? '→ ' : '! '))) + s.title).join('  ·  ')));
        R.append(card);
    }
    function renderRight() {
        const R = $('iright'), C = S.combo, scroll = R.scrollTop; R.innerHTML = '';
        guideCard(R);
        R.append(el('div', { class: 'h' }, 'Pieces'));
        if (!C.pieces.length) R.append(el('div', { class: 'note' }, 'No interiors yet. Add one from the list on the left.'));
        C.pieces.forEach(p => R.append(pieceCard(p)));
        if (C.pieces.length > 1) R.append(el('button', { class: 'btn', style: { width: '100%', marginTop: '4px' }, title: 'Put every piece where the game has it, relative to the first one (the casino floor, its penthouse, its garage...)', onclick: arrangeAsInGame }, 'Arrange as in the game'));
        else if (C.pieces.length === 1) R.append(el('div', { class: 'note' }, 'Add more pieces to join them into one MLO. Drag a piece so a doorway (amber) meets another piece\'s doorway: they snap and turn green, and the export joins them into one portal.'));
        const pl = C.placement, setPl = (k) => (v) => { snapshot(); pl[k] = r3(v); C.placementSet = true; changed(true); };
        R.append(el('div', { class: 'h' }, 'Where it stands in the world'),
            el('div', { class: 'grid4' }, num('x', fmt(pl.x), setPl('x'), '0.1'), num('y', fmt(pl.y), setPl('y'), '0.1'), num('z', fmt(pl.z), setPl('z'), '0.1'), num('heading', fmt(pl.heading), setPl('heading'), '1')),
            el('div', { class: 'row' }, el('input', {
                class: 'txt grow', placeholder: 'Paste vec4(x, y, z, heading)', spellcheck: 'false', onchange: (e) => {
                    const m = (e.target.value.replace(/^[^(]*\(/, '').match(/-?\d+(\.\d+)?/g) || []).map(Number);          // (the 4 of "vec4(" is not a number of the place) if (m.length < 3) { toast('Paste x, y, z and a heading', 'warn'); return; }
                    snapshot(); C.placement = { x: r3(m[0]), y: r3(m[1]), z: r3(m[2]), heading: r3(m[3] || 0) }; C.placementSet = true; changed(true); renderRight();
                }
            })));
        const near = nearOriginal(); if (near) R.append(el('div', { class: 'note warn' }, near));
        R.append(el('div', { class: 'h' }, 'Export'),
            el('div', { class: 'row' }, el('label', null, 'Developer'), el('input', { class: 'txt grow', value: S.developer, maxlength: 40, placeholder: 'your name or team', title: 'Used in the name of every file you export, in every project', onchange: async (e) => { S.developer = e.target.value.trim().slice(0, 40); try { localStorage.setItem('mlo.developer', S.developer); } catch (err) { } try { await api('settings', 'POST', { developer: S.developer }); } catch (err) { } renderRight(); } })),
            el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: C.autoNames !== false, onchange: (e) => { snapshot(); const N = names(); C.autoNames = e.target.checked; if (!e.target.checked) { C.resource = N.resource; C.prefix = N.prefix.slice(0, 30); } changed(true); renderRight(); } }), el('span', null, 'Name the files after the developer and the combination')),
            C.autoNames !== false ? el('div', { class: 'note' }, 'Files ', el('b', null, names().prefix + '_...'), ', folder ', el('b', null, names().resource), '. Rename the combination (top left) to change them.') : el('div', null,
                el('div', { class: 'row' }, el('label', null, 'Resource'), el('input', { class: 'txt grow', value: C.resource, onchange: (e) => { snapshot(); C.resource = e.target.value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'combined_interior'; changed(true); renderRight(); } })),
                el('div', { class: 'row' }, el('label', null, 'Name prefix'), el('input', { class: 'txt grow', value: C.prefix, maxlength: 30, title: 'The start of every file and archetype name; must be unique on your server', onchange: (e) => { snapshot(); C.prefix = e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30).toLowerCase() || 'cmb'; changed(true); renderRight(); } }))),
            chk('linkPortals', 'Join doorways that meet into one portal (so you see and walk straight from piece to piece)'),
            chk('collision', 'Bring the game\'s collision of every piece (floors and walls to stand on)'),
            chk('loadOriginals', 'Also load the game\'s own map files of the pieces (only when the copy is far from them). Makes sure the game has the models loaded; the originals then stand at their own places too.'),
            el('button', { class: 'btn primary', style: { width: '100%', marginTop: '6px' }, disabled: S.exporting || !C.pieces.length || !S.index.ready ? true : null, onclick: doExport }, S.exporting ? 'Exporting...' : 'Export the resource'));
        if (S.result) R.append(resultBox(S.result));
        R.append(el('div', { class: 'h' }, 'On the plan'), el('div', { class: 'note legend' }, el('span', null, el('i', { style: { background: '#e0a43a' } }), 'doorway to outside'), el('span', null, el('i', { style: { background: '#5ee08f' } }), 'doorways that join'), el('span', null, el('i', { style: { background: 'rgba(200,210,230,.5)' } }), 'between rooms')),
            el('div', { class: 'row' }, el('label', null, 'Heights'), el('input', { class: 'num', type: 'number', placeholder: 'from', value: S.zlo, oninput: (e) => { S.zlo = e.target.value; draw(); } }), el('input', { class: 'num', type: 'number', placeholder: 'to', value: S.zhi, oninput: (e) => { S.zhi = e.target.value; draw(); } })),
            el('div', { class: 'note' }, 'Show only the rooms between two heights (m, in the joined interior) to see one floor of a building with several.'));
        R.scrollTop = scroll;
    }
    // developer_combination (lowercase letters and digits), as in the editor's exports
    function names() {
        const C = S.combo; if (C.autoNames === false) return { prefix: C.prefix || 'cmb', resource: C.resource || 'combined_interior' };
        const slug = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20), base = [slug(S.developer), slug(S.name)].filter(Boolean).join('_') || 'cmb';
        return { prefix: base, resource: base };
    }
    function chk(key, text) { return el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!S.combo[key], onchange: (e) => { snapshot(); S.combo[key] = e.target.checked; changed(true); } }), el('span', null, text)); }
    // the copy standing on top of the game's own copy
    function nearOriginal() {
        const C = S.combo, wq = qYaw(C.placement.heading), msgs = [];
        C.pieces.forEach(p => {
            const d = S.details[p.hash]; if (!d || !d.places || !d.places.length) return; const pl = d.places[p.place || 0] || d.places[0];
            const lc = [(d.bmin[0] + d.bmax[0]) / 2, (d.bmin[1] + d.bmax[1]) / 2, (d.bmin[2] + d.bmax[2]) / 2], o = qRot(qNorm(pl.q), lc), orig = [o[0] + pl.p[0], o[1] + pl.p[1], o[2] + pl.p[2]];
            const h = qRot(wq, apply(p, lc)), here = [h[0] + C.placement.x, h[1] + C.placement.y, h[2] + C.placement.z];
            if (Math.hypot(orig[0] - here[0], orig[1] - here[1], orig[2] - here[2]) < 60) msgs.push(p.label);
        });
        return msgs.length ? msgs.join(', ') + (msgs.length > 1 ? ' stand' : ' stands') + ' where the game has its own copy. That is fine for testing if the game\'s copy is not loaded on your server; otherwise type another place.' : '';
    }
    function resultBox(r) {
        const box = el('div', { style: { marginTop: '8px' } });
        if (!r.ok) { box.append(el('div', { class: 'note bad' }, 'Export failed: ' + r.error), r.log && r.log.length ? el('div', { class: 'log' }, r.log.join('\n')) : null); return box; }
        const spot = r.spot ? r.spot.join(', ') : '';
        box.append(el('div', { class: 'note good' }, 'Written to ' + r.dir + ' (' + Math.round(r.bytes / 1024) + ' KB).'),
            spot ? el('div', { class: 'row' }, el('span', { class: 'note', style: { margin: 0 } }, 'Test spot ' + spot), el('button', { class: 'btn sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(spot).then(() => toast('Copied', 'ok')).catch(() => { }); } }, 'Copy')) : null,
            el('button', { class: 'btn sm', onclick: () => api('reveal?name=' + encodeURIComponent(r.dir), 'POST').catch(() => { }) }, 'Open the folder'));
        if (r.warnings && r.warnings.length) box.append(el('div', { class: 'note warn' }, r.warnings.length + ' warning(s):'), el('div', { class: 'log' }, r.warnings.map(w => '• ' + w).join('\n')));
        box.append(el('div', { class: 'note' }, 'What was written:'), el('div', { class: 'log' }, (r.log || []).concat([''], r.files || []).join('\n')));
        return box;
    }
    async function doExport() {
        if (S.exporting) return; const C = S.combo; S.exporting = true; S.result = null; renderRight();
        try {
            await save().catch(() => { });
            const N = names(); const spec = { resource: N.resource, prefix: N.prefix, label: C.label || S.name, placement: C.placement, linkPortals: C.linkPortals, collision: C.collision, loadOriginals: C.loadOriginals, pieces: C.pieces.map(p => ({ hash: p.hash, label: p.label, x: p.x, y: p.y, z: p.z, heading: p.heading || 0, q: p.q || undefined, sets: p.sets, place: p.place || 0 })) };
            S.result = await api('interiors/export', 'POST', spec);
            toast(S.result.ok ? 'Exported "' + S.result.resource + '"' : 'Export failed: ' + S.result.error, S.result.ok ? 'ok' : 'err');
        } catch (e) { S.result = { ok: false, error: e.message }; toast(e.message, 'err'); }
        S.exporting = false; renderRight();
    }
    function renderAll() { renderTop(); renderLeft(); renderRight(); draw(); }

    // ---------- start ----------
    async function start() {
        const qs = new URLSearchParams(location.search); let name = qs.get('name');
        S.combo = newCombo();
        try { const st = await api('settings'); S.developer = (st && st.developer) || ''; } catch (e) { }
        try { if (!S.developer) S.developer = localStorage.getItem('mlo.developer') || ''; } catch (e) { }
        if (name) {
            try { const p = await api('project?name=' + encodeURIComponent(name)); if (p && p.kind === 'combo' && p.combo) { S.combo = Object.assign(newCombo(), p.combo); S.name = safeName(name); S.diskName = S.name; } else throw new Error('"' + name + '" is not a combination of game interiors.'); }
            catch (e) { toast(e.message, 'err'); name = null; }
        }
        if (!name) {
            // a new combination: a name that no project has yet
            let base = safeName(qs.get('new') || '') || 'Game interiors', n = base, list = []; try { list = await api('projects'); } catch (e) { }
            const taken = new Set(list.map(p => p.name)); for (let k = 2; taken.has(n); k++) n = base + ' ' + k;
            S.name = n; S.saved = false; await save().catch(() => { }); history.replaceState(null, '', 'interiors.html?name=' + encodeURIComponent(n));
        }
        S.combo.pieces.forEach(p => { if (!p.id || p.id >= nextId) nextId = Math.max(nextId, (p.id || 0) + 1); }); S.combo.pieces.forEach(p => { if (!p.id) p.id = nextId++; });
        try { localStorage.setItem('mlo.last', S.name); } catch (e) { }
        $('projname').addEventListener('change', (e) => rename(e.target.value)); $('projname').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
        $('b-save').onclick = () => save().then(() => toast('Saved "' + S.name + '"', 'ok')).catch(e => toast('Save failed: ' + e.message, 'err'));
        $('b-back').onclick = async () => { try { if (!S.saved) await save(); } catch (e) { } try { sessionStorage.setItem('mlo.noauto', '1'); } catch (e) { } location.href = 'index.html'; };
        $('b-export').onclick = () => { if (!S.combo.pieces.length) { toast('Add an interior first', 'warn'); return; } doExport(); };
        document.addEventListener('visibilitychange', () => { if (document.hidden && !S.saved) save().catch(() => { }); });
        setInterval(() => { api('ping').catch(() => { }); }, 4000);           // (the program closes when no page pings it)
        bindPlan(); resize(); renderAll();
        await pollIndex();
        // a list built before (in the cache) is opened by itself: only the first build waits for a click
        if (!S.index.ready && !S.index.busy && S.index.cached && S.index.gta && !S.index.error) buildIndex(false);
        frameAll();
    }
    window.addEventListener('load', () => { start().catch(e => { console.error(e); document.body.append(el('pre', { style: { padding: '20px', color: '#f88', position: 'fixed', top: '50px', left: '310px' } }, String(e.stack || e))); }); });
})();
