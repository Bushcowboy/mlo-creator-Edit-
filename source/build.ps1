# Builds MloCreator.exe with the .NET Framework C# compiler (no SDK needed, C# 5).
#
# lib\ has to hold the libraries the program uses (see lib\README.md):
#   - CodeWalker.Core.dll and its dependencies (SharpDX*.dll ...): copied from a CodeWalker folder the first time, pass -CodeWalker <folder> or set CODEWALKER_DIR
#   - Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll, WebView2Loader.dll: tools\fetch-webview2.ps1 gets them
# -Out builds to another file name (a running program is then left alone).
param([string]$CodeWalker = $env:CODEWALKER_DIR, [string]$Out = '')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $here 'lib'
if (-not (Test-Path "$lib\CodeWalker.Core.dll")) {
    if (-not $CodeWalker -or -not (Test-Path "$CodeWalker\CodeWalker.Core.dll")) { throw "CodeWalker.Core.dll is not in lib\. Pass -CodeWalker <folder with CodeWalker.Core.dll> (or set CODEWALKER_DIR), or copy its DLLs into lib\ (see lib\README.md)." }
    New-Item -ItemType Directory -Force $lib | Out-Null
    Get-ChildItem $CodeWalker -Filter *.dll | Where-Object { $_.Name -notmatch '^Microsoft\.Web\.WebView2' } | ForEach-Object { Copy-Item $_.FullName $lib -Force }
}
foreach ($n in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') { if (-not (Test-Path "$lib\$n")) { throw "$n is missing from lib\: run tools\fetch-webview2.ps1." } }
Get-ChildItem $lib -Filter *.dll | Unblock-File
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc (the .NET Framework 4.x compiler that comes with Windows)." }
$out = if ($Out) { Join-Path $here $Out } else { Join-Path $here 'MloCreator.exe' }
$srcs = Get-ChildItem (Join-Path $here 'src') -Filter *.cs | ForEach-Object { $_.FullName }
$fw = Split-Path $csc
$refs = @("/r:$fw\netstandard.dll", "/r:$fw\System.Runtime.dll", '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll', '/r:System.Xml.dll', "/r:$lib\CodeWalker.Core.dll", "/r:$lib\SharpDX.Mathematics.dll", "/r:$lib\SharpDX.dll", "/r:$lib\Microsoft.Web.WebView2.Core.dll", "/r:$lib\Microsoft.Web.WebView2.WinForms.dll")
if (-not $Out) { Get-Process MloCreator -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $out } | Stop-Process -Force }
# x64 (WebView2Loader.dll is the 64-bit one), with the icon and the manifest (sharp on a scaled display)
& $csc /nologo /target:winexe /platform:x64 /optimize+ /warn:3 "/win32icon:$here\src\app.ico" "/win32manifest:$here\src\app.manifest" /out:$out $refs $srcs
if ($LASTEXITCODE -ne 0) { throw "compile failed" }
# let the exe load DLLs that Windows still marks as downloaded
$cfg = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup>
  <runtime><loadFromRemoteSources enabled="true"/></runtime>
</configuration>
'@
Set-Content -LiteralPath "$out.config" -Value $cfg -Encoding UTF8
"built $out ($([int]((Get-Item $out).Length / 1KB)) KB)"
