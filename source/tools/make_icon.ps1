# Makes the program's logo from tools\logo-source.png (the black house-and-hammer picture, 400 x 400) and writes
#   src\app.ico     the exe / window icon: the logo on a dark rounded square, PNG frames of 256, 64, 48, 32 and 16 px
#   ui\logo.png     the logo alone on a transparent background (top bar, browser tab)
# The source picture is only a black shape: it is turned into an outline (anything light counts as background, including a
# baked-in transparency checkerboard), the part that holds the roof is drawn in the lighter blue and the rest in the program's blue.
# -Preview <folder> writes the frames there as PNG and touches nothing else.
param([string]$Preview = '', [string]$Png = '')
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $PSScriptRoot 'logo-source.png'
$cNavy = @(15, 26, 48); $cBlue = @(79, 140, 255); $cLight = @(156, 194, 255)   # background, the program's blue (--accent in ui\app.css), lighter blue for the accents

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
public static class LogoMask
{
    // Returns a 32-bit bitmap: alpha from how dark the source is, colour = "accent" for the shape that holds (accX, accY) and "main" for every other shape.
    public static Bitmap Build(string path, int accX, int accY, int[] main, int[] accent)
    {
        using (Bitmap s = new Bitmap(path))
        {
            int w = s.Width, h = s.Height; float[] a = new float[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                Color c = s.GetPixel(x, y); float lum = (c.R + c.G + c.B) / 3f;
                float v = 1f - lum / 226f; if (v < 0.03f) v = 0f; if (v > 1f) v = 1f; a[y * w + x] = v;   // 226: just under the darker squares of the checkerboard
            }
            int[] lab = new int[w * h]; int next = 0, accLab = -1;
            // search the nearest shape pixel to the accent point
            int best = int.MaxValue, bx = accX, by = accY;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (a[y * w + x] > 0.9f) { int d = (x - accX) * (x - accX) + (y - accY) * (y - accY); if (d < best) { best = d; bx = x; by = y; } }
            for (int y0 = 0; y0 < h; y0++) for (int x0 = 0; x0 < w; x0++)
            {
                if (a[y0 * w + x0] <= 0f || lab[y0 * w + x0] != 0) continue;
                next++; Stack<int> st = new Stack<int>(); st.Push(y0 * w + x0); lab[y0 * w + x0] = next;
                while (st.Count > 0)
                {
                    int i = st.Pop(), x = i % w, y = i / w;
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; int j = ny * w + nx;
                        if (a[j] > 0f && lab[j] == 0) { lab[j] = next; st.Push(j); }
                    }
                }
            }
            accLab = lab[by * w + bx];
            Bitmap o = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                float v = a[y * w + x]; if (v <= 0f) { o.SetPixel(x, y, Color.FromArgb(0, 0, 0, 0)); continue; }
                int[] k = lab[y * w + x] == accLab ? accent : main;
                o.SetPixel(x, y, Color.FromArgb((int)Math.Round(v * 255f), k[0], k[1], k[2]));
            }
            return o;
        }
    }
    public static Rectangle Bounds(Bitmap b)
    {
        int x0 = b.Width, y0 = b.Height, x1 = -1, y1 = -1;
        for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++) if (b.GetPixel(x, y).A > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
}
'@ -ReferencedAssemblies System.Drawing

if (-not (Test-Path -LiteralPath $src)) { throw "$src is missing (the black house-and-hammer picture)." }
# the roof line's top (about 200, 62 in the 400 x 400 picture) picks the shape that is drawn in the lighter blue
$logo = [LogoMask]::Build($src, 204, 62, [int[]]$cBlue, [int[]]$cLight)
$box = [LogoMask]::Bounds($logo)

# draws the logo centred in a square of n px, scaled so its longer side is `fill` of n
function Place($g, [int]$n, [double]$fill, [int]$offX, [int]$offY) {
    $k = $n * $fill / [Math]::Max($box.Width, $box.Height); $w = $box.Width * $k; $h = $box.Height * $k
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
    $dst = New-Object System.Drawing.RectangleF([single]($offX + ($n - $w) / 2), [single]($offY + ($n - $h) / 2), [single]$w, [single]$h)
    $g.DrawImage($logo, $dst, (New-Object System.Drawing.RectangleF($box.X, $box.Y, $box.Width, $box.Height)), [System.Drawing.GraphicsUnit]::Pixel)
}
function Frame([int]$n) {
    $bmp = New-Object System.Drawing.Bitmap($n, $n, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
    $s = $n / 256.0; $r = 52 * $s; $d = $r * 2; $w = $n - 1
    $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bg.AddArc(0, 0, $d, $d, 180, 90); $bg.AddArc($w - $d, 0, $d, $d, 270, 90); $bg.AddArc($w - $d, $w - $d, $d, $d, 0, 90); $bg.AddArc(0, $w - $d, $d, $d, 90, 90); $bg.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $cNavy[0], $cNavy[1], $cNavy[2]))), $bg)
    Place $g $n $(if ($n -le 32) { 0.86 } else { 0.74 }) 0 0
    $g.Dispose(); return $bmp
}
function PngBytes($bmp) { $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); return , $ms.ToArray() }

if ($Png) {
    # -Png <folder>: the logo as picture files (transparent logo, and the icon with its dark rounded square), 512 px. The source picture is 400 px, so this is scaled up a little.
    New-Item -ItemType Directory -Force $Png | Out-Null
    $lb = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $lg = [System.Drawing.Graphics]::FromImage($lb); $lg.Clear([System.Drawing.Color]::Transparent); Place $lg 512 0.94 0 0; $lg.Dispose()
    $lb.Save((Join-Path $Png 'MLO Creator logo.png'), [System.Drawing.Imaging.ImageFormat]::Png); $lb.Dispose()
    $ib = Frame 512; $ib.Save((Join-Path $Png 'MLO Creator icon.png'), [System.Drawing.Imaging.ImageFormat]::Png); $ib.Dispose()
    "wrote the logo pictures to $Png"; return
}
if ($Preview) {
    New-Item -ItemType Directory -Force $Preview | Out-Null
    foreach ($n in 256, 48, 32, 16) { $b = Frame $n; $b.Save((Join-Path $Preview ("icon_{0}.png" -f $n)), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose() }
    "preview written to $Preview"; return
}

# ---- app.ico ----
$out = Join-Path $root 'src\app.ico'
$sizes = 256, 64, 48, 32, 16
$frames = @(); foreach ($n in $sizes) { $b = Frame $n; $frames += , (PngBytes $b); $b.Dispose() }
$fs = [System.IO.File]::Create($out); $bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $n = $sizes[$i]; $len = $frames[$i].Length
    $bw.Write([byte]($(if ($n -ge 256) { 0 } else { $n }))); $bw.Write([byte]($(if ($n -ge 256) { 0 } else { $n }))); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$len); $bw.Write([uint32]$offset)
    $offset += $len
}
for ($i = 0; $i -lt $sizes.Count; $i++) { $bw.Write($frames[$i]) }
$bw.Close(); $fs.Close()
"wrote $out ($((Get-Item $out).Length) bytes)"

# ---- ui\logo.png: the logo alone, 128 x 128, transparent ----
$lp = Join-Path $root 'ui\logo.png'
$lb = New-Object System.Drawing.Bitmap(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$lg = [System.Drawing.Graphics]::FromImage($lb); $lg.Clear([System.Drawing.Color]::Transparent); Place $lg 128 0.94 0 0; $lg.Dispose()
$lb.Save($lp, [System.Drawing.Imaging.ImageFormat]::Png); $lb.Dispose()
"wrote $lp ($((Get-Item $lp).Length) bytes)"
