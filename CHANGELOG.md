# Changelog

Changes on the `feature/game-interiors` branch, newest first. Each entry says how it was tested. "Not tested in game" means it compiles and passes the checks listed, but nobody has loaded it in GTA V / FiveM yet: report what breaks and the next push fixes it.

## 2026-10-26 (7) — Server and world: your server's MLOs, encryption, overlaps

- New page **Server and world** (start screen and project list): type or pick your server's resources folder and *Scan the folder*. Every resource under it is found, also inside `[category]` folders.
- **Encrypted files**: a resource with a `.fxap` file is marked *escrow*, and every stream file whose bytes are not a GTA file (not `RSC7`, `PSIN`, `RBF0`) is listed as encrypted and left out. Everything else is read. Nothing is written to the server folder.
- From the readable files: the MLOs each resource defines (`.ytyp`), where its maps place them (`.ymap`), their interior collision (`.ymf` manifests), and the extents of its plain map files.
- **To look at**: MLOs whose boxes overlap (at least 0.5 m in every direction) with each other, and with the game's own interiors once *Add the game's interiors* has read their list; archetype names defined by two resources; file names streamed by two resources (only one copy loads). Click one to fly to it on the map.
- The map: every placed MLO as its box (coloured by resource), the plain map files as outlines, the game's interiors as grey dots, overlaps as red rings. Click an MLO for its position, rooms, entities and collision files.
- Tested: a scan of a test server folder (two real exported MLOs placed 3 m apart, an escrow resource with random-byte stream files, a resource streaming a copy of another's collision and type file) finds 4 resources, the escrow badge and 3 encrypted files, the overlap, the duplicate file and both duplicate archetypes; the page against the real scan in a browser. **Not tested** on a real server folder or real escrowed resources.
- Next: the area around a spot in 3D (the game's buildings, your MLOs and their collision together), then opening an MLO's files in a project to fix its collision.

## 2026-10-26 (6) — Timecycle editor

- Paint tab, *Timecycle*: *Usual* (what MLO Creator always used), *The game's* (any of the game's timecycle modifiers by name; *Read the game's list* reads every `timecycle_mods` file of your install, plain or binary XML), or *My own*.
- *My own*: sliders for exposure, daylight through windows, interior ambient, ambient from below and above (with colours), bloom and its threshold, ambient occlusion, reflection ambient, and light on people (with colour). Each value has a tick: unticked values are not written, so the weather's timecycle decides them. *Start from* copies all the values of one of the game's modifiers (values without a slider come along unchanged).
- On export your own modifier is written to `timecycle_mods_<resource>.xml` at the resource root as `<prefix>_tc`, listed in `files` and registered with `data_file 'TIMECYCLEMOD_FILE'`; the interior's room uses it.
- Variable names and the file format come from the game's own modifier files (checked against the game's `v_laund_rm`); the `TIMECYCLEMOD_FILE` data file type is in FiveM's documentation.
- Tested: reading a game modifier file; the exported file, `numMods`, fxmanifest lines and the room's timecycle hash (read back with CodeWalker); host routes; browser checks. **Not tested in game**: how the values look.

## 2026-10-26 (5) — Skirting, crown moulding, detailed openings, light settings

- Paint tab, *Trim* (imported-model and grabbed-house projects): skirting boards along the floor (height, depth, own texture; they run under windows, stop at doorways and close the corners), crown moulding under the ceiling (also over doors), on room walls and on both faces of partitions.
- *Openings: Detailed*: the casing round doors and windows gets a raised bead, window glass gets glazing beads, and *Window sills* adds a window board reaching 7 cm into the room with an apron under it. Openings cut from the model's own faces keep the model's frame.
- Paint tab, *Lights*: the project's light (colour with presets, intensity, range, falloff, point or downward spot with cone angles, corona, shadows, volumetric shafts, specular highlights), and every placed light can have its own settings (*own*), including hanging lower.
- On export: spot lights are written as spots with their cones; shadows set the light flags 0x40/0x80/0x100, volume 0x1000, no-specular 0x2000 (from the game's light flag list).
- **Older projects** get skirting and detailed openings on their next export (the new defaults). Untick or pick *Simple* to keep the old look.
- Not yet for *Whole new building* projects (they build walls differently).
- Tested: shell builder in Node (skirting 0–10 cm, stops at the doorway, runs under the window, closes the corner; crown under the ceiling; sill under the window; placed light hangs lower); real exporter + CodeWalker: spot type, 20/40° cone, shadow flags, colours, range; browser checks. **Not tested in game**: how the flags and cones look.

## 2026-10-26 (4) — Wall colour schemes as entity sets

- Paint tab, *Wall colours (entity sets)*: add colour schemes; in each, swap any texture used inside (pick a texture in the bench, then *Use picked*). *Show* previews a scheme in the 3D view.
- On export, every surface whose texture a scheme swaps leaves the interior's always-there model and goes into one model per scheme (`<prefix>_pnt0.ydr` = the colours as painted, `_pnt1`, `_pnt2`...). Each is an entity set of the MLO named `<prefix>_paint_<scheme>`, e.g. `bushcowboy_casino_paint_navy`. The default set (`<prefix>_paint_default`, renameable) is on by default in the placement map; switching is left to your script. The README lists the sets with an `ActivateInteriorEntitySet` example.
- Surfaces no scheme touches stay in the interior model. Textures repeat at their own size in each scheme. A scheme that swaps nothing is not exported.
- Smoother normal maps for wallpaper and brushed metal.
- Tested: an editor-built export with two schemes, read back with CodeWalker: 3 entity sets with one part each in room 1, the always-there part as the only MLO entity, the swapped textures in the scheme models, only the default set on in the ymap, README section; browser checks of the panel. **Not tested in game**: switching the sets live.

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
