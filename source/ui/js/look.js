// How the interior looks in the game: the options of project.look, shown on the Paint tab of every kind of project.
// Materials (normal and specular maps), wall colour variants (each one an entity set), skirting / crown / window detail, lights.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model, TEX } = M, S = Model.state, el = M.el;
    const look = () => { const P = S.project; P.look = Model.mergeLook(P.look); return P.look; };
    const chk = (label, get, set, title) => el('label', { class: 'chk', title: title || null }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
    const edit = (fn) => { Model.edit(P => { P.look = Model.mergeLook(P.look); fn(P.look); }); M.App.refreshPanels(); };
    const Look = M.Look = { sections: [] };

    // ---- materials ----
    Look.sections.push(function (root) {
        const L = look();
        root.append(el('div', { class: 'h' }, 'Materials in the game'));
        root.append(chk('Normal and specular maps', () => L.normalMaps, v => edit(l => { l.normalMaps = v; }), 'Every texture gets a normal map (bumps of mortar, grout, planks) and a specular map (what shines). Uses the game\'s normal_spec shader.'));
        if (L.normalMaps) root.append(chk('Flip the green channel', () => L.flipGreen, v => edit(l => { l.flipGreen = v; }), 'If the mortar and grout look raised instead of sunk in the game, tick this and export again.'));
        root.append(el('div', { class: 'note' }, L.normalMaps ? 'Each texture is exported three times: colour, normal map and specular map (about three times the texture size). The view here shows the colour only.' : 'Flat colour textures only (smaller files).'));
    });

    // ---- wall colour schemes: each is an entity set ----
    // the textures on the inside surfaces now (what a scheme can swap), most used first
    function insideTextures() {
        const b = M.App && M.App.built; if (!b) return []; const n = {};
        b.batches.forEach(x => { if (x.group === 'int' && !x.glass && x.tex) n[x.tex] = (n[x.tex] || 0) + x.idx.length; });
        return Object.keys(n).sort((a, c) => n[c] - n[a]);
    }
    const sw = (id, px) => { const c = TEX.swatch(id, px || 22); c.style.borderRadius = '3px'; c.style.flex = 'none'; c.title = TEX.def(id).name; return c; };
    Look.sections.push(function (root) {
        const L = look(), inside = insideTextures();
        root.append(el('div', { class: 'h' }, 'Wall colours (entity sets)'));
        root.append(el('div', { class: 'note' }, 'Colour schemes for the inside. In the game each one is an entity set of the interior: the default colours are on when it loads, a script switches to another.'));
        if (L.variants.length) root.append(el('div', { class: 'row' }, el('label', null, 'Default set'), el('input', { type: 'text', class: 'grow', value: L.defaultName || 'default', maxlength: 14, title: 'The name of the entity set with the colours as painted', onchange: (e) => edit(l => { l.defaultName = e.target.value.trim() || 'default'; }) })));
        L.variants.forEach((v, i) => {
            const card = el('div', { class: 'route', style: { marginTop: '6px' } });
            card.append(el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: v.name, maxlength: 14, onchange: (e) => edit(l => { l.variants[i].name = e.target.value.trim() || ('scheme ' + (i + 1)); }) }),
                el('button', { class: 'btn sm' + (S.lookPreview === v.id ? ' on' : ''), title: 'Show this scheme in the view', onclick: () => { S.lookPreview = S.lookPreview === v.id ? null : v.id; M.App.remesh(); M.App.refreshPanels(); } }, S.lookPreview === v.id ? 'Showing' : 'Show'),
                el('button', { class: 'btn sm danger', title: 'Delete this scheme', onclick: () => { if (S.lookPreview === v.id) S.lookPreview = null; edit(l => { l.variants.splice(i, 1); }); M.App.remesh(); } }, '✕')));
            if (!inside.length) card.append(el('div', { class: 'note' }, 'Build some rooms first: the textures of the inside are listed here.'));
            inside.forEach(t => {
                const to = v.swap[t];
                card.append(el('div', { style: { margin: '6px 0 2px' } },
                    el('div', { class: 'note', style: { margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: TEX.def(t).name + (to ? ' → ' + TEX.def(to).name : '') }, TEX.def(t).name + (to ? ' → ' + TEX.def(to).name : ' (kept)')),
                    el('div', { class: 'row', style: { gap: '5px', margin: 0 } }, sw(t), el('span', { class: 'note', style: { margin: 0 } }, '→'), to ? sw(to) : el('span', { class: 'note', style: { margin: 0, width: '22px', textAlign: 'center' } }, '='), el('span', { class: 'grow' }),
                        el('button', { class: 'btn sm', title: 'Use the texture picked in the bench below', onclick: () => { const pick = S.benchSel; if (!pick || pick === t) { M.UI.toast('Pick another texture in the bench below first.', 'warn'); return; } edit(l => { l.variants[i].swap[t] = pick; }); if (S.lookPreview === v.id) M.App.remesh(); } }, 'Use picked'),
                        to ? el('button', { class: 'btn sm', title: 'Keep the painted texture in this scheme', onclick: () => { edit(l => { delete l.variants[i].swap[t]; }); if (S.lookPreview === v.id) M.App.remesh(); } }, 'Keep') : null)));
            });
            root.append(card);
        });
        root.append(el('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => edit(l => { l.variants.push({ id: 'v' + Date.now().toString(36), name: 'scheme ' + (l.variants.length + 1), swap: {} }); }) }, '+ Add a colour scheme'));
        const cs = Model.colourSets(L), N = Model.exportNames(S.project);
        if (cs.length) root.append(el('div', { class: 'note' }, 'Entity sets: ', el('b', null, cs.map(c => N.prefix + '_' + c.name).join(', ')), '. Only the surfaces a scheme swaps go into the sets; everything else stays in the interior.'));
        else if (L.variants.length) root.append(el('div', { class: 'note' }, 'A scheme that swaps nothing is not exported. Pick a texture in the bench, then "Use picked" on a row.'));
    });
    // ---- trim: skirting, crown, frames and sills ----
    const num = (label, value, step, min, max, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: String(step), min: String(min), max: String(max), value: String(value), onchange: (e) => { const v = Math.min(max, Math.max(min, parseFloat(e.target.value) || 0)); set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    const texRow = (label, id, fallback, set) => el('div', { class: 'row' }, el('label', null, label), sw(id || fallback), el('span', { class: 'grow note', style: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, id ? TEX.def(id).name : 'trim colour'),
        el('button', { class: 'btn sm', title: 'Use the texture picked in the bench below', onclick: () => set(S.benchSel || '') }, 'Use picked'), id ? el('button', { class: 'btn sm', title: 'Back to the trim colour of the project theme', onclick: () => set('') }, '↺') : null);
    Look.sections.push(function (root) {
        const L = look(), P = S.project;
        if (P.kind === 'grid') return;                     // (the house builder has its own walls: not yet)
        root.append(el('div', { class: 'h' }, 'Trim'));
        root.append(chk('Skirting boards along the floor', () => L.skirting.on, v => edit(l => { l.skirting.on = v; })));
        if (L.skirting.on) root.append(num('Height', L.skirting.h, 0.01, 0.04, 0.3, v => edit(l => { l.skirting.h = v; }), 'm'), num('Depth', L.skirting.d, 0.005, 0.005, 0.05, v => edit(l => { l.skirting.d = v; }), 'm'), texRow('Texture', L.skirting.tex, P.defaults.trim, v => edit(l => { l.skirting.tex = v; })));
        root.append(chk('Crown moulding under the ceiling', () => L.crown.on, v => edit(l => { l.crown.on = v; })));
        if (L.crown.on) root.append(num('Height', L.crown.h, 0.01, 0.03, 0.3, v => edit(l => { l.crown.h = v; }), 'm'), num('Depth', L.crown.d, 0.005, 0.01, 0.12, v => edit(l => { l.crown.d = v; }), 'm'), texRow('Texture', L.crown.tex, P.defaults.trim, v => edit(l => { l.crown.tex = v; })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Openings'), M.UI.kit.seg([['simple', 'Simple'], ['detailed', 'Detailed']], L.frames, v => edit(l => { l.frames = v; }))));
        if (L.frames === 'detailed') root.append(chk('Window sills', () => L.sills, v => edit(l => { l.sills = v; }), 'A window board under every window, reaching into the room, with an apron under it'));
        root.append(el('div', { class: 'note' }, 'Detailed: the casing round doors and windows has a raised bead, window glass has glazing beads. These apply to the openings MLO Creator builds; openings cut from the model\'s faces keep the model\'s own frame.'));
    });

    // ---- lights ----
    const hex = (r, g, b) => '#' + [r, g, b].map(v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
    const unhex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const PRESETS = [['Warm white', 255, 214, 170], ['Soft white', 255, 238, 210], ['Daylight', 236, 244, 255], ['Neon pink', 255, 70, 180], ['Casino gold', 255, 190, 90], ['Club blue', 90, 140, 255]];
    function lightFields(o, set, compact) {
        const box = el('div');
        box.append(el('div', { class: 'row' }, el('label', null, 'Colour'), el('input', { type: 'color', value: hex(o.r, o.g, o.b), style: { width: '42px', height: '24px', padding: 0, border: 0, background: 'none' }, onchange: (e) => { const c = unhex(e.target.value); set({ r: c[0], g: c[1], b: c[2] }); } }),
            el('select', { class: 'grow', onchange: (e) => { const p = PRESETS[+e.target.value]; if (p) set({ r: p[1], g: p[2], b: p[3] }); } }, el('option', { value: '' }, 'presets...'), PRESETS.map((p, i) => el('option', { value: i }, p[0])))));
        box.append(num('Intensity', o.intensity, 0.5, 0.1, 60, v => set({ intensity: v })), num('Range', o.range, 0.5, 1, 40, v => set({ range: v }), 'm'));
        box.append(el('div', { class: 'row' }, el('label', null, 'Type'), M.UI.kit.seg([['point', 'Point'], ['spot', 'Spot (down)']], o.type || 'point', v => set({ type: v }))));
        if (o.type === 'spot') box.append(num('Inner cone', o.coneInner, 1, 1, 89, v => set({ coneInner: v }), '°'), num('Outer cone', o.coneOuter, 1, 2, 90, v => set({ coneOuter: v }), '°'));
        if (!compact) {
            box.append(num('Falloff exp.', o.exponent, 1, 1, 128, v => set({ exponent: v })), num('Corona', o.corona || 0, 0.1, 0, 4, v => set({ corona: v }), 'size'));
            box.append(chk('Casts shadows', () => o.shadows !== false, v => set({ shadows: v })), chk('Volumetric (light shafts)', () => !!o.volume, v => set({ volume: v })), chk('Specular highlights', () => o.specular !== false, v => set({ specular: v })));
        }
        return box;
    }
    // the lights placed by hand: in an imported or grabbed house they are the shell's, in a new building each level's
    function placedLights(P) {
        if (P.shell) return (P.shell.lights || []).map((l, i) => ({ l, path: ['shell', i], label: 'Light ' + (i + 1) }));
        const out = []; (P.levels || []).forEach((lv, k) => (lv.lights || []).forEach((l, i) => out.push({ l, path: ['level', k, i], label: 'L' + k + ' light ' + (i + 1) }))); return out;
    }
    const lightAt = (P, path) => path[0] === 'shell' ? P.shell.lights[path[1]] : P.levels[path[1]].lights[path[2]];
    Look.sections.push(function (root) {
        const L = look(), P = S.project;
        root.append(el('div', { class: 'h' }, 'Lights'));
        root.append(el('div', { class: 'note' }, 'Every light of the interior, unless a light below has its own settings.'));
        root.append(lightFields(L.light, (ch) => edit(l => { Object.assign(l.light, ch); }), false));
        const pl = placedLights(P);
        if (pl.length) {
            root.append(el('div', { class: 'note', style: { marginTop: '8px' } }, 'Placed lights (' + pl.length + '): give one its own colour, strength or type.'));
            pl.forEach(({ l, path, label }) => {
                const own = !!l.own, card = el('div', { class: 'route', style: { marginTop: '5px', padding: '6px 8px' } });
                card.append(el('div', { class: 'row', style: { margin: 0 } }, el('b', { class: 'grow' }, label + ' '), el('span', { class: 'note', style: { margin: 0 } }, l.x.toFixed(2) + ', ' + l.y.toFixed(2)),
                    el('label', { class: 'chk', style: { margin: '0 0 0 8px' } }, el('input', { type: 'checkbox', checked: own ? true : null, onchange: (e) => { Model.edit(Q => { const t = lightAt(Q, path); if (e.target.checked) t.own = Object.assign({}, look().light, { drop: 0 }); else delete t.own; }); M.App.refreshPanels(); } }), 'own')));
                if (own) {
                    card.append(lightFields(Object.assign({}, L.light, l.own), (ch) => { Model.edit(Q => { Object.assign(lightAt(Q, path).own, ch); }); M.App.refreshPanels(); }, true));
                    card.append(num('Hangs down', l.own.drop || 0, 0.05, 0, 2, v => { Model.edit(Q => { lightAt(Q, path).own.drop = v; }); M.App.refreshPanels(); }, 'm'));
                }
                root.append(card);
            });
        } else root.append(el('div', { class: 'note' }, 'Place lights with the Light tool (L) to give single ones their own settings.'));
    });

    // the view with a scheme's textures (the editor only: the export makes the real parts)
    Look.preview = function (batches) {
        const id = S.lookPreview, P = S.project; if (!id || !P || !P.look) return batches;
        const v = (P.look.variants || []).find(x => x.id === id); if (!v) return batches;
        return batches.map(b => (b.group === 'int' && !b.glass && v.swap[b.tex] && TEX.byId[v.swap[b.tex]]) ? Object.assign({}, b, { tex: v.swap[b.tex] }) : b);
    };

    Look.render = function (root) { Look.sections.forEach(fn => { try { fn(root); } catch (e) { M.Errors.report('look', e); } }); };
})(window.MLO);
