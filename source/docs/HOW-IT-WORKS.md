# How MLO Creator works

This is the reference for what each part of the program does and how it is built. The README covers installing and running it.

## Contents

1. [Architecture](#architecture)
2. [Project types](#project-types)
3. [Workflow for an interior in an imported model](#workflow-for-an-interior-in-an-imported-model)
4. [Coordinates](#coordinates)
5. [Cutting the model and its collision](#cutting-the-model-and-its-collision)
6. [Doors and windows](#doors-and-windows)
7. [Props and plants](#props-and-plants)
8. [Several buildings in one project](#several-buildings-in-one-project)
9. [Export](#export)
10. [Limits](#limits)
11. [Whole new building](#whole-new-building)
12. [The game's own interiors](#the-games-own-interiors)
13. [Server and world](#server-and-world)
14. [Controls](#controls)
15. [Code map](#code-map)

## Architecture

- `MloCreator.exe` is a C# 5 program (.NET Framework, built with the `csc.exe` that ships with Windows). It starts a small HTTP server on `127.0.0.1` with a random token and serves the editor from `ui\` on disk.
- The editor is a WebGL page. It is shown in a native window (`AppWindow.cs`, WinForms with Microsoft's WebView2). If WebView2 is missing it falls back to an Edge or Chrome `--app` window; `logs\window.log` says why.
- The page keeps the project (a JSON file in `projects\`), runs all the editing tools, builds the interior's meshes and collision, and sends a description of the result to the host on Export.
- The host does everything that needs game files: reading `.ydr`, `.yft`, `.ybn`, `.ytd`, `.ytyp`, `.ymap` and the game's archives through CodeWalker's library, cutting models and collision, and writing the resource.
- The window closes the program; unsaved work is saved first. Projects also autosave.

Because the UI is served from disk, a change in `ui\` only needs a reload of the page; a change in `src\` needs a rebuild.

## Project types

- **Interior in an imported model.** Import the files of a building, cut openings, draw rooms, finish, export. This is the main workflow and is described below.
- **Whole new building.** Build a house on a grid with walls, rooms, doors, windows, stairs, levels and a roof.
- **Interior for an existing house (older).** Projects made with the early automatic mode still open and export as they did.
- **The game's own interiors.** Copy a Rockstar interior (the casino, an apartment, an office...) to any place, or join several into one MLO. See [The game's own interiors](#the-games-own-interiors).

## Workflow for an interior in an imported model

The Build tab shows a route of nine stages that open like dropdowns; a card above it says how far along you are and what to do next.

1. **Import the model.** Add `.ydr`, `.ytd`, `.ybn` and `.ymap` files, or look them up in the game files. The biggest `.ydr` is the model. Say where the model stands in the game (take it from an imported `.ymap`, look it up, or type x, y, z and heading).
2. **Set up the building.** A model is often a whole block. *Select building* finds the separate objects of the model (vertices that coincide belong together), hides the rest, squares the grid to its walls and moves the camera to it. *Frame* squares the grid to a wall you click; Shift+click sets the floor height, Alt+click moves the corner.
3. **Draw the rooms.** *Add room* drags a rectangle (floor, walls, ceiling); *Cut out* removes a rectangle; *Partition* draws an inner wall; *Select* edits any of them with handles. Edges snap to the model's walls and to 5 cm. *Fit rooms to the walls* snaps every room edge to the building's wall faces.
4. **Doors and windows.** Door, Window and Archway tools cut through the model; the Models tool places door and window models from your own `.glb` files.
5. **Clean up the model.** Delete faces, model parts, edges (fill holes), collision pieces, and your own collision boxes. The model's parts that stick into the rooms are cleared automatically.
6. **Props and small removals.** Bushes, trees and other props the map places around the building, and small pieces of the model.
7. **Finish the inside.** Floor and wall paint (also with the model's own textures), ceiling lights, ceilings, columns and beams, props.
8. **Check it.** The checklist and the walk check.
9. **Export.**

### Ceilings, columns and beams

- **A room's ceiling** (select the room): flat, vaulted (gable), barrel, tray or shed, with its rise, the direction of the ridge and a texture; and beams across, along or both ways (under a vault they follow it as ribs, rafters and purlins). The gable ends close the space above the walls, and the sloped ceiling gets collision. The building's roof has to be higher than the vault.
- **Column** (8): click the floor; square or round, with a base and capital, up to the ceiling above it (also under a vault). **Beam** (9): click its start and its end; straight or 45° (Shift: any angle), its top at the ceiling or at a height you give; low beams get collision. Both are listed in their tool panels with their settings; Alt+click (beams) or a second click (columns) or the Eraser removes them.

### Placing props

The **Place props** tool (key 0, *Finish the inside*) puts the game's props, or model files of yours, inside the interior. Pick a model in the panel, then click the floor; click another prop to stand the model on top of it (a vase on a table). With no model chosen (Esc), or with Alt, a click selects a prop and a drag moves it; R turns it 90° (Shift+R: 15°), Shift+D copies it, X removes it, and the panel has its position, height and facing. The models come from what the project is made of:

- **From your files**: the props your imported map files (`.ymap`) place, the most used first (not the building's own models, not LOD copies), and model files of the project that nothing places.
- **Around the building in the game**: the props the game's map places within 25 m of the building, by how often each stands there (needs the building's placement and the game).
- **Same game archive**: the other models of the `.rpf` that holds the building's model.
- **From a game interior**: the game's interiors within 600 m of the building, or one found by name; its props with how many it uses and the entity set they belong to (its big wall and floor pieces are left out).
- **Search every game model**: every `.ydr` and `.yft` name of the game.

The view draws each prop's own mesh (a box while it has no picture). On export every prop is an entity of the interior room. For a game model, the type file that defines it (from the list of the game's models that is made with the game's interior list) is added to the interior's manifest, so the game loads it with the interior. A model file of yours is copied into the resource with the texture file it uses and defined in the interior's type file. The README lists them.

### The model's own textures

The textures of your imported files can be painted on your walls, floors and ceilings: the Paint tab's *From the model* and the bench's *From the model* category (the most used first). Each one comes at the size it has on the model (the host measures it from the model's texture coordinates; a picture that is not square keeps its proportions), which you can change (*repeats every*, kept in the project). Its own normal and specular maps and its shader's bumpiness and shine come with it; without them a normal map is made from the picture. The bench also shows the program's textures closest in colour. On export the picture itself (and its maps) is copied from your files into `<prefix>_tex.ytd`, at most 1024 px (the bigger mip levels are left out, nothing is compressed again); the 256 px preview stands in when the file is gone.

### Materials in the game

Every texture is a pattern made by the program (or a photo, or an image you add). On export each one becomes three textures: the colour, a normal map (`_n`, the bumps: mortar, grout and plank gaps are sunk in) and a specular map (`_s`, what shines: the faces of tiles more than their grout). Surfaces use the game's `normal_spec` shader, with a bumpiness and shine for each kind of material (marble and tile shine, plaster and carpet are matt). The Paint tab has *Normal and specular maps* (untick for flat textures and smaller files) and *Flip the green channel* (tick it if bumps look raised instead of sunk in the game). The 3D view shows the colour only.

### Wall colours (entity sets)

The Paint tab's *Wall colours* makes colour schemes for the inside. A scheme swaps textures: everything painted Cream Plaster becomes Navy Diamond Paper, say, and the oak floor becomes walnut. *Show* puts a scheme in the view. On export, the surfaces that any scheme swaps are taken out of the interior model and written once per scheme (`<prefix>_pnt0.ydr` with the colours as painted, `_pnt1`... for the schemes); each becomes an entity set of the MLO called `<prefix>_paint_<name>`. The default one is on when the interior loads; a script switches with `DeactivateInteriorEntitySet` / `ActivateInteriorEntitySet` and `RefreshInterior` (the exported README has the names and an example). Keep one colour set on at a time.

### Trim and lights

*Trim* (Paint tab): skirting boards and crown moulding along every wall and partition, with their own height, depth and texture; *Openings: Detailed* adds a bead to door and window casings, glazing beads to the glass and (with *Window sills*) a window board. *Lights* (Paint tab) sets the light every light of the interior uses: colour, intensity, range, falloff, point or downward spot, cone, corona, shadows, volume, specular. A light placed with the Light tool can have its own settings (tick *own* in the list), and can hang lower.

### Timecycle

The *Timecycle* section of the Paint tab sets how the game lights and grades the inside. *The game's* uses one of the game's timecycle modifiers by name (*Read the game's list* lists them from your install). *My own* makes a modifier: exposure, daylight through windows, ambient light from below and above, bloom, ambient occlusion, reflections and light on people; untick a value to leave it to the weather. *Start from* copies one of the game's modifiers to change it. The export writes it to `timecycle_mods_<resource>.xml` (registered as `TIMECYCLEMOD_FILE`) and the room uses it as `<prefix>_tc`. The editor's view does not show timecycles: check them in the game.

### Room settings

- **Ceiling height** and **wall depth** are in the right panel. *Match the building* picks the ceiling top that most of the building's own wall area has.
- **Wall thickness** moves the inner face of every wall into the room, so parts of the building that stick through the wall by less than that are covered. Corners meet at the moved faces and openings get reveals.
- **Interior walls** can be built from the room edges (default) or from the building's own wall faces turned round to look into the rooms (experimental).

### Tools at a glance

| Tool | Does |
|---|---|
| Select building | Pick the objects of one building out of the model |
| Frame | Square the grid to a wall; set floor height and corner |
| Raise / lower rooms | Move all rooms up or down against the model |
| Add room, Cut out, Partition | Draw the interior |
| Fill gaps | Fill empty floor between rooms |
| Door, Window, Archway | Cut an opening through the model, collision and interior walls |
| Window / door models | Place `.glb` models by hand |
| Delete faces | Select and delete faces of the model, like edit mode in Blender |
| Model parts | List the model's parts (one per texture) and remove or select a whole part |
| Edges | Show open edges and fill holes |
| Collision | Select and delete the building's invisible collision pieces |
| Collision box | Draw your own collision boxes |
| Props and plants | Pick and remove map props, plants and small pieces |
| Floor paint, Light | Finish the inside |
| Column, Beam | Columns from floor to ceiling, beams under it |
| Place props | The game's props or your own models inside, suggested from your files, the building's surroundings and the game's interiors |
| Walk check | Walk a player-sized capsule through the result |
| Scale figure | A 1.8 m figure to judge heights against |
| Cutaway | Hide the model above a height to see inside |

## Coordinates

There are three frames and the program converts between them:

- **Grid (shell) frame:** the grid the rooms are drawn on, with the floor at z = 0.
- **Model frame:** the building model's own coordinates. Every model file of a map (the building and each detail file) is centred on its own entity, so each file has its own origin.
- **World frame:** the position and heading of the model's entity in the game.

A project with detail files (grilles, vents, bushes and props of the block) stores where each one stands (`import.detailPlace`); the editor moves every detail file into the building's coordinates and gives the host the rooms in each file's own frame.

## Cutting the model and its collision

- **Openings.** A cutter is a box. The triangles of the model inside it are removed and the triangles it crosses are split along its faces. The same box opens the interior walls and cuts the model's collision files: boxes that line up are split around the opening, other shapes are removed when their centre is inside.
- **Clearing the model out of the rooms.** Everything of the model that lies inside a room is cut at the room's walls: window boxes and frames, vegetation cards, vents, anything else. The three kinds (windows, vegetation, everything else) have ticks and counts. The outside surface of the building is kept: a face that looks out of the room through one of its walls and lies within 15 cm of it is not cut. Windows get a further depth (default 10 cm) so their frames stay.
- **Clearing the collision.** The building's collision often fills its rooms with invisible slabs and blocks. With *Clear the building's collision inside the rooms* (on by default) every room volume is cut out of the collision files. The count of what is left is shown all the time, and the Collision overlay draws it in red.
- **Detail models.** Faces deleted from detail files are stored per file (`import.mdeletes`) and the export writes those files again with the faces taken out. A geometry left with no faces is removed.
- **Fills.** Holes filled with the Edges tool are added to the model when it is cut and are written into the exported model.

## Doors and windows

### Cut openings (Door, Window, Archway)

Click the faces of a door or window of the model (the flat patch lights up) and click. The faces are deleted, the interior wall behind it and the collision are opened, and a window gets glass at the plane of the faces. A plain frame is built around cut-out windows and doors, or you can keep the model's own frame, or have none. Gaps in the model's wall beside a cut-out are measured and closed with trim.

### Door and window models from `.glb` files

Models you bring (for example from Sketchfab) go into the project like other files. The host reads each mesh with its node transform; a file with several windows is split into one model per window. Animations are not used.

- **Placing:** choose a model, click a wall. Nothing is cut for you: *Select the wall faces behind it* and *Select the building's collision there* select what you probably want to delete.
- **Gizmo:** arrows move along width, depth and height; cubes resize; a ring turns in 15 degree steps. Positions snap to 1 cm.
- **A window's hole** in the room wall is the model's size minus 1 cm all round. **A door's hole** can match the size of the building's own door-shaped opening; the door is centred in it.
- **Frames** are a third kind, placed in an opening to hold a door.
- **Setting a model up:** a model can come out of its file lying down or facing the wrong way, so each model has a stored turn; doors and frames are stood up automatically when none is stored.
- **Double doors:** a door placement can be two leaves hinged on the outer edges and meeting in the middle. The leaf whose knob would sit on its hinge side is the model mirrored left to right.

### How a door is exported

Each door is a prop of its own made like the game's own doors: archetype flags `0x24020000` with special attribute 7, a composite collision bound with one box child, the hinge at mid height as the origin, and a physics dictionary entry of its own name. The README of the export lists each door's model name, hash, hinge position and heading, which is what a door script such as ox_doorlock asks for. The game ignores the scale of an entity, so the size you give a model is baked into its vertices.

Windows are merged by material into extra parts of the interior; their glass uses the interior's glass shader.

## Props and plants

Bushes, hedges, trees and props that stand around a building are not in the model's files: the game's map files (`.ymap`) place them. The Props and plants tool finds them and lets you hide the ones you choose.

- **Lookup.** The host reads every map file that covers the model's extent plus 8 m (`Vanilla.PropsInBox`) and lists the props. A prop counts as a plant by its name, by the archive that holds its model (`bush`, `veg`, `tree`...), by its foliage shader or by leaf and branch textures. Fragment props (`.yft`) are read too. Copies of the same prop in several map files are merged. Results depend only on the model, not on one building.
- **Rules.** A plant is hidden by the rule when at least 3 of its triangles and at least a set percentage (5 by default) lie inside a room, or when it stands right in front of a window or door and is bush-sized. Anything else is only hidden if you pick it. Other props are never hidden by a rule.
- **In the view.** *Show the models* draws the game's own meshes where the map places them: orange = will be removed, green = stays, blue-grey = other props, cyan = bushes made of cards inside the model files, lilac = small pieces of the model.
- **Picking.** Click a model to select it, Shift adds, **A** all, **Alt+A** none, **Ctrl+I** invert, **X** or Delete removes, **R** keeps, Esc deselects, Ctrl+Z undoes.
- **Model-file bushes and small pieces.** Their triangles are deleted from the file they are in (the same way as the Delete faces tool).
- **Export.** `client/plants.lua` calls `CreateModelHide(x, y, z, 0.6, GetHashKey(model), true)` once for each hidden prop (the exact spot of that one prop) and `RemoveModelHide` when the resource stops. No map file is replaced.

Not covered: procedural grass (drawn by the game on the ground) and props wider than 16 m (road pieces).

## Several buildings in one project

A block holds many buildings but only one resource can replace the model's files, so all of them are made in one project. Each building has its own grid, rooms, partitions, lights, openings, collision boxes, ceiling height, wall settings and textures. The model, deleted faces, removed parts, deleted collision and the model's placement are shared. The model is cut by the openings of all buildings. On export each building becomes its own interior (`<prefix>int.ydr`, `<prefix>mlo.ybn`, ...) with the building's number added to the prefix for the second and later ones.

## Export

Press Export on the Export tab; the folder goes to `output\<folder>` (or the folder you set).

**Names.** Every file the export makes itself is named `developer_project_...` (lowercase, letters and digits): developer `Bushcowboy` and project `Casino` give `bushcowboy_casino_int.ydr` in a folder `bushcowboy_casino`. The developer is typed once on the Export tab and kept in `settings.json` for every project; the project name is the one at the top. The second and later buildings of a project add `_2`, `_3`. Untick *Name the files after the developer and the project* to type a folder and prefix yourself. Game files the export replaces (the cut model, its collision, occlusion maps) keep the game's names so they replace the originals. Upload it to the server's resources, `refresh`, `ensure <folder>`. The log and the README in the folder give a test spot inside the interior.

| File | Content |
|---|---|
| `<prefix>_int.ydr` | The interior: floors, walls, ceiling, trim, lights (`<prefix>` is `developer_project`, see Names above) |
| `<prefix>_glass.ydr` | Window glass |
| `<prefix>_pnt0.ydr`, `_pnt1.ydr`... | The surfaces the colour schemes swap, once per scheme (entity sets `<prefix>_paint_...`) |
| `<prefix>_mlo.ybn` | Collision for floors, walls and your boxes |
| `<prefix>_tex.ytd` | Only the textures you used (the model's own pictures copied from your files, up to 1024 px) |
| `<prefix>_types.ytyp` | The MLO: limbo room + interior room, one portal for each door or window that reaches the outside, the door props and the props you placed |
| `<prefix>_milo_.ymap`, `_manifest_<prefix>.ymf` | Where it stands, and the interior marker (with the game's type files the placed props need) |
| `<name>.ydr` and its `.ytd` | Model files of yours placed as props |
| the model's `.ydr` | The building model with your cuts, written under its original name so it replaces the game's one while the resource runs |
| the imported `.ybn` files | The collision with the same cuts |
| the occlusion `.ymap` files | The same files without the boxes inside your interior (only when some were inside) |
| `_fm*.ydr`, `_fd*.ydr` | Window parts and door props from `.glb` models |
| `client/plants.lua` | Hides the props you removed |
| `timecycle_mods_<resource>.xml` | Your own timecycle modifier (when you made one) |
| `fxmanifest.lua`, `client/ipl.lua`, `README.md` | The resource itself and a list of the game files it replaces |

## Limits

- Never assume it works in game without testing. Streaming, lighting, portals, collision and door behaviour have to be seen in the game.
- Only one resource can replace a given game file.
- Rooms are axis-aligned rectangles in the grid, one level, one interior room for the whole interior. A shaped ceiling covers its room's whole rectangle.
- A cutter opens the interior walls only when it is square to the grid (within 1.5 degrees); the model and the collision are cut at any angle.
- Spheres, capsules and cylinders of the collision are not clipped.
- Collision boxes you draw are boxes only and are not checked against anything.
- The walk check tests the files' collision with a flat capsule on one level, not the game's character controller.
- Door props are static: wire them to your door script by model and coordinates.
- Textures that are not in the files you import are shown in plain colours in the editor; the game uses its own.
- The model's tilt is ignored (only the turn about the vertical is used); the model's scale must be 1.
- Placed props turn about the vertical only and keep their own collision. Which of the game's type files defines a prop comes from the list of the game's models made with the game's interior list: without it, props whose type file is not always loaded may not show (the export says so).

## Whole new building

| Tool | Does |
|---|---|
| Wall | Drag grid corner to grid corner |
| Room | Drag a rectangle: four walls and the floor |
| Floor | Drag cells: floor without walls |
| Door, Window, Archway | Click a wall; click again to remove |
| Stairs | Click a cell; steps, run, width, direction, railings |
| Roof | Drag cells: flat roof slab |
| Light | Click a cell for a ceiling light |
| Entrance | The door whose in-game position places the house |
| Eraser | Remove walls and cells |

Stand in the entrance doorway in the game and paste `vec4(x, y, z, heading)` to place the house.

## The game's own interiors

The game's interiors (the Diamond Casino, apartments, offices, garages, clubhouses...) are MLOs already: each is an MLO archetype in one of the game's `.ytyp` files, placed by a `.ymap` and tied to its collision by a manifest (`.ymf`). This project type copies them: **New project > The game's own interiors** opens a page of its own (`interiors.html`). A combination is saved as a project like the others (kind `combo`) and opens from the project list.

### The list

*Build the list* reads every `.ytyp`, `.ymap` and `.ymf` of your install once (a few minutes) and keeps the result in `cache\mlo_index.txt` and `cache\mlo_archetypes.txt`. *Rebuild the list* reads them again after a game update. For each interior it knows the type file and DLC pack that hold it, its rooms, portals and entity sets, where the game places it (and which entity sets it shows there), and its collision files.

Most interiors are stored by number only (`hash_...`), so the list also shows the type file name (`vw_int_casino_main`), the map files that place it and the room names; the search matches all of them. Typing an interior's real name finds it and names it from then on (kept in `cache\mlo_names.txt`).

### The plan

- **Add** puts an interior on the plan: rooms as outlines, entities as dots, portals as lines (amber: a doorway to the outside, green: two pieces' doorways that the export joins, grey: between rooms of one piece).
- **Drag** a piece to move it (5 cm steps, Alt for none). When one of its doorways comes within 0.8 m of another piece's doorway (parallel, a similar size) it snaps so they meet exactly; Shift places it freely. **R** turns it 90 degrees about its middle (Shift+R: 15), the arrow keys move it, Page Up / Page Down raise and lower it, Delete removes it. Ctrl+Z / Ctrl+Y undo and redo.
- **Arrange as in the game** places every piece relative to the first the way the game places its own copies, which is how the casino floor, the penthouse and the garage fit together.
- **Heights** shows only the rooms between two heights, to see one floor of a building with several.
- **Entity sets**: tick the ones that should be on. They start as the game shows them at its own copy (*As in game*).
- **Where it stands in the world**: x, y, z and heading of the joined interior, or paste a `vec4`. It starts where the game has the first piece; the page warns while a piece stands within 60 m of the game's own copy, since the two would overlap if the game's copy is loaded.

### Export

One resource, written to the output folder like the other exports:

| File | Content |
|---|---|
| `<prefix>_types.ytyp` | One new MLO archetype: every piece's entities, rooms, portals, entity sets and timecycle modifiers, moved to where you put the piece. One limbo room for all of them; room and entity numbers are renumbered, duplicate room and set names get `_2`, `_3`... |
| `<prefix>_mlo.ybn` | The game's collision of every piece in one file: each part keeps its geometry and gets the piece's move in its transform; the room each polygon belongs to is renumbered. Collision stored in world space is moved back into the interior first. |
| `<prefix>_milo_.ymap` | The placement, with the ticked entity sets as its default sets |
| `_manifest_<prefix>.ymf` | Ties the interior to its collision, and lists the game's own type files that define the models the entities use, so the game loads them with the interior |
| `client/ipl.lua` | Loads the placement map, switches on the ticked entity sets that have a readable name, and (when ticked) loads the pieces' original map files |
| `fxmanifest.lua`, `README.md` | The resource, the pieces, a test spot to teleport to, and the warnings |

No model, texture or other game file is copied: the entities keep the game's model names and the game streams them itself. Interiors of a DLC need a server game build that has that DLC (`sv_enforceGameBuild`).

**Joining doorways.** Pieces always share the outside (limbo), like separate interiors standing next to each other. With *Join doorways that meet* (on by default), a doorway of one piece that lies on a doorway of another (centres within 35 cm, parallel, area within a factor of 2) becomes one portal from room to room, so you see and walk straight through.

### Limits of this project type

- Everything has to be tested in the game: streaming, portals, lighting, collision, and which entity sets look right together.
- The game's collision can name only 31 rooms. A joined interior with more rooms works, but the collision of the rooms after the 31st says "outside"; the export warns.
- Interiors that the game's manifests list no collision for come without collision; the export warns.
- Entity sets known only by number cannot be switched on by name from a script; they are still on by default when ticked.
- Pieces that the game does not place itself (no map file) stay where you put them in *Arrange as in the game*.
- Scripted parts of the game's interiors (the casino's games, lifts, doors that open by script) are not part of the interior and do not come with it.

## Server and world

**Server and world** (on the start screen and in the project list) reads your server's resources folder; nothing in it is changed.

- *Scan the folder* finds every resource (a folder with `fxmanifest.lua` or `__resource.lua`, also inside `[category]` folders) and looks at every `.ytyp`, `.ymap`, `.ybn`, `.ydr`, `.ydd`, `.yft`, `.ytd` and `.ymf` file in it.
- **Encrypted files.** A resource with a `.fxap` file uses asset escrow. A stream file whose first bytes are not a GTA file (`RSC7`, `PSIN`, `RBF0`) is encrypted: it is listed with a lock and not loaded. No tool can read or change those files.
- **What is read**: the MLOs the type files define, where the map files place them, which collision files belong to which interior (the manifests), and the extents of plain map files.
- **To look at**: MLOs whose boxes overlap (by at least 0.5 m every way) each other or the game's own interiors (press *Add the game's interiors* to include those), archetype names defined by two resources, and file names streamed by two resources (only one of the copies loads in the game).
- **Look in 3D** shows the area round a selected MLO or a clicked spot (20–300 m): the game's buildings in grey, your resources' MLOs and map entities in their colours, and the collision of both as lines (the game's orange). Their models come from your resources' stream files, or from the game for the game's own model names; encrypted files are not opened. Interior collision is moved by every placement of its MLO. Lines of two colours running through each other are collision that clashes.
- **Fix its collision** (in the 3D view, on a resource): click a piece of its collision to select it, take it out (Delete; Shift+Delete for its whole part) or add a collision box standing on the clicked point (B, with width, depth and height); Ctrl+Z undoes. *Write the fixed files* puts fixed copies in `output\<resource>_collision_fix\` under the files' own paths, with a README. Copy them over the originals yourself; the server folder is never written. Boxes added to an interior's collision are put into the interior's own space.
- **The map** shows every placed MLO as its box, coloured by resource, plain map files as outlines, the game's interiors as grey dots and overlaps as red rings. Click a conflict to fly to it, an MLO for its details.

## Controls

**Camera:** middle-drag orbits (Shift pans, Ctrl zooms), right-drag also orbits, wheel zooms, keypad 1 / 3 / 7 for front / right / top (Ctrl for the opposite side), Home frames everything, WASD moves, Q / E turn 90 degrees, T is top-down.

**General:** Ctrl+Z / Ctrl+Y undo and redo, Esc or right-click cancels a drag, Ctrl+S saves. The hint bar above the status line shows the active tool's keys.

**Tool keys:** Add room 1, Cut out 2, Partition 3, Door 4, Window 5, Archway 6, Floor paint 7, Light L, Select V, Eraser X, Select building B, Frame O, Raise / lower G, Fill gaps J, Delete faces F, Model parts P, Edges K, Collision M, Collision box N, Window / door models I, Props and plants Y, Column 8, Beam 9, Place props 0, Walk check U, Scale figure H, Cutaway C.

## Code map

| Path | Content |
|---|---|
| `src\Program.cs` | Local server, routes, settings, window start |
| `src\AppWindow.cs` | The native window (WebView2) |
| `src\ImportHost.cs` | Import, lookups, placement, props routes |
| `src\ModelCut.cs`, `src\CollisionCut.cs` | Cutting the model and its collision |
| `src\Vanilla.cs` | Reading the game's archives and map files |
| `src\Exporter.cs`, `src\FitExport.cs` | Writing the resource, door and window props |
| `src\Interiors.cs` | The game's own interiors: the list, one interior's rooms and portals, joining pieces into one MLO |
| `src\Timecycles.cs` | The game's timecycle modifiers, and writing your own |
| `src\Server.cs` | Your server's resources: encrypted files, MLOs, placements, overlaps and clashes |
| `src\GlbModels.cs` | Reading `.glb` models |
| `ui\js\importmodel.js`, `importtools.js`, `importui.js` | The import workflow: model, tools, side panels |
| `ui\js\plants.js` | Props and plants |
| `ui\js\shell.js`, `mesher.js` | Building the interior's meshes and collision |
| `ui\js\fitmodels.js` | Placing `.glb` models |
| `ui\js\walk.js` | The walk check |
| `ui\interiors.html`, `ui\js\interiors.js` | The game's own interiors: list, plan, export |
| `ui\js\look.js` | Paint tab: materials, wall colours, trim, lights, timecycle |
| `ui\js\structure.js` | Room ceilings (vaulted, barrel, tray, shed), the Column and Beam tools |
| `ui\js\props.js`, `src\Assets.cs` | The Place props tool, and the models it suggests |
| `ui\world.html`, `ui\js\world.js`, `ui\js\world3d.js` | Server and world: your resources on the map, the area in 3D |
| `src\Area.cs` | An area in 3D: the game's buildings, your MLOs, and the collision of both |
