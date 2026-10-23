// Cuts the game's own door, window panes, solid collision and occluders out of a vanilla house, so the interior can be entered and seen.
// Driven by the interior's measured openings:
//  - door and window pane triangles in the block model are made degenerate by patching the raw index bytes in place
//  - collision boxes / triangles of the door and everything that fills the walkable interior are deleted from the game's .ybn files
//  - box occluders sitting on the interior are removed from the occlusion .ymap files
// The edited game files are written with their original names into the resource's stream folder. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using CodeWalker.GameFiles;
using SharpDX;

namespace MloCreator
{
    public class PatchOpening { public string O, Type; public double C, U0, U1, Z0, Z1; public int Inward; public bool Entrance; }
    public class PatchInput
    {
        public double Ox, Oy, Oz, Heading, CeilH;
        public List<double[]> Rects = new List<double[]>();            // the interior, local frame (x0, y0, x1, y1)
        public List<PatchOpening> Openings = new List<PatchOpening>();
        public string Gta, CacheDir;
        public bool Doors = true, Windows = true, Collision = true, Occluders = true;
    }

    public static class Patcher
    {
        static double ct, st, ox, oy, oz;
        static double[] Local(double wx, double wy, double wz) { double dx = wx - ox, dy = wy - oy; return new double[] { dx * ct + dy * st, -dx * st + dy * ct, wz - oz }; }

        static int IndexOf(byte[] hay, byte[] needle, int start)
        {
            for (int i = start; i <= hay.Length - needle.Length; i++) { if (hay[i] != needle[0]) continue; int j = 1; while (j < needle.Length && hay[i + j] == needle[j]) j++; if (j == needle.Length) return i; }
            return -1;
        }

        static bool InShrunk(List<double[]> rects, double x, double y, double shrink)
        {
            foreach (double[] r in rects) if (x > r[0] + shrink && x < r[2] - shrink && y > r[1] + shrink && y < r[3] - shrink) return true;
            return false;
        }
        static double OverlapArea(List<double[]> rects, double x0, double y0, double x1, double y1, double shrink)
        {
            double a = 0;
            foreach (double[] r in rects)
            {
                double w = Math.Min(x1, r[2] - shrink) - Math.Max(x0, r[0] + shrink), h = Math.Min(y1, r[3] - shrink) - Math.Max(y0, r[1] + shrink);
                if (w > 0 && h > 0) a += w * h;
            }
            return a;
        }

        public static Dictionary<string, object> Run(PatchInput pi, string streamDir, List<string> log)
        {
            Dictionary<string, object> res = new Dictionary<string, object>(); List<string> files = new List<string>(), warns = new List<string>();
            double th = pi.Heading * Math.PI / 180; ct = Math.Cos(th); st = Math.Sin(th); ox = pi.Ox; oy = pi.Oy; oz = pi.Oz;
            Vanilla.Init(pi.Gta, pi.CacheDir);
            Vanilla.Status = "Looking up the house in the game files...";
            List<EntityHit> hits = Vanilla.FindEntities(pi.Ox, pi.Oy, 220); List<EntityHit> cover = hits.FindAll(delegate (EntityHit h) { return h.Covers; });
            if (cover.Count == 0) { warns.Add("no map piece covers the entrance, so nothing was cut"); res["files"] = files; res["warnings"] = warns; return res; }
            PatchOpening door = pi.Openings.Find(delegate (PatchOpening o) { return o.Entrance; });
            List<PatchOpening> wins = pi.Openings.FindAll(delegate (PatchOpening o) { return o.Type == "window" && !o.Entrance; });
            List<PatchOpening> doors = pi.Openings.FindAll(delegate (PatchOpening o) { return o.Type == "door" || o.Type == "arch"; });
            Directory.CreateDirectory(streamDir);

            // ---------------- 1. render model: door and window pane triangles ----------------
            if (pi.Doors || pi.Windows)
            {
                Vanilla.Status = "Cutting the door and window panes out of the house model...";
                foreach (EntityHit eh in cover)
                {
                    byte[] raw; YdrFile ydr = new YdrFile();
                    try { raw = eh.YdrOwner.ExtractFile(eh.Ydr); ydr.Load(raw, eh.Ydr); } catch (Exception) { continue; }
                    if (ydr.Drawable == null || ydr.Drawable.DrawableModels == null || ydr.Drawable.DrawableModels.High == null) continue;
                    byte[] patched = (byte[])raw.Clone(); int blanked = 0, nDoor = 0, nWin = 0, gi = 0; bool stop = false;
                    foreach (DrawableModel m in ydr.Drawable.DrawableModels.High)
                    {
                        if (m.Geometries == null) continue;
                        foreach (DrawableGeometry g in m.Geometries)
                        {
                            gi++; VertexData vd = g.VertexData; if (vd == null || g.IndexBuffer == null || g.IndexBuffer.Indices == null) continue;
                            int posOff = vd.Info.GetComponentOffset(0), stride = g.VertexStride; byte[] vb = vd.VertexBytes; if (posOff < 0 || stride <= 0) continue;
                            int nv = vb.Length / stride; double sc = eh.Scale.X == 0 ? 1 : eh.Scale.X; double[][] L = new double[nv][];
                            for (int i = 0; i < nv; i++)
                            {
                                int o = i * stride + posOff;
                                Vector3 w = Vector3.Transform(new Vector3(BitConverter.ToSingle(vb, o) * (float)sc, BitConverter.ToSingle(vb, o + 4) * (float)sc, BitConverter.ToSingle(vb, o + 8) * (float)sc), eh.Rot) + eh.Pos;
                                L[i] = Local(w.X, w.Y, w.Z);
                            }
                            ushort[] idx = g.IndexBuffer.Indices; List<int> sel = new List<int>();
                            for (int t = 0; t + 2 < idx.Length; t += 3)
                            {
                                int a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (a == b && b == c) continue; if (a >= nv || b >= nv || c >= nv) continue;
                                double[] p0 = L[a], p1 = L[b], p2 = L[c];
                                double e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2], e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
                                double nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, nl = Math.Sqrt(nx * nx + ny * ny + nz * nz); if (nl < 1e-9) continue;
                                double umin, umax, zmin = Math.Min(p0[2], Math.Min(p1[2], p2[2])), zmax = Math.Max(p0[2], Math.Max(p1[2], p2[2]));
                                bool hit = false;
                                // door: every vertex inside the door's region, vertical surfaces only (the threshold and the porch floor stay)
                                if (pi.Doors && !hit)
                                    foreach (PatchOpening d in doors)
                                    {
                                        if (!d.Entrance) continue; int na = d.O == "H" ? 1 : 0, ua = 1 - na; double outDir = -d.Inward;
                                        double lo = d.C - (d.Inward > 0 ? 0.45 : -0.10), hi = d.C + (d.Inward > 0 ? 0.10 : -0.45); if (lo > hi) { double q = lo; lo = hi; hi = q; }
                                        bool ok = Math.Abs(nz / nl) < 0.7;
                                        foreach (double[] p in new double[][] { p0, p1, p2 }) { if (p[ua] < d.U0 - 0.10 || p[ua] > d.U1 + 0.10 || p[na] < lo || p[na] > hi || p[2] < -0.12 || p[2] > Math.Max(d.Z1, 2.1) + 0.28) { ok = false; break; } }
                                        if (ok) { hit = true; nDoor++; }
                                    }
                                // window panes: a big flat quad facing the wall, lying in the window opening a few cm behind the wall face
                                if (pi.Windows && !hit)
                                    foreach (PatchOpening w in wins)
                                    {
                                        int na = w.O == "H" ? 1 : 0, ua = 1 - na; double nn = (na == 0 ? nx : ny) / nl; if (Math.Abs(nn) < 0.9990) continue;
                                        double n0 = (p0[na] + p1[na] + p2[na]) / 3; if (Math.Abs(n0 - (w.C - w.Inward * 0.14)) > 0.30) continue;
                                        umin = Math.Min(p0[ua], Math.Min(p1[ua], p2[ua])); umax = Math.Max(p0[ua], Math.Max(p1[ua], p2[ua]));
                                        if (umax - umin < 0.20 || zmax - zmin < 0.20) continue;                       // glass is a big quad; stiles, rails and dividers are thin strips and stay
                                        if (umin < w.U0 - 0.12 || umax > w.U1 + 0.12 || zmin < w.Z0 - 0.12 || zmax > w.Z1 + 0.12) continue;
                                        hit = true; nWin++; break;
                                    }
                                if (hit) sel.Add(t);
                            }
                            if (sel.Count == 0) continue;
                            // find this geometry's index array in the raw resource: unique, complete match required
                            int plen = Math.Min(48, idx.Length); byte[] pattern = new byte[plen * 2]; for (int i = 0; i < plen; i++) { byte[] pb = BitConverter.GetBytes(idx[i]); pattern[2 * i] = pb[0]; pattern[2 * i + 1] = pb[1]; }
                            // every complete copy of this index array in the file gets the same edit (a geometry can share its indices with another level of detail)
                            List<int> copies = new List<int>(); int from = 0;
                            while (true)
                            {
                                int q = IndexOf(raw, pattern, from); if (q < 0) break; from = q + 2;
                                if (q + idx.Length * 2 > raw.Length) continue;
                                bool full = true; for (int i = 0; i < idx.Length; i++) { byte[] pb = BitConverter.GetBytes(idx[i]); if (raw[q + 2 * i] != pb[0] || raw[q + 2 * i + 1] != pb[1]) { full = false; break; } }
                                if (full) copies.Add(q);
                            }
                            if (copies.Count == 0) { warns.Add(eh.Name + " geometry " + gi + ": the index array could not be located, " + sel.Count + " triangles left in place"); continue; }
                            foreach (int pos in copies) foreach (int t in sel) { byte[] first = BitConverter.GetBytes(idx[t]); for (int k = 1; k <= 2; k++) { patched[pos + 2 * (t + k)] = first[0]; patched[pos + 2 * (t + k) + 1] = first[1]; } }
                            if (copies.Count > 1) log.Add(eh.Name + " geometry " + gi + ": its index data appears " + copies.Count + " times in the file, all copies edited");
                            blanked += sel.Count;
                        }
                        if (stop) break;
                    }
                    if (blanked > 0)
                    {
                        RpfResourceFileEntry rre = eh.Ydr as RpfResourceFileEntry; if (rre == null) { warns.Add(eh.Name + " is not a resource entry; not written"); continue; }
                        byte[] comp = ResourceBuilder.Compress(patched); byte[] file = ResourceBuilder.AddResourceHeader(rre, comp);
                        File.WriteAllBytes(Path.Combine(streamDir, eh.Ydr.Name), file);
                        files.Add(eh.Ydr.Name + ": " + nDoor + " door and " + nWin + " window-pane triangles blanked");
                        log.Add("model " + eh.Ydr.Name + ": " + nDoor + " door triangles, " + nWin + " window pane triangles blanked");
                    }
                }
            }

            // ---------------- 2. collision ----------------
            if (pi.Collision)
            {
                Vanilla.Status = "Cutting the door and the solid blocks out of the game's collision...";
                HashSet<string> owners = new HashSet<string>(); List<RpfFile> ownerList = new List<RpfFile>();
                foreach (EntityHit eh in cover) if (owners.Add(eh.YdrOwner.Path)) ownerList.Add(eh.YdrOwner);
                double[] bb = new double[] { 1e9, 1e9, -1e9, -1e9 }; foreach (double[] r in pi.Rects) { bb[0] = Math.Min(bb[0], r[0]); bb[1] = Math.Min(bb[1], r[1]); bb[2] = Math.Max(bb[2], r[2]); bb[3] = Math.Max(bb[3], r[3]); }
                double[] cx = new double[] { Local2W(bb[0], bb[1])[0], Local2W(bb[2], bb[1])[0], Local2W(bb[0], bb[3])[0], Local2W(bb[2], bb[3])[0] }, cy = new double[] { Local2W(bb[0], bb[1])[1], Local2W(bb[2], bb[1])[1], Local2W(bb[0], bb[3])[1], Local2W(bb[2], bb[3])[1] };
                double wx0 = 1e9, wx1 = -1e9, wy0 = 1e9, wy1 = -1e9; for (int i = 0; i < 4; i++) { wx0 = Math.Min(wx0, cx[i]); wx1 = Math.Max(wx1, cx[i]); wy0 = Math.Min(wy0, cy[i]); wy1 = Math.Max(wy1, cy[i]); }
                PatchOpening ent = door;
                foreach (RpfFile rf in ownerList)
                {
                    foreach (RpfEntry e in rf.AllEntries)
                    {
                        RpfFileEntry fe = e as RpfFileEntry; if (fe == null || !fe.Name.EndsWith(".ybn", StringComparison.OrdinalIgnoreCase)) continue;
                        string lk = fe.Name.ToLowerInvariant(); RpfFile ao; RpfFileEntry active = Vanilla.GetEntry(lk, out ao); if (active == null) continue;
                        byte[] raw; YbnFile ybn = new YbnFile();
                        try { raw = ao.ExtractFile(active); ybn.Load(raw, active); } catch (Exception) { continue; }
                        Bounds root = ybn.Bounds; BoundComposite comp = root as BoundComposite; if (comp == null || comp.Children == null) continue;
                        if (root.BoxMax.X < wx0 - 1 || root.BoxMin.X > wx1 + 1 || root.BoxMax.Y < wy0 - 1 || root.BoxMin.Y > wy1 + 1) continue;
                        int removed = 0, nDoorBox = 0, nSolid = 0;
                        foreach (Bounds child in comp.Children.data_items)
                        {
                            BoundGeometry geo = child as BoundGeometry; if (geo == null || geo.Polygons == null) continue;
                            if (child.BoxMax.X < wx0 - 1 || child.BoxMin.X > wx1 + 1 || child.BoxMax.Y < wy0 - 1 || child.BoxMin.Y > wy1 + 1) continue;
                            List<BoundPolygon> kill = new List<BoundPolygon>();
                            foreach (BoundPolygon p in geo.Polygons)
                            {
                                BoundPolygonBox bx = p as BoundPolygonBox; BoundPolygonTriangle tr = p as BoundPolygonTriangle; if (bx == null && tr == null) continue;
                                Vector3[] vp = p.VertexPositions; if (vp == null) continue;
                                double mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
                                // an oriented box is stored as 4 alternating corners; its 8 corners are centre +- the three half edges
                                List<double[]> pts = new List<double[]>();
                                if (bx != null)
                                {
                                    double[][] c4 = new double[4][]; for (int i = 0; i < 4; i++) c4[i] = Local(vp[i].X, vp[i].Y, vp[i].Z);
                                    double[] cen = new double[3]; for (int a = 0; a < 3; a++) cen[a] = (c4[0][a] + c4[1][a] + c4[2][a] + c4[3][a]) / 4;
                                    double[][] sg = new double[][] { new double[] { 1, 1, -1, -1 }, new double[] { 1, -1, 1, -1 }, new double[] { 1, -1, -1, 1 } }; double[][] ee = new double[3][];
                                    for (int k = 0; k < 3; k++) { ee[k] = new double[3]; for (int a = 0; a < 3; a++) ee[k][a] = (sg[k][0] * c4[0][a] + sg[k][1] * c4[1][a] + sg[k][2] * c4[2][a] + sg[k][3] * c4[3][a]) / 4; }
                                    for (int s = 0; s < 8; s++) { double[] q = new double[3]; for (int a = 0; a < 3; a++) q[a] = cen[a] + ((s & 1) == 0 ? 1 : -1) * ee[0][a] + ((s & 2) == 0 ? 1 : -1) * ee[1][a] + ((s & 4) == 0 ? 1 : -1) * ee[2][a]; pts.Add(q); }
                                }
                                else for (int i = 0; i < 3; i++) pts.Add(Local(vp[i].X, vp[i].Y, vp[i].Z));
                                foreach (double[] q in pts) { mnx = Math.Min(mnx, q[0]); mxx = Math.Max(mxx, q[0]); mny = Math.Min(mny, q[1]); mxy = Math.Max(mxy, q[1]); mnz = Math.Min(mnz, q[2]); mxz = Math.Max(mxz, q[2]); }
                                bool doorBox = false;
                                if (bx != null && ent != null)
                                {
                                    int na = ent.O == "H" ? 1 : 0, ua = 1 - na; double[] mn = new double[] { mnx, mny }, mx = new double[] { mxx, mxy };
                                    double lo = ent.C - (ent.Inward > 0 ? 0.55 : -0.12), hi = ent.C + (ent.Inward > 0 ? 0.12 : -0.55); if (lo > hi) { double q2 = lo; lo = hi; hi = q2; }
                                    doorBox = mn[ua] >= ent.U0 - 0.14 && mx[ua] <= ent.U1 + 0.14 && mn[na] >= lo && mx[na] <= hi && mnz >= -0.2 && mxz <= 2.5 && Math.Min(mx[na] - mn[na], 0.5) < 0.45;
                                }
                                // everything that fills the walkable interior: overlaps the room (shrunk 12 cm so the walls and window frames at its edge stay) at standing height
                                bool blocks = false;
                                if (!doorBox && mxz > 0.15 && mnz < pi.CeilH - 0.1)
                                {
                                    if (bx != null) { blocks = OverlapArea(pi.Rects, mnx, mny, mxx, mxy, 0.12) > 0.05; }
                                    else
                                    {
                                        double gx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, gy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3, gz = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
                                        double ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], uz = pts[1][2] - pts[0][2], vx = pts[2][0] - pts[0][0], vy = pts[2][1] - pts[0][1], vz = pts[2][2] - pts[0][2];
                                        double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                                        blocks = nl > 1e-9 && Math.Abs(nz / nl) < 0.9 && gz > 0.15 && gz < pi.CeilH - 0.1 && InShrunk(pi.Rects, gx, gy, 0.12);
                                    }
                                }
                                if (doorBox) { kill.Add(p); nDoorBox++; } else if (blocks) { kill.Add(p); nSolid++; }
                            }
                            if (kill.Count == 0) continue;
                            foreach (BoundPolygon p in kill) geo.DeletePolygon(p);
                            BoundBVH bvh = child as BoundBVH; if (bvh != null) bvh.BuildBVH(false);
                            removed += kill.Count;
                        }
                        if (removed > 0)
                        {
                            try { comp.UpdateChildrenBounds(); } catch (Exception) { }
                            byte[] outb = ybn.Save(); File.WriteAllBytes(Path.Combine(streamDir, fe.Name), outb);
                            files.Add(fe.Name + ": " + nDoorBox + " door and " + nSolid + " interior-blocking collision polygons removed");
                            log.Add("collision " + fe.Name + ": " + nDoorBox + " door boxes, " + nSolid + " blocking polygons removed");
                        }
                    }
                }
            }

            // ---------------- 3. occluders ----------------
            if (pi.Occluders)
            {
                Vanilla.Status = "Removing the occluders that hide the interior...";
                foreach (string lk in Vanilla.Names(".ymap"))
                {
                    if (lk.IndexOf("occl", StringComparison.Ordinal) < 0) continue;
                    RpfFile ao; RpfFileEntry fe = Vanilla.GetEntry(lk, out ao);
                    try
                    {
                        byte[] data = ao.ExtractFile(fe); YmapFile y = new YmapFile(); y.Load(data, fe);
                        if (y.BoxOccluders == null || y.BoxOccluders.Length == 0) continue;
                        List<YmapBoxOccluder> kill = new List<YmapBoxOccluder>();
                        foreach (YmapBoxOccluder o in y.BoxOccluders) { double[] l = Local(o.Position.X, o.Position.Y, o.Position.Z); if (InShrunk(pi.Rects, l[0], l[1], -0.5)) kill.Add(o); }
                        if (kill.Count == 0) continue;
                        foreach (YmapBoxOccluder o in kill) y.RemoveBoxOccluder(o);
                        y.Name = fe.Name; byte[] outb = y.Save(); File.WriteAllBytes(Path.Combine(streamDir, fe.Name), outb);
                        files.Add(fe.Name + ": " + kill.Count + " occluder(s) removed"); log.Add("occluders " + fe.Name + ": " + kill.Count + " removed");
                    }
                    catch (Exception) { }
                }
            }
            Vanilla.Status = "";
            res["files"] = files; res["warnings"] = warns; return res;
        }

        static double[] Local2W(double lx, double ly) { return new double[] { ox + lx * ct - ly * st, oy + lx * st + ly * ct }; }
    }
}
