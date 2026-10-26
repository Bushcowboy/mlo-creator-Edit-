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
    // the view with a scheme's textures (the editor only: the export makes the real parts)
    Look.preview = function (batches) {
        const id = S.lookPreview, P = S.project; if (!id || !P || !P.look) return batches;
        const v = (P.look.variants || []).find(x => x.id === id); if (!v) return batches;
        return batches.map(b => (b.group === 'int' && !b.glass && v.swap[b.tex] && TEX.byId[v.swap[b.tex]]) ? Object.assign({}, b, { tex: v.swap[b.tex] }) : b);
    };

    Look.render = function (root) { Look.sections.forEach(fn => { try { fn(root); } catch (e) { M.Errors.report('look', e); } }); };
})(window.MLO);
