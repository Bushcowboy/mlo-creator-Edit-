# Downloads Microsoft's WebView2 .NET wrapper (the NuGet package Microsoft.Web.WebView2, version below) from nuget.org and puts the three files the program needs into lib\:
# Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll, WebView2Loader.dll (x64). The package itself is deleted again.
param([string]$Version = '1.0.2535.41')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$lib = Join-Path $here 'lib'; New-Item -ItemType Directory -Force $lib | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('webview2-' + [Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $pkg = Join-Path $tmp 'pkg.nupkg'
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$Version" -OutFile $pkg -UseBasicParsing
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $x = Join-Path $tmp 'x'; [IO.Compression.ZipFile]::ExtractToDirectory($pkg, $x)
    Copy-Item "$x\lib\net462\Microsoft.Web.WebView2.Core.dll", "$x\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$x\runtimes\win-x64\native\WebView2Loader.dll" -Destination $lib -Force
    Copy-Item "$x\LICENSE.txt" (Join-Path $lib 'WebView2-LICENSE.txt') -Force
    "WebView2 $Version copied to $lib"
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
