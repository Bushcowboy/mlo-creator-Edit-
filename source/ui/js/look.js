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

    Look.render = function (root) { Look.sections.forEach(fn => { try { fn(root); } catch (e) { M.Errors.report('look', e); } }); };
})(window.MLO);
