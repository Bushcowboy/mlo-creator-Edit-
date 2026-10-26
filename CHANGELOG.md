# Changelog

Changes on the `feature/game-interiors` branch, newest first. Each entry says how it was tested. "Not tested in game" means it compiles and passes the checks listed, but nobody has loaded it in GTA V / FiveM yet: report what breaks and the next push fixes it.

## 2026-10-26 (3) — Normal and specular maps, 24 new materials

- Every texture is exported with a normal map (`<name>_n`) and a specular map (`<name>_s`) and uses the game's `normal_spec` shader, with per-vertex tangents worked out from the UVs. Mortar, grout, plank gaps and panel joints are sunk in; tiles, marble and metal shine, plaster and carpet stay matt. Each kind of surface has its own bumpiness and shine.
- New materials: marble (white, black, green, cream), terrazzo (grey, warm), polished concrete, herringbone parquet (oak, walnut), beadboard (white, green), wallpaper (stripes, diamond prints), patterned casino and hotel carpets, brushed steel, brass, gold, black metal, and black, gold and walnut trims.
- Paint tab, *Materials in the game*: normal maps on or off (off = smaller files), and *Flip the green channel* in case bumps look raised instead of sunk in game (the one part of the normal-map convention that could not be checked here). The texture bench shows each material's normal and specular map.
- Photos and your own images get maps made from their brightness.
- Tested: every material and its maps generate without errors; an export made by the editor's own code, read back with CodeWalker, has `normal_spec` with the normal and specular textures, the right texture usages, and tangents in the vertices. **Not tested in game**: how strong the bumps and shine look, and the green channel direction.

## 2026-10-26 (2) — Export names: developer_project_

- Every file an export makes itself is named after the developer and the project, lowercase with spaces removed: developer `Bushcowboy` + project `Casino` gives `bushcowboy_casino_int.ydr`, `bushcowboy_casino_types.ytyp`, `_manifest_bushcowboy_casino.ymf`..., in a folder (resource) called `bushcowboy_casino`. A project with several buildings adds `_2`, `_3` for the second and later ones.
- The developer name is set once on any Export tab (or on the game interiors page) and kept in `settings.json` for every project.
- Game files a project replaces (a cut building model, its collision, occlusion maps) keep the game's own names, as before, so they still replace the originals.
- "Name the files after the developer and the project" can be unticked per project to type a folder and prefix by hand (prefixes can now be up to 30 characters; the host accepts 40).
- **Existing projects switch to the new names on their next export.** Remove the old resource from your server first, or untick the box and keep the old prefix.
- Tested: the real exporter (run under Mono) writes only `bushcowboy_casino_*` files for a test project; browser checks of both pages. Not tested in game.

## 2026-10-26 (1) — The game's own interiors

- New project type that lists the game's own MLO interiors, copies one anywhere, or joins several (for example the casino floor, penthouse and garage) into one MLO. Doorways that meet snap together and become one portal; the game's collision comes along; entity sets can be ticked on; "Arrange as in the game" places pieces the way Rockstar does.
- Tested: export round trip with two synthetic interiors (25 checks); host routes under Mono; browser checks of the page. Not tested against a real GTA V install or in game.
