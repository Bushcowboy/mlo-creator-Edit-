# lib

The libraries the program is built against and runs with. The release download has them here already; the source repository does not, so put them here before running `build.ps1`.

## CodeWalker

Build [CodeWalker](https://github.com/dexyfex/CodeWalker) (or take a release), then either copy its DLLs into this folder or let `build.ps1` do it:

```
powershell -ExecutionPolicy Bypass -File build.ps1 -CodeWalker "C:\path\to\CodeWalker"
```

(or set the `CODEWALKER_DIR` environment variable). The build needs `CodeWalker.Core.dll`, `SharpDX.dll` and `SharpDX.Mathematics.dll`; the program loads the rest of CodeWalker's DLLs next to them at run time. Check CodeWalker's terms before you redistribute them (see `THIRD-PARTY-NOTICES.md`).

## WebView2

```
powershell -ExecutionPolicy Bypass -File tools\fetch-webview2.ps1
```

downloads the NuGet package `Microsoft.Web.WebView2` (version 1.0.2535.41 by default, `-Version` to change it) and copies `Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll` (x64) and its licence file here.

`package.ps1` copies this whole folder into the download.
