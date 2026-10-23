# Opens every game file of an exported resource with CodeWalker and prints what is in it.
# Usage: powershell -File tools\verify_export.ps1 -Res <exported resource folder>
param([Parameter(Mandatory = $true)][string]$Res)
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib'
Get-ChildItem $lib -Filter *.dll | ForEach-Object { try { [Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {} }
$stream = Join-Path $Res 'stream'
function LoadRes($type, [string]$path, [uint32]$ver) {
    $o = New-Object $type
    $bytes = [IO.File]::ReadAllBytes($path)
    $m = [CodeWalker.GameFiles.RpfFile].GetMethod('LoadResourceFile').MakeGenericMethod([type]$type)
    $m.Invoke($null, [object[]]@($o.psobject.BaseObject, [byte[]]$bytes, $ver)) | Out-Null
    return $o
}
foreach ($f in Get-ChildItem $stream -Filter *.ydr) {
    $d = LoadRes 'CodeWalker.GameFiles.YdrFile' $f.FullName 165
    $dr = $d.Drawable
    $geoms = 0; $tris = 0
    foreach ($mdl in $dr.DrawableModels.High) { foreach ($g in $mdl.Geometries) { $geoms++; $tris += $g.IndicesCount / 3 } }
    $shaders = ($dr.ShaderGroup.Shaders.data_items | ForEach-Object { $_.Name.ToString() }) -join ','
    "{0,-22} ok  geometries={1} triangles={2} shaders={3} lights={4}" -f $f.Name, $geoms, $tris, $shaders, $(if ($dr.LightAttributes) { $dr.LightAttributes.data_items.Count } else { 0 })
}
foreach ($f in Get-ChildItem $stream -Filter *.ybn) {
    $b = LoadRes 'CodeWalker.GameFiles.YbnFile' $f.FullName 43
    $comp = $b.Bounds
    $n = 0; foreach ($c in $comp.Children.data_items) { if ($c.Polygons) { $n += $c.Polygons.Length } }
    "{0,-22} ok  type={1} children={2} polygons={3}" -f $f.Name, $comp.Type, $comp.Children.data_items.Length, $n
}
foreach ($f in Get-ChildItem $stream -Filter *.ytd) {
    $t = LoadRes 'CodeWalker.GameFiles.YtdFile' $f.FullName 13
    $names = ($t.TextureDict.Textures.data_items | ForEach-Object { $_.Name + '(' + $_.Width + ')' }) -join ' '
    "{0,-22} ok  textures={1}" -f $f.Name, $t.TextureDict.Textures.data_items.Count
    "   " + $names
}
foreach ($f in Get-ChildItem $stream -Filter *.ytyp) {
    $y = New-Object CodeWalker.GameFiles.YtypFile; $y.Load([IO.File]::ReadAllBytes($f.FullName))
    "{0,-22} ok  archetypes={1}" -f $f.Name, $y.AllArchetypes.Length
    foreach ($a in $y.AllArchetypes) {
        if ($a -is [CodeWalker.GameFiles.MloArchetype]) {
            "   MLO {0}: entities={1} rooms={2} portals={3}" -f $a.Name, $a.entities.Length, $a.rooms.Length, $a.portals.Length
            foreach ($r in $a.rooms) { "      room '{0}' attached={1}" -f $r._Data.name, ($r.AttachedObjects -join ' ') }
            $i = 0; foreach ($p in $a.portals) { if ($i -lt 3) { "      portal {0}: flags={1} roomFrom={2} roomTo={3} corners={4}" -f $i, $p._Data.flags, $p._Data.roomFrom, $p._Data.roomTo, (($p.Corners | ForEach-Object { '(' + [math]::Round($_.X,2) + ',' + [math]::Round($_.Y,2) + ',' + [math]::Round($_.Z,2) + ')' }) -join '') }; $i++ }
        } else { "   archetype {0}" -f $a.Name }
    }
}
foreach ($f in Get-ChildItem $stream -Filter *.ymap) {
    $m = New-Object CodeWalker.GameFiles.YmapFile; $m.Load([IO.File]::ReadAllBytes($f.FullName))
    $e = $m.AllEntities | Select-Object -First 1
    if ($e) { "{0,-22} ok  entities={1} first={2} pos=({3:N2},{4:N2},{5:N2}) rot=({6:N3},{7:N3},{8:N3},{9:N3})" -f $f.Name, $m.AllEntities.Length, $e.CEntityDef.archetypeName, $e.Position.X, $e.Position.Y, $e.Position.Z, $e.Orientation.X, $e.Orientation.Y, $e.Orientation.Z, $e.Orientation.W }
    else { "{0,-22} ok  box occluders={1} occlude models={2}" -f $f.Name, @($m.BoxOccluders).Count, @($m.OccludeModels).Count }
}
foreach ($f in Get-ChildItem $stream -Filter *.ymf) { "{0,-22} {1} bytes" -f $f.Name, $f.Length }
