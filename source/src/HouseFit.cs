// Fits a grabbed vanilla house: wall direction (frame heading), interior outline from the collision shell, door and window candidates.
// Everything is returned in the house frame: origin on the floor at the entrance door, local +Y pointing into the house. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using CodeWalker.GameFiles;
using SharpDX;

namespace MloCreator
{
    public static class HouseFit
    {
        const double RES = 0.05;
        const double GX0 = -18, GY0 = -10; const int GW = 720, GH = 720;

        public static List<double[]> ExtraStarts = new List<double[]>();
        static string B64(float[] f) { byte[] b = new byte[f.Length * 4]; Buffer.BlockCopy(f, 0, b, 0, b.Length); return Convert.ToBase64String(b); }

        public class Box3 { public double[] C = new double[3], E1 = new double[3], E2 = new double[3], E3 = new double[3]; public double X0, X1, Y0, Y1, Z0, Z1; public bool Hi; }
        class Seg { public double X1, Y1, X2, Y2; }

        // ---------- main entry ----------
        public static Dictionary<string, object> Grab(double px, double py, double pz, double heading, string facing, double pedOffset, string gtaPath, string cacheDir)
        {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            List<string> log = new List<string>();
            Vanilla.Init(gtaPath, cacheDir); log.Add("game archives ready (" + sw.Elapsed.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture) + " s)");
            List<EntityHit> hits = Vanilla.FindEntities(px, py, 220);
            List<EntityHit> covering = hits.FindAll(delegate (EntityHit h) { return h.Covers; });
            if (covering.Count == 0) throw new Exception("No building model covers this spot. Stand right at the door of the house and send the coordinates again.");
            StringBuilder cn = new StringBuilder(); foreach (EntityHit h in covering) cn.Append(h.Name).Append(' ');
            log.Add("map pieces under the spot: " + cn.ToString().Trim() + " (" + sw.Elapsed.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture) + " s)");

            double floorGuess = pz - pedOffset;
            double[] win = new double[] { px - 20, px + 20, py - 20, py + 20, floorGuess - 3, floorGuess + 12 };
            List<ColPoly> polys = new List<ColPoly>(); List<string> ybnUsed = new List<string>();
            Vanilla.Status = "Reading the collision around the door...";
            Vanilla.ExtractCollision(hits, win, polys, ybnUsed);
            if (polys.Count == 0) throw new Exception("No collision files were found around this spot.");
            log.Add("collision: " + string.Join(", ", ybnUsed.ToArray()));
            List<RefGroup> groups = new List<RefGroup>(); List<RefTri> rtris = new List<RefTri>();
            Vanilla.Status = "Reading the house model...";
            Vanilla.ExtractGeometry(hits, new double[] { px - 19, px + 19, py - 19, py + 19, floorGuess - 3, floorGuess + 11 }, groups, rtris);
            log.Add("reference triangles: " + rtris.Count + " in " + groups.Count + " material groups (" + sw.Elapsed.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture) + " s)");

            // ----- pass 1: provisional frame = the way the player faced; find the rooms, then fit the real wall direction from the walls around them -----
            bool anyHi = polys.Exists(delegate (ColPoly c) { return c.Hi && c.Kind == 0; });
            double hh = heading + (facing == "out" ? 180 : 0); hh = ((hh % 360) + 360) % 360;
            double theta = hh;
            Analysis an = Analyze(polys, anyHi, floorGuess, px, py, theta);
            if (an.Union != null)
            {
                double dev = BoundaryAngle(an);
                if (Math.Abs(dev) > 0.1) { theta = ((theta + dev) % 360 + 360) % 360; an = Analyze(polys, anyHi, floorGuess, px, py, theta); }
                log.Add("walls around the interior run " + dev.ToString("0.00", CultureInfo.InvariantCulture) + " deg off the way you faced; frame heading " + theta.ToString("0.00", CultureInfo.InvariantCulture) + " (you faced " + hh.ToString("0.0", CultureInfo.InvariantCulture) + ")");
            }
            else log.Add("interior NOT found automatically; frame heading stays " + theta.ToString("0.00", CultureInfo.InvariantCulture));
            double phi = ((theta % 90) + 90) % 90;
            double ct = Math.Cos(theta * Math.PI / 180), st = Math.Sin(theta * Math.PI / 180);
            Func<double, double, double> LX = delegate (double wx, double wy) { return (wx - px) * ct + (wy - py) * st; };
            Func<double, double, double> LY = delegate (double wx, double wy) { return -(wx - px) * st + (wy - py) * ct; };
            List<Box3> lboxes = an.Lboxes; List<double[]> ltris = an.Ltris; string why = an.Why;
            log.Add("rooms: " + an.Why);
            foreach (RegionInfo ri in an.Regions) log.Add((ri.Main ? "main interior " : "extra enclosed space ") + (ri.Cells * RES * RES).ToString("0.0", CultureInfo.InvariantCulture) + " m2, " + ri.Poly.Count + " corners, " + ri.Near.ToString("0.0", CultureInfo.InvariantCulture) + " m from the door spot");
            try { DebugPng(an, System.IO.Path.Combine(cacheDir, "last_grab.png")); } catch (Exception) { }

            // ----- entrance: the outline edge in front of the player (interior on its +y side), then move the origin onto it -----
            double cx = 0, ey = 0; int doorPoly = -1, doorEdge = -1; double doorW = 1.1;
            {
                double bestD = 1e9;
                for (int pi = 0; pi < an.Regions.Count; pi++)
                {
                    List<double[]> outline = an.Regions[pi].Poly;
                    for (int i = 0; i < outline.Count; i++)
                    {
                        double[] a = outline[i], b = outline[(i + 1) % outline.Count];
                        if (Math.Abs(a[1] - b[1]) > 1e-6 || b[0] <= a[0]) continue;       // horizontal, running towards +x: counter-clockwise, so the interior is above it
                        double lo = a[0], hi = b[0]; double dx = 0 < lo ? lo : (0 > hi ? 0 - hi : 0);
                        double dy = a[1]; if (dy < -1.0) continue; double d = dx * 3 + Math.Abs(dy);
                        if (d < bestD) { bestD = d; doorPoly = pi; doorEdge = i; }
                    }
                }
                if (doorPoly >= 0)
                {
                    List<double[]> outline = an.Regions[doorPoly].Poly; double[] a = outline[doorEdge], b = outline[(doorEdge + 1) % outline.Count]; ey = a[1];
                    // the door leaf: tall thin boxes lying on that wall line, starting from the one nearest the player's x
                    List<Box3> cand = new List<Box3>();
                    foreach (Box3 bx in lboxes)
                    {
                        if (bx.Z0 > 0.25 || bx.Z0 < -0.2 || bx.Z1 < 2.0 || bx.Z1 > 2.6) continue; if (Math.Abs((bx.Y0 + bx.Y1) / 2 - ey) > 0.45 || (bx.Y1 - bx.Y0) > 0.4) continue;
                        if (bx.X1 < a[0] - 0.1 || bx.X0 > b[0] + 0.1 || bx.X1 < -2.4 || bx.X0 > 2.4) continue; cand.Add(bx);
                    }
                    Box3 seed = null; double sd = 1e9; foreach (Box3 bx in cand) { double d = (bx.X0 <= 0 && bx.X1 >= 0) ? 0 : Math.Min(Math.Abs(bx.X0), Math.Abs(bx.X1)); if (d < sd) { sd = d; seed = bx; } }
                    bool found = false;
                    if (seed != null)
                    {
                        double dx0 = seed.X0, dx1 = seed.X1; bool grew = true;
                        while (grew) { grew = false; foreach (Box3 bx in cand) { if (bx.X0 < dx0 - 0.02 && bx.X1 >= dx0 - 0.15) { dx0 = bx.X0; grew = true; } if (bx.X1 > dx1 + 0.02 && bx.X0 <= dx1 + 0.15) { dx1 = bx.X1; grew = true; } } }
                        if (dx1 - dx0 > 0.6 && dx1 - dx0 < 2.4) { cx = (dx0 + dx1) / 2; doorW = Math.Min(dx1 - dx0, 1.32); found = true; }     // wider clusters include the posts beside the door
                    }
                    log.Add("entrance door: " + (found ? doorW.ToString("0.00", CultureInfo.InvariantCulture) + " m wide, read from the door's collision" : "not seen in collision, " + doorW.ToString("0.0", CultureInfo.InvariantCulture) + " m assumed"));
                }
                else log.Add("entrance door: no wall found in front of you");
            }

            // shift so the entrance centre is the origin
            Func<double, double> SX = delegate (double x) { return x - cx; }; Func<double, double> SY = delegate (double y) { return y - ey; };
            List<object> regionsJson = new List<object>(); List<List<double[]>> polysS = new List<List<double[]>>();
            foreach (RegionInfo ri in an.Regions)
            {
                List<double[]> ps = new List<double[]>(); foreach (double[] p in ri.Poly) ps.Add(new double[] { SX(p[0]), SY(p[1]) }); polysS.Add(ps);
                Dictionary<string, object> rj = new Dictionary<string, object>(); rj["poly"] = ps; rj["rects"] = PolyRects(ps); rj["area"] = ri.Cells * RES * RES; rj["main"] = ri.Main; rj["near"] = ri.Near; regionsJson.Add(rj);
            }
            List<Box3> sb = new List<Box3>();
            foreach (Box3 b in lboxes) { if (!b.Hi) continue; Box3 n = new Box3(); n.X0 = SX(b.X0); n.X1 = SX(b.X1); n.Y0 = SY(b.Y0); n.Y1 = SY(b.Y1); n.Z0 = b.Z0; n.Z1 = b.Z1; n.Hi = true; sb.Add(n); }
            List<object> windows = WindowCandidates(polysS, sb);
            log.Add("window and door candidates: " + windows.Count);

            // ----- build the JSON -----
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            double ox = px + cx * ct - ey * st, oy = py + cx * st + ey * ct;
            Dictionary<string, object> frame = new Dictionary<string, object>();
            frame["ox"] = ox; frame["oy"] = oy; frame["oz"] = floorGuess; frame["heading"] = theta; frame["phi"] = phi; frame["door"] = new double[] { px, py, pz, heading };
            res["frame"] = frame;
            res["regions"] = regionsJson;
            Dictionary<string, object> dr = new Dictionary<string, object>(); dr["width"] = doorW; dr["height"] = 2.2; dr["found"] = doorPoly >= 0; res["door"] = dr;
            res["windows"] = windows;
            // reference triangles, grouped
            List<object> gl = new List<object>();
            for (int gi = 0; gi < groups.Count; gi++)
            {
                List<float> f = new List<float>();
                foreach (RefTri t in rtris)
                {
                    if (t.Group != gi) continue;
                    for (int j = 0; j < 3; j++) { double wx = t.P[j * 3], wy = t.P[j * 3 + 1], wz = t.P[j * 3 + 2]; f.Add((float)SX(LX(wx, wy))); f.Add((float)SY(LY(wx, wy))); f.Add((float)(wz - floorGuess)); }
                }
                if (f.Count == 0) continue;
                Dictionary<string, object> g = new Dictionary<string, object>(); g["entity"] = groups[gi].Entity; g["texture"] = groups[gi].Texture; g["color"] = new double[] { groups[gi].Color[0], groups[gi].Color[1], groups[gi].Color[2] }; g["pos"] = B64(f.ToArray()); gl.Add(g);
            }
            res["ref"] = gl;
            // collision: triangles (only the high-detail shell if present) and boxes
            List<float> ct2 = new List<float>(), cb = new List<float>();
            foreach (double[] t in ltris) { if (anyHi && t[9] < 0.5) continue; for (int j = 0; j < 3; j++) { ct2.Add((float)SX(t[j * 3])); ct2.Add((float)SY(t[j * 3 + 1])); ct2.Add((float)t[j * 3 + 2]); } }
            foreach (Box3 b in lboxes) { cb.Add((float)SX(b.X0)); cb.Add((float)SY(b.Y0)); cb.Add((float)b.Z0); cb.Add((float)SX(b.X1)); cb.Add((float)SY(b.Y1)); cb.Add((float)b.Z1); }
            Dictionary<string, object> col = new Dictionary<string, object>(); col["tris"] = B64(ct2.ToArray()); col["boxes"] = B64(cb.ToArray()); res["collision"] = col;
            Dictionary<string, object> info = new Dictionary<string, object>();
            info["covering"] = covering.ConvertAll<string>(delegate (EntityHit h) { return h.Name + " @ " + h.Pos.X.ToString("0.00", CultureInfo.InvariantCulture) + ", " + h.Pos.Y.ToString("0.00", CultureInfo.InvariantCulture); });
            info["collisionFiles"] = ybnUsed; info["log"] = log; info["seconds"] = sw.Elapsed.TotalSeconds; info["outlineFound"] = an.Regions.Count > 0; info["why"] = why;
            res["info"] = info;
            Vanilla.Status = "";
            return res;
        }

        // rectilinear polygon -> rectangles (compressed grid, rows merged)
        static List<double[]> PolyRects(List<double[]> poly)
        {
            List<double> xs = new List<double>(), ys = new List<double>();
            foreach (double[] p in poly) { if (!xs.Exists(delegate (double v) { return Math.Abs(v - p[0]) < 1e-6; })) xs.Add(p[0]); if (!ys.Exists(delegate (double v) { return Math.Abs(v - p[1]) < 1e-6; })) ys.Add(p[1]); }
            xs.Sort(); ys.Sort(); int nx = Math.Max(xs.Count - 1, 0), ny = Math.Max(ys.Count - 1, 0); bool[,] ins = new bool[nx, ny];
            for (int i = 0; i < nx; i++) for (int j = 0; j < ny; j++)
                {
                    double mx = (xs[i] + xs[i + 1]) / 2, my = (ys[j] + ys[j + 1]) / 2; bool inside = false;
                    for (int k = 0, m = poly.Count - 1; k < poly.Count; m = k++)
                        if (((poly[k][1] > my) != (poly[m][1] > my)) && (mx < (poly[m][0] - poly[k][0]) * (my - poly[k][1]) / (poly[m][1] - poly[k][1]) + poly[k][0])) inside = !inside;
                    ins[i, j] = inside;
                }
            List<double[]> rects = new List<double[]>(); bool[,] used = new bool[nx, ny];
            for (int j = 0; j < ny; j++) for (int i = 0; i < nx; i++)
                {
                    if (!ins[i, j] || used[i, j]) continue;
                    int i1 = i + 1; while (i1 < nx && ins[i1, j] && !used[i1, j]) i1++;
                    int j1 = j + 1; for (; j1 < ny; j1++) { bool ok = true; for (int x = i; x < i1; x++) if (!ins[x, j1] || used[x, j1]) { ok = false; break; } if (!ok) break; }
                    for (int x = i; x < i1; x++) for (int y = j; y < j1; y++) used[x, y] = true;
                    rects.Add(new double[] { xs[i], ys[j], xs[i1], ys[j1] });
                }
            return rects;
        }

        // ---------- one fitting pass in a given frame ----------
        class Analysis
        {
            public bool[] Solid, Union; public List<Seg> Segs = new List<Seg>(); public List<double[]> Ltris = new List<double[]>(); public List<Box3> Lboxes = new List<Box3>();
            public string Why = ""; public bool[] DebugLeak; public List<RegionInfo> Regions = new List<RegionInfo>();
        }
        class RegionInfo { public bool[] Mask; public int Cells; public double Near; public bool Main; public List<double[]> Poly; }

        static Analysis Analyze(List<ColPoly> polys, bool anyHi, double floorGuess, double px, double py, double theta)
        {
            Analysis an = new Analysis();
            double ct = Math.Cos(theta * Math.PI / 180), st = Math.Sin(theta * Math.PI / 180);
            Func<double, double, double[]> toLocal = delegate (double wx, double wy) { return new double[] { (wx - px) * ct + (wy - py) * st, -(wx - px) * st + (wy - py) * ct }; };
            foreach (ColPoly c in polys)
            {
                if (c.Kind == 0)
                {
                    double[] L = new double[10];
                    for (int i = 0; i < 3; i++) { double[] xy = toLocal(c.P[i * 3], c.P[i * 3 + 1]); L[i * 3] = xy[0]; L[i * 3 + 1] = xy[1]; L[i * 3 + 2] = c.P[i * 3 + 2] - floorGuess; }
                    L[9] = c.Hi ? 1 : 0; an.Ltris.Add(L);
                }
                else { Box3 b = MakeBox(c.P, toLocal, floorGuess); b.Hi = c.Hi; an.Lboxes.Add(b); }
            }
            bool[] obst = new bool[GW * GH];
            foreach (double[] t in an.Ltris)
            {
                double nx = (t[4] - t[1]) * (t[8] - t[2]) - (t[5] - t[2]) * (t[7] - t[1]), ny = (t[5] - t[2]) * (t[6] - t[0]) - (t[3] - t[0]) * (t[8] - t[2]), nz = (t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0]);
                double nl = Math.Sqrt(nx * nx + ny * ny + nz * nz); if (nl < 1e-9 || Math.Abs(nz / nl) > 0.35) continue;      // steep surfaces only
                if (anyHi && t[9] < 0.5) continue;
                foreach (double zr in new double[] { 0.7, 1.0, 1.4, 1.8, 2.1 })
                {
                    Seg s = SliceTri(t, zr); if (s == null) continue; DrawLine(obst, s.X1, s.Y1, s.X2, s.Y2);
                    if (zr == 1.4) an.Segs.Add(s);
                }
            }
            // the door leaf is made of boxes: tall thin boxes right next to the standing spot close the doorway
            foreach (Box3 b in an.Lboxes)
            {
                if (b.Z0 > 0.5 || b.Z1 < 1.9 || Math.Min(b.X1 - b.X0, b.Y1 - b.Y0) > 0.45 || Math.Max(b.X1 - b.X0, b.Y1 - b.Y0) > 2.6) continue;
                double cxm = (b.X0 + b.X1) / 2, cym = (b.Y0 + b.Y1) / 2; if (Math.Abs(cxm) > 2.4 || cym < -0.5 || cym > 4) continue;
                FillRect(obst, b.X0, b.Y0, b.X1, b.Y1);
            }
            bool[] obstAll = (bool[])obst.Clone();
            foreach (Box3 b in an.Lboxes)
            {
                if (b.Z1 < 0.5 || b.Z0 > 2.2) continue; double w = b.X1 - b.X0, h = b.Y1 - b.Y0; if (Math.Min(w, h) > 0.8 || Math.Max(w, h) > 9) continue;
                FillRect(obstAll, b.X0, b.Y0, b.X1, b.Y1);
            }
            bool[][] layers = new bool[][] { Dilate(obst), Dilate(obstAll) };
            for (int li = 0; li < layers.Length && an.Union == null; li++)
            {
                an.Solid = layers[li];
                PickRegion(an, li == 0 ? "shell only" : "shell and boxes");
            }
            return an;
        }

        // find every enclosed room near the door and keep the best one (not the yard the player stands in, not a closet)
        static void PickRegion(Analysis an, string label)
        {
            bool[] solid = an.Solid; bool[] visited = new bool[solid.Length];
            int oi = (int)Math.Floor((0 - GX0) / RES), oj = (int)Math.Floor((0 - GY0) / RES);
            List<double[]> starts = new List<double[]>(ExtraStarts);
            for (double y = -5; y <= 17; y += 0.8) for (double x = -14; x <= 14; x += 0.8) starts.Add(new double[] { x, y });
            double bestScore = 0; int bestIdx = -1; int tried = 0, leaks = 0, small = 0;
            List<RegionInfo> found = new List<RegionInfo>();
            foreach (double[] sp in starts)
            {
                int si = (int)Math.Floor((sp[0] - GX0) / RES), sj = (int)Math.Floor((sp[1] - GY0) / RES);
                if (si < 1 || sj < 1 || si >= GW - 1 || sj >= GH - 1) continue; int ci = sj * GW + si;
                if (solid[ci] || visited[ci]) continue;
                int area; bool leak; bool[] r = Flood(solid, si, sj, out area, out leak); tried++;
                for (int k = 0; k < r.Length; k++) if (r[k]) visited[k] = true;
                if (leak) { leaks++; if (an.DebugLeak == null) an.DebugLeak = r; continue; }
                double a = area * RES * RES; if (a < 1.5 || a > 400) { small++; continue; }
                if (r[oj * GW + oi]) continue;                                           // the player stands in this one: it is the yard, not the house
                // how close does the room come to the door spot?
                double near = 1e9;
                for (int j = Math.Max(1, oj - 70); j < Math.Min(GH - 1, oj + 100); j++) for (int i = Math.Max(1, oi - 70); i < Math.Min(GW - 1, oi + 70); i++)
                    {
                        if (!r[j * GW + i]) continue; double dx = (i - oi) * RES, dy = (j - oj) * RES; double d = Math.Sqrt(dx * dx + dy * dy); if (d < near) near = d;
                    }
                RegionInfo ri = new RegionInfo(); ri.Mask = r; ri.Cells = area; ri.Near = near; found.Add(ri);
                if (a < 8 || near > 3.0) continue;
                double score = a - near * 6;
                if (ExtraStarts.Count > 0 && Math.Abs(sp[0] - ExtraStarts[0][0]) < 1e-9 && Math.Abs(sp[1] - ExtraStarts[0][1]) < 1e-9) score += 1000;
                if (score > bestScore) { bestScore = score; bestIdx = found.Count - 1; }
            }
            an.Why += label + ": " + tried + " rooms tried, " + leaks + " leak, " + small + " too small/large; ";
            if (bestIdx < 0) return;
            // the main interior, plus every other enclosed space right next to the door (the porch or annex the door really opens into)
            bool[] union = new bool[solid.Length];
            for (int k = 0; k < found.Count; k++)
            {
                RegionInfo ri = found[k]; bool main = k == bestIdx;
                if (!main && ri.Near > 2.0) continue;
                ri.Mask = OpenMask(ri.Mask, 3);                                           // drop slivers narrower than about 30 cm (gaps between two walls)
                int cells = 0; for (int q = 0; q < ri.Mask.Length; q++) if (ri.Mask[q]) cells++;
                if (cells * RES * RES < 1.0) continue; ri.Cells = cells;
                ri.Main = main; ri.Poly = TraceOutline(ri.Mask); if (ri.Poly.Count < 4) continue;
                an.Regions.Add(ri); for (int q = 0; q < union.Length; q++) if (ri.Mask[q]) union[q] = true;
            }
            an.Union = union;
        }

        // morphological opening with a (2r+1) cell square: erode, then grow back. Rectangles survive, thin slivers do not.
        static bool[] OpenMask(bool[] m, int r)
        {
            return Dilate1(Erode1(m, r), r);
        }
        static bool[] Erode1(bool[] m, int r)
        {
            // a cell stays if every cell in its square window is set (window clipped at the grid edge counts as unset)
            int[] pre = new int[(GW + 1) * GH]; bool[] h = new bool[m.Length]; bool[] o = new bool[m.Length];
            for (int j = 0; j < GH; j++) { int s = 0; for (int i = 0; i < GW; i++) { pre[j * (GW + 1) + i] = s; if (m[j * GW + i]) s++; } pre[j * (GW + 1) + GW] = s; }
            for (int j = 0; j < GH; j++) for (int i = 0; i < GW; i++) { int a = i - r, b = i + r; if (a < 0 || b >= GW) continue; h[j * GW + i] = pre[j * (GW + 1) + b + 1] - pre[j * (GW + 1) + a] == 2 * r + 1; }
            for (int i = 0; i < GW; i++)
            {
                int[] col = new int[GH + 1]; int s = 0; for (int j = 0; j < GH; j++) { col[j] = s; if (h[j * GW + i]) s++; } col[GH] = s;
                for (int j = 0; j < GH; j++) { int a = j - r, b = j + r; if (a < 0 || b >= GH) continue; o[j * GW + i] = col[b + 1] - col[a] == 2 * r + 1; }
            }
            return o;
        }
        static bool[] Dilate1(bool[] m, int r)
        {
            bool[] h = new bool[m.Length]; bool[] o = new bool[m.Length];
            for (int j = 0; j < GH; j++) { int last = -1000000; int[] nearest = new int[GW]; for (int i = 0; i < GW; i++) { if (m[j * GW + i]) last = i; nearest[i] = last; }
                for (int i = 0; i < GW; i++) { bool any = (i - nearest[i] <= r); if (!any) { for (int d = 1; d <= r && i + d < GW; d++) if (m[j * GW + i + d]) { any = true; break; } } h[j * GW + i] = any; } }
            for (int i = 0; i < GW; i++) { int last = -1000000; int[] nearest = new int[GH]; for (int j = 0; j < GH; j++) { if (h[j * GW + i]) last = j; nearest[j] = last; }
                for (int j = 0; j < GH; j++) { bool any = (j - nearest[j] <= r); if (!any) { for (int d = 1; d <= r && j + d < GH; d++) if (h[(j + d) * GW + i]) { any = true; break; } } o[j * GW + i] = any; } }
            return o;
        }

        // direction (degrees, -45..45) in which the walls bounding the interior run, relative to the local x axis
        static double BoundaryAngle(Analysis an)
        {
            bool[] near = new bool[GW * GH]; bool[] reg = an.Union;
            for (int j = 1; j < GH - 1; j++) for (int i = 1; i < GW - 1; i++)
                {
                    if (!reg[j * GW + i]) continue;
                    if (reg[j * GW + i - 1] && reg[j * GW + i + 1] && reg[(j - 1) * GW + i] && reg[(j + 1) * GW + i]) continue;
                    for (int dj = -3; dj <= 3; dj++) for (int di = -3; di <= 3; di++) Plot(near, i + di, j + dj);
                }
            double[] hist = new double[360];
            foreach (Seg s in an.Segs)
            {
                double mx = (s.X1 + s.X2) / 2, my = (s.Y1 + s.Y2) / 2; int ci = (int)Math.Floor((mx - GX0) / RES), cj = (int)Math.Floor((my - GY0) / RES);
                if (ci < 0 || cj < 0 || ci >= GW || cj >= GH || !near[cj * GW + ci]) continue;
                double len = Math.Sqrt((s.X2 - s.X1) * (s.X2 - s.X1) + (s.Y2 - s.Y1) * (s.Y2 - s.Y1)); if (len < 0.25) continue;
                double ang = Math.Atan2(s.Y2 - s.Y1, s.X2 - s.X1) * 180 / Math.PI; ang = ((ang % 90) + 90) % 90;
                hist[(int)(ang * 4) % 360] += len;
            }
            double best = -1; int bi = 0;
            for (int i = 0; i < 360; i++) { double v = 0; for (int d = -4; d <= 4; d++) v += hist[(i + d + 360) % 360] * (5 - Math.Abs(d)); if (v > best) { best = v; bi = i; } }
            if (best <= 0) return 0;
            double sw = 0, sa = 0;
            for (int d = -6; d <= 6; d++) { double w = hist[(bi + d + 360) % 360]; sw += w; sa += w * d; }
            double a0 = (bi + sa / sw) / 4.0; a0 = ((a0 % 90) + 90) % 90; if (a0 > 45) a0 -= 90; return a0;
        }

        static void DebugPng(Analysis an, string path)
        {
            using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(GW, GH))
            {
                for (int j = 0; j < GH; j++) for (int i = 0; i < GW; i++)
                    {
                        int c = an.Solid[j * GW + i] ? 0x303030 : 0xFFFFFF; if (an.DebugLeak != null && an.DebugLeak[j * GW + i]) c = 0xC8D8F4; if (an.Union != null && an.Union[j * GW + i]) c = 0xF0C8C8;
                        bmp.SetPixel(i, GH - 1 - j, System.Drawing.Color.FromArgb(255, (c >> 16) & 255, (c >> 8) & 255, c & 255));
                    }
                using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bmp))
                {
                    System.Drawing.Pen red = new System.Drawing.Pen(System.Drawing.Color.Red, 2);
                    foreach (RegionInfo ri in an.Regions)
                    {
                        if (ri.Poly == null || ri.Poly.Count < 3) continue;
                        System.Drawing.PointF[] pts = new System.Drawing.PointF[ri.Poly.Count];
                        for (int i = 0; i < pts.Length; i++) pts[i] = new System.Drawing.PointF((float)((ri.Poly[i][0] - GX0) / RES), (float)(GH - 1 - (ri.Poly[i][1] - GY0) / RES));
                        g.DrawPolygon(red, pts);
                    }
                    g.FillEllipse(System.Drawing.Brushes.Green, (float)((0 - GX0) / RES) - 5, (float)(GH - 1 - (0 - GY0) / RES) - 5, 10, 10);
                }
                bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        // ---------- geometry helpers ----------
        static Seg SliceTri(double[] t, double z)
        {
            double[] px = new double[2], py = new double[2]; int n = 0;
            for (int i = 0; i < 3; i++)
            {
                int j = (i + 1) % 3; double z1 = t[i * 3 + 2], z2 = t[j * 3 + 2];
                if ((z1 - z) * (z2 - z) < 0 && n < 2) { double u = (z - z1) / (z2 - z1); px[n] = t[i * 3] + (t[j * 3] - t[i * 3]) * u; py[n] = t[i * 3 + 1] + (t[j * 3 + 1] - t[i * 3 + 1]) * u; n++; }
            }
            if (n != 2) return null; Seg s = new Seg(); s.X1 = px[0]; s.Y1 = py[0]; s.X2 = px[1]; s.Y2 = py[1]; return s;
        }
        static Box3 MakeBox(double[] P, Func<double, double, double[]> toLocal, double floorZ)
        {
            // 4 alternating corners of an oriented box: centre = mean, half edges from sign patterns
            double[][] c = new double[4][];
            for (int i = 0; i < 4; i++) { double[] xy = toLocal(P[i * 3], P[i * 3 + 1]); c[i] = new double[] { xy[0], xy[1], P[i * 3 + 2] - floorZ }; }
            Box3 b = new Box3();
            for (int a = 0; a < 3; a++) b.C[a] = (c[0][a] + c[1][a] + c[2][a] + c[3][a]) / 4;
            double[][] sg = new double[][] { new double[] { 1, 1, -1, -1 }, new double[] { 1, -1, 1, -1 }, new double[] { 1, -1, -1, 1 } };
            double[][] e = new double[3][];
            for (int k = 0; k < 3; k++) { e[k] = new double[3]; for (int a = 0; a < 3; a++) e[k][a] = (sg[k][0] * c[0][a] + sg[k][1] * c[1][a] + sg[k][2] * c[2][a] + sg[k][3] * c[3][a]) / 4; }
            b.E1 = e[0]; b.E2 = e[1]; b.E3 = e[2];
            b.X0 = b.Y0 = b.Z0 = 1e9; b.X1 = b.Y1 = b.Z1 = -1e9;
            for (int s = 0; s < 8; s++)
            {
                double x = b.C[0] + ((s & 1) == 0 ? 1 : -1) * e[0][0] + ((s & 2) == 0 ? 1 : -1) * e[1][0] + ((s & 4) == 0 ? 1 : -1) * e[2][0];
                double y = b.C[1] + ((s & 1) == 0 ? 1 : -1) * e[0][1] + ((s & 2) == 0 ? 1 : -1) * e[1][1] + ((s & 4) == 0 ? 1 : -1) * e[2][1];
                double z = b.C[2] + ((s & 1) == 0 ? 1 : -1) * e[0][2] + ((s & 2) == 0 ? 1 : -1) * e[1][2] + ((s & 4) == 0 ? 1 : -1) * e[2][2];
                b.X0 = Math.Min(b.X0, x); b.X1 = Math.Max(b.X1, x); b.Y0 = Math.Min(b.Y0, y); b.Y1 = Math.Max(b.Y1, y); b.Z0 = Math.Min(b.Z0, z); b.Z1 = Math.Max(b.Z1, z);
            }
            return b;
        }

        // ---------- raster ----------
        static void Plot(bool[] g, int i, int j) { if (i >= 0 && j >= 0 && i < GW && j < GH) g[j * GW + i] = true; }
        static void DrawLine(bool[] g, double x1, double y1, double x2, double y2)
        {
            double len = Math.Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)); int n = Math.Max(1, (int)(len / (RES * 0.5)));
            for (int k = 0; k <= n; k++) { double t = (double)k / n; Plot(g, (int)Math.Floor((x1 + (x2 - x1) * t - GX0) / RES), (int)Math.Floor((y1 + (y2 - y1) * t - GY0) / RES)); }
        }
        static void FillRect(bool[] g, double x0, double y0, double x1, double y1)
        {
            int i0 = (int)Math.Floor((x0 - GX0) / RES), i1 = (int)Math.Floor((x1 - GX0) / RES), j0 = (int)Math.Floor((y0 - GY0) / RES), j1 = (int)Math.Floor((y1 - GY0) / RES);
            for (int i = i0; i <= i1; i++) for (int j = j0; j <= j1; j++) Plot(g, i, j);
        }
        static bool[] Dilate(bool[] g)
        {
            bool[] o = new bool[g.Length];
            for (int j = 0; j < GH; j++) for (int i = 0; i < GW; i++)
                {
                    if (!g[j * GW + i]) continue;
                    for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) Plot(o, i + di, j + dj);
                }
            return o;
        }
        static bool[] Flood(bool[] solid, int si, int sj, out int area, out bool leak)
        {
            bool[] r = new bool[solid.Length]; Stack<int> st = new Stack<int>(); st.Push(sj * GW + si); r[sj * GW + si] = true; area = 0; leak = false;
            while (st.Count > 0)
            {
                int c = st.Pop(); area++; int i = c % GW, j = c / GW;
                if (i == 0 || j == 0 || i == GW - 1 || j == GH - 1) { leak = true; return r; }
                if (area > 400000) { leak = true; return r; }
                int[] nb = new int[] { c - 1, c + 1, c - GW, c + GW };
                foreach (int n in nb) if (!solid[n] && !r[n]) { r[n] = true; st.Push(n); }
            }
            return r;
        }

        // ---------- outline of the flooded region as a rectilinear polygon (counter-clockwise, interior on the left) ----------
        static List<double[]> TraceOutline(bool[] reg)
        {
            Dictionary<long, List<long>> next = new Dictionary<long, List<long>>();
            Action<int, int, int, int> add = delegate (int ax, int ay, int bx, int by)
            {
                long ka = (long)ax * 100000 + ay, kb = (long)bx * 100000 + by; List<long> l; if (!next.TryGetValue(ka, out l)) { l = new List<long>(); next[ka] = l; } l.Add(kb);
            };
            Func<int, int, bool> In = delegate (int i, int j) { return i >= 0 && j >= 0 && i < GW && j < GH && reg[j * GW + i]; };
            for (int j = 0; j < GH; j++) for (int i = 0; i < GW; i++)
                {
                    if (!reg[j * GW + i]) continue;
                    if (!In(i, j - 1)) add(i, j, i + 1, j);
                    if (!In(i + 1, j)) add(i + 1, j, i + 1, j + 1);
                    if (!In(i, j + 1)) add(i + 1, j + 1, i, j + 1);
                    if (!In(i - 1, j)) add(i, j + 1, i, j);
                }
            List<List<int[]>> loops = new List<List<int[]>>();
            List<long> keys = new List<long>(next.Keys);
            foreach (long k0 in keys)
            {
                while (next[k0].Count > 0)
                {
                    List<int[]> loop = new List<int[]>(); long cur = k0; int guard = 0;
                    while (guard++ < 2000000)
                    {
                        List<long> l; if (!next.TryGetValue(cur, out l) || l.Count == 0) break;
                        long nx = l[l.Count - 1]; l.RemoveAt(l.Count - 1);
                        loop.Add(new int[] { (int)(cur / 100000), (int)(cur % 100000) }); cur = nx; if (cur == k0) break;
                    }
                    if (loop.Count >= 4) loops.Add(loop);
                }
            }
            List<int[]> bestLoop = null; double bestA = 0;
            foreach (List<int[]> lp in loops) { double a = 0; for (int i = 0; i < lp.Count; i++) { int[] p = lp[i], q = lp[(i + 1) % lp.Count]; a += (double)p[0] * q[1] - (double)q[0] * p[1]; } a /= 2; if (a > bestA) { bestA = a; bestLoop = lp; } }
            if (bestLoop == null) return new List<double[]>();
            // keep only corners
            List<double[]> pts = new List<double[]>();
            int n0 = bestLoop.Count;
            for (int i = 0; i < n0; i++)
            {
                int[] p = bestLoop[(i + n0 - 1) % n0], c = bestLoop[i], q = bestLoop[(i + 1) % n0];
                if ((c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]) != 0) pts.Add(new double[] { GX0 + c[0] * RES, GY0 + c[1] * RES });
            }
            return RemoveJogs(pts, 0.13);
        }

        static List<double[]> RemoveJogs(List<double[]> v, double jog)
        {
            bool changed = true; int guard = 0;
            while (changed && v.Count > 4 && guard++ < 5000)
            {
                changed = false; int n = v.Count;
                for (int k = 0; k < n && !changed; k++)
                {
                    double[] a = v[k], b = v[(k + 1) % n]; double len = Math.Abs(b[0] - a[0]) + Math.Abs(b[1] - a[1]);
                    if (len >= jog) continue;
                    double[] pr = v[(k + n - 1) % n], nx = v[(k + 2) % n];
                    bool horiz = Math.Abs(b[1] - a[1]) < 1e-9;                        // the short edge is horizontal: neighbours are vertical
                    int ax = horiz ? 0 : 1;                                          // coordinate that the two neighbouring runs hold constant
                    // neighbours run along (1 - ax); same direction means a staircase jog
                    double d1 = a[1 - ax] - pr[1 - ax], d2 = nx[1 - ax] - b[1 - ax];
                    if (d1 * d2 <= 0) continue;
                    double l1 = Math.Abs(d1), l2 = Math.Abs(d2), avg = (pr[ax] * l1 + nx[ax] * l2) / (l1 + l2);
                    // neighbours are the runs pr->a and b->nx, both parallel; put them on one line
                    pr[ax] = avg; nx[ax] = avg;
                    List<double[]> nv = new List<double[]>();
                    for (int i = 0; i < n; i++) if (i != k && i != (k + 1) % n) nv.Add(v[i]);
                    v = nv; changed = true;
                }
                // drop collinear points
                if (changed)
                {
                    List<double[]> nv2 = new List<double[]>(); int n2 = v.Count;
                    for (int i = 0; i < n2; i++) { double[] p = v[(i + n2 - 1) % n2], c = v[i], q = v[(i + 1) % n2]; if (Math.Abs((c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0])) > 1e-9) nv2.Add(c); }
                    v = nv2;
                }
            }
            // snap coordinates exactly axis-aligned (neighbours share x or y)
            return v;
        }

        // ---------- window candidates: clusters of thin collision boxes lying along an outline edge ----------
        static List<object> WindowCandidates(List<List<double[]>> polys, List<Box3> boxes)
        {
            List<object> res = new List<object>();
            foreach (List<double[]> poly in polys) {
            int n = poly.Count;
            for (int e = 0; e < n; e++)
            {
                double[] a = poly[e], b = poly[(e + 1) % n]; double dx = b[0] - a[0], dy = b[1] - a[1], len = Math.Sqrt(dx * dx + dy * dy); if (len < 0.6) continue;
                double ux = dx / len, uy = dy / len, nx = -uy, ny = ux;                    // interior normal (left of a CCW edge)
                List<double[]> items = new List<double[]>();                              // u0, u1, z0, z1
                foreach (Box3 bx in boxes)
                {
                    double cxm = (bx.X0 + bx.X1) / 2, cym = (bx.Y0 + bx.Y1) / 2;
                    double d = (cxm - a[0]) * nx + (cym - a[1]) * ny; if (d < -0.5 || d > 0.35) continue;
                    double thick = Math.Abs(ux) > 0.5 ? (bx.Y1 - bx.Y0) : (bx.X1 - bx.X0); if (thick > 0.4) continue;
                    double u0 = 1e9, u1 = -1e9;
                    double[] xs = new double[] { bx.X0, bx.X1 }, ys = new double[] { bx.Y0, bx.Y1 };
                    foreach (double x in xs) foreach (double y in ys) { double u = (x - a[0]) * ux + (y - a[1]) * uy; u0 = Math.Min(u0, u); u1 = Math.Max(u1, u); }
                    if (u1 < -0.05 || u0 > len + 0.05) continue; if (u1 - u0 > 4.5) continue;
                    if (bx.Z1 < 0.3 || bx.Z0 > 2.8) continue;
                    items.Add(new double[] { u0, u1, bx.Z0, bx.Z1 });
                }
                items.Sort(delegate (double[] p, double[] q) { return p[0].CompareTo(q[0]); });
                int i = 0;
                while (i < items.Count)
                {
                    double u0 = items[i][0], u1 = items[i][1], z0 = items[i][2], z1 = items[i][3]; int cnt = 1; i++;
                    while (i < items.Count && items[i][0] <= u1 + 0.3) { u1 = Math.Max(u1, items[i][1]); z0 = Math.Min(z0, items[i][2]); z1 = Math.Max(z1, items[i][3]); cnt++; i++; }
                    double w = u1 - u0, h = z1 - z0;
                    if (cnt < 2 || w < 0.4 || h < 0.5) continue;
                    bool isDoor = z0 < 0.35 && z1 > 1.95 && w < 2.4;
                    // absolute position along the wall: edges are axis aligned, so the u axis is +x, -x, +y or -y
                    bool horiz = Math.Abs(uy) < 0.5; double sgn = horiz ? Math.Sign(ux) : Math.Sign(uy); double start = horiz ? a[0] : a[1];
                    double au0 = sgn > 0 ? start + u0 : start - u1, au1 = sgn > 0 ? start + u1 : start - u0;
                    double inward = horiz ? (ux > 0 ? 1 : -1) : (uy > 0 ? -1 : 1);       // which side of the wall line the interior is on, along the other axis
                    Dictionary<string, object> w2 = new Dictionary<string, object>();
                    w2["o"] = horiz ? "H" : "V"; w2["c"] = horiz ? a[1] : a[0]; w2["u0"] = au0; w2["u1"] = au1; w2["z0"] = z0; w2["z1"] = z1; w2["inward"] = inward; w2["door"] = isDoor; w2["boxes"] = cnt;
                    res.Add(w2);
                }
            }
            }
            return res;
        }
    }
}
