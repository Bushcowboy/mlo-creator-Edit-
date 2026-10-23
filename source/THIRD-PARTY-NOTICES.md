# Third-party notices

MLO Creator's own code is under the MIT licence (`LICENSE`). It uses the components below. They are not part of this repository's source (the libraries are fetched or copied into `lib\` when you build, see `lib/README.md`), and each keeps its own licence and copyright.

## Libraries

| Component | Used for | Licence / where to check |
|---|---|---|
| [CodeWalker](https://github.com/dexyfex/CodeWalker) (`CodeWalker.Core.dll` and its own dependencies), by dexyfex | Reading and writing GTA V game files (`.ydr`, `.ybn`, `.ytd`, `.ytyp`, `.ymap`, game archives) | Copyright (c) dexyfex. The repository does not carry a licence file that I could find; its `Notice.txt` credits MIT-licensed code (Neodymium, Cameron Berry) and a GPL-licensed FBX library (Hamish Milne's FbxWriter). **Check the terms with the author before you redistribute its DLLs or choose a licence for code that links to them.** |
| [SharpDX](https://github.com/sharpdx/SharpDX) | Maths and DirectX bindings used by CodeWalker | MIT |
| [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (`Microsoft.Web.WebView2.Core.dll`, `.WinForms.dll`, `WebView2Loader.dll`) | Showing the editor in a native window | Microsoft's WebView2 licence, shipped as `lib\WebView2-LICENSE.txt` by `tools\fetch-webview2.ps1`. The runtime is a Windows / Edge component and is not redistributed here. |

The other DLLs that CodeWalker's build contains (`WeifenLuo.WinFormsUI.Docking`, `FastColoredTextBox`, `CodeWalker.WinForms`, further `SharpDX.*` assemblies) are copied by `build.ps1` only because CodeWalker's library loads them; check each one's licence in its own project if you redistribute them.

## Models in `models\`

These are other people's work, used under their licences. The full credits are in `models/CREDITS.txt`.

| File | Author | Licence |
|---|---|---|
| `animated_window_systems.glb` | makinwhat | CC BY-NC 4.0: **non-commercial only**, credit required |
| `door_wooden_old-18mb.glb` | Mehdi Shahsavan | CC BY 4.0: credit required |
| `door_frame.glb` | CrIsTaL | CC BY 4.0: credit required |

When one of these is placed in an interior, MLO Creator writes the credit and licence into the README of the exported resource. A resource that includes `animated_window_systems.glb` inherits its non-commercial condition.

## Game content

GTA V, its models, textures, maps and archives belong to Rockstar Games. MLO Creator ships none of them. It reads the game files from your own installation (or the files you import) and writes modified copies into the resources you export. Follow Rockstar's and FiveM's terms when you publish what you make.
