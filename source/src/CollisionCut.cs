// Cuts the model's solid collision (.ybn) with the same boxes that cut the model: triangles are clipped like the visible mesh,
// boxes that line up with the cutter are split around it, anything else is removed only when its centre is inside. Works on CodeWalker's XML form. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public class ColGeom
    {
        public XmlElement Node, VertsNode, PolysNode; public double[] Center = new double[3]; public List<double[]> V = new List<double[]>();
    }

    public class ColDoc
    {
        public string Name; public XmlDocument Doc;
        static readonly char[] SEP = new char[] { ',', ' ', '\t', '\r', '\n' };

        public static ColDoc Load(byte[] ybn, string name)
        {
            YbnFile y = new YbnFile(); y.Load(ybn);
            if (y.Bounds == null) throw new Exception(name + " is not a collision file the program can read.");
            string fn; string xml = MetaXml.GetXml(y, out fn);
            ColDoc d = new ColDoc(); d.Name = name; d.Doc = new XmlDocument(); d.Doc.LoadXml(xml); return d;
        }

        // the geometries of a (cloned) document; vertices are relative to each geometry's centre
        public static List<ColGeom> Geoms(XmlDocument doc, List<string> warns, string name)
        {
            List<ColGeom> list = new List<ColGeom>();
            foreach (XmlNode n in doc.SelectNodes("//Children/Item"))
            {
                XmlElement e = n as XmlElement; if (e == null) continue;
                XmlNode vn = e.SelectSingleNode("Vertices"), pn = e.SelectSingleNode("Polygons"), cn = e.SelectSingleNode("GeometryCenter"), tn = e.SelectSingleNode("CompositeTransform");
                if (vn == null || pn == null || cn == null) continue;
                if (tn != null)
                {
                    string[] t = tn.InnerText.Split(SEP, StringSplitOptions.RemoveEmptyEntries); double[] id = new double[] { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }; bool ok = t.Length == 16;
                    for (int i = 0; ok && i < 16; i++) if (Math.Abs(double.Parse(t[i], CultureInfo.InvariantCulture) - id[i]) > 1e-6) ok = false;
                    if (!ok) { warns.Add(name + ": a collision part is turned inside the file, it was left as it is."); continue; }
                }
                ColGeom g = new ColGeom(); g.Node = e; g.VertsNode = (XmlElement)vn; g.PolysNode = (XmlElement)pn;
                g.Center = new double[] { D(cn, "x"), D(cn, "y"), D(cn, "z") };
                string[] tok = vn.InnerText.Split(SEP, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i + 2 < tok.Length; i += 3) g.V.Add(new double[] { double.Parse(tok[i], CultureInfo.InvariantCulture), double.Parse(tok[i + 1], CultureInfo.InvariantCulture), double.Parse(tok[i + 2], CultureInfo.InvariantCulture) });
                list.Add(g);
            }
            return list;
        }
        static double D(XmlNode n, string a) { return double.Parse(n.Attributes[a].Value, CultureInfo.InvariantCulture); }
        public static double[] World(ColGeom g, int vi) { double[] v = g.V[vi]; return new double[] { v[0] + g.Center[0], v[1] + g.Center[1], v[2] + g.Center[2] }; }
    }

    public class CollisionStats { public int Removed, Added, Kept, Deleted; public List<string> Warnings = new List<string>(); }

    public static class CollisionCut
    {
        static int VertexFor(ColGeom g, double[] w, List<string> newLines)
        {
            double[] r = new double[] { w[0] - g.Center[0], w[1] - g.Center[1], w[2] - g.Center[2] }; g.V.Add(r);
            newLines.Add("     " + r[0].ToString("R", CultureInfo.InvariantCulture) + ", " + r[1].ToString("R", CultureInfo.InvariantCulture) + ", " + r[2].ToString("R", CultureInfo.InvariantCulture));
            return g.V.Count - 1;
        }

        static bool Inside(CutBox b, double[] p)
        {
            for (int k = 0; k < 6; k++) if (b.Nrm[k][0] * p[0] + b.Nrm[k][1] * p[1] + b.Nrm[k][2] * p[2] - b.Off[k] > 1e-7) return false;
            return true;
        }

        // splits an oriented box around a cutter when their axes line up. null = the cutter does not touch it, empty = it is gone
        static List<double[][]> SplitBox(double[][] c4, CutBox k)
        {
            double[] cen = new double[3]; for (int a = 0; a < 3; a++) cen[a] = (c4[0][a] + c4[1][a] + c4[2][a] + c4[3][a]) / 4;
            double[][] sg = new double[][] { new double[] { 1, 1, -1, -1 }, new double[] { 1, -1, 1, -1 }, new double[] { 1, -1, -1, 1 } }; double[][] e = new double[3][];
            for (int j = 0; j < 3; j++) { e[j] = new double[3]; for (int a = 0; a < 3; a++) e[j][a] = (sg[j][0] * c4[0][a] + sg[j][1] * c4[1][a] + sg[j][2] * c4[2][a] + sg[j][3] * c4[3][a]) / 4; }
            double[] h = new double[3]; double[][] u = new double[3][];
            for (int j = 0; j < 3; j++) { h[j] = Math.Sqrt(e[j][0] * e[j][0] + e[j][1] * e[j][1] + e[j][2] * e[j][2]); if (h[j] < 1e-6) return null; u[j] = new double[] { e[j][0] / h[j], e[j][1] / h[j], e[j][2] / h[j] }; }
            // each of the box's axes must line up with one of the cutter's axes
            double cs = Math.Cos(k.Yaw), sn = Math.Sin(k.Yaw);
            double[][] ka = new double[][] { new double[] { cs, sn, 0 }, new double[] { -sn, cs, 0 }, new double[] { 0, 0, 1 } }; double[] kh = new double[] { k.Hu, k.Hn, k.Hz };
            int[] map = new int[3]; bool[] used = new bool[3];
            for (int j = 0; j < 3; j++)
            {
                map[j] = -1;
                for (int q = 0; q < 3; q++) { double d = Math.Abs(u[j][0] * ka[q][0] + u[j][1] * ka[q][1] + u[j][2] * ka[q][2]); if (d > 0.9994 && !used[q]) { map[j] = q; used[q] = true; break; } }
                if (map[j] < 0) return Fallback(cen, k);
            }
            double[] lo = new double[3], hi = new double[3], klo = new double[3], khi = new double[3];
            for (int j = 0; j < 3; j++)
            {
                double t = (k.Cx - cen[0]) * u[j][0] + (k.Cy - cen[1]) * u[j][1] + (k.Cz - cen[2]) * u[j][2], r = kh[map[j]];
                klo[j] = t - r; khi[j] = t + r; lo[j] = -h[j]; hi[j] = h[j];
                if (khi[j] <= lo[j] + 1e-6 || klo[j] >= hi[j] - 1e-6) return null;                 // no overlap on this axis
            }
            List<double[][]> res = new List<double[][]>();
            Action<double[], double[]> emit = delegate (double[] a, double[] b)
            {
                for (int j = 0; j < 3; j++) if (b[j] - a[j] < 0.004) return;
                double[] c = new double[3], half = new double[3]; for (int j = 0; j < 3; j++) { double m = (a[j] + b[j]) / 2; half[j] = (b[j] - a[j]) / 2; for (int ax = 0; ax < 3; ax++) c[ax] = (j == 0 ? cen[ax] : c[ax]) + m * u[j][ax]; }
                double[][] o = new double[4][]; double[][] sgn = new double[][] { new double[] { 1, 1, 1 }, new double[] { 1, -1, -1 }, new double[] { -1, 1, -1 }, new double[] { -1, -1, 1 } };
                for (int i = 0; i < 4; i++) { o[i] = new double[3]; for (int ax = 0; ax < 3; ax++) o[i][ax] = c[ax] + sgn[i][0] * half[0] * u[0][ax] + sgn[i][1] * half[1] * u[1][ax] + sgn[i][2] * half[2] * u[2][ax]; }
                res.Add(o);
            };
            double[] cl = (double[])lo.Clone(), ch = (double[])hi.Clone();
            for (int j = 0; j < 3; j++)
            {
                if (klo[j] > cl[j] + 0.004) { double[] a = (double[])cl.Clone(), b = (double[])ch.Clone(); b[j] = klo[j]; emit(a, b); }
                if (khi[j] < ch[j] - 0.004) { double[] a = (double[])cl.Clone(), b = (double[])ch.Clone(); a[j] = khi[j]; emit(a, b); }
                cl[j] = Math.Max(cl[j], klo[j]); ch[j] = Math.Min(ch[j], khi[j]);
            }
            return res;
        }
        static List<double[][]> Fallback(double[] cen, CutBox k) { return Inside(k, cen) ? new List<double[][]>() : null; }

        public static long PolyKey(int child, int poly) { return ((long)child << 32) | (uint)poly; }

        // cuts one collision document; returns the changed document (a copy) or null when nothing was touched.
        // `deletes`: polygons taken out whole before anything is cut, as PolyKey(child, polygon) with the numbering of ListPolys (child = position among the children
        // ColDoc.Geoms returns, polygon = position among the element children of its Polygons node).
        public static XmlDocument Cut(ColDoc cd, List<CutBox> boxes, CollisionStats st, HashSet<long> deletes = null)
        {
            XmlDocument doc = (XmlDocument)cd.Doc.CloneNode(true); bool any = false; int childNo = -1;
            foreach (ColGeom g in ColDoc.Geoms(doc, st.Warnings, cd.Name))
            {
                childNo++;
                List<XmlElement> polys = new List<XmlElement>(); foreach (XmlNode n in g.PolysNode.ChildNodes) { XmlElement pe = n as XmlElement; if (pe != null) polys.Add(pe); }
                List<string> newLines = new List<string>(); List<XmlElement> add = new List<XmlElement>(); int removedHere = 0;
                for (int polyNo = 0; polyNo < polys.Count; polyNo++)
                {
                    XmlElement pe = polys[polyNo];
                    if (deletes != null && deletes.Contains(PolyKey(childNo, polyNo))) { g.PolysNode.RemoveChild(pe); removedHere++; st.Deleted++; continue; }
                    string kind = pe.Name; List<int> vi = new List<int>(); foreach (string a in new string[] { "v1", "v2", "v3", "v4" }) if (pe.HasAttribute(a)) vi.Add(int.Parse(pe.GetAttribute(a), CultureInfo.InvariantCulture));
                    if (kind == "Triangle" || kind == "Box") { /* handled below */ }
                    List<double[]> w = new List<double[]>(); foreach (int i in vi) { if (i < 0 || i >= g.V.Count) { w = null; break; } w.Add(ColDoc.World(g, i)); }
                    if (w == null || w.Count == 0) continue;
                    double[] mn = new double[] { 1e30, 1e30, 1e30 }, mx = new double[] { -1e30, -1e30, -1e30 };
                    foreach (double[] p in w) for (int a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
                    List<CutBox> near = new List<CutBox>();
                    foreach (CutBox b in boxes) { bool hit = true; for (int a = 0; a < 3; a++) if (b.Mx[a] < mn[a] || b.Mn[a] > mx[a]) { hit = false; break; } if (hit) near.Add(b); }
                    if (near.Count == 0) { st.Kept++; continue; }
                    string m = pe.GetAttribute("m");
                    if (kind == "Triangle")
                    {
                        bool touched; List<double[][]> pieces = ModelCut.ClipPolygon(new double[][] { w[0], w[1], w[2] }, near, out touched);
                        if (!touched) { st.Kept++; continue; }
                        g.PolysNode.RemoveChild(pe); removedHere++; st.Removed++;
                        foreach (double[][] pc in pieces)
                            for (int i = 1; i + 1 < pc.Length; i++)
                            {
                                XmlElement t = doc.CreateElement("Triangle"); t.SetAttribute("m", m);
                                t.SetAttribute("v1", VertexFor(g, pc[0], newLines).ToString()); t.SetAttribute("v2", VertexFor(g, pc[i], newLines).ToString()); t.SetAttribute("v3", VertexFor(g, pc[i + 1], newLines).ToString());
                                t.SetAttribute("f1", "0"); t.SetAttribute("f2", "0"); t.SetAttribute("f3", "0"); add.Add(t); st.Added++;
                            }
                    }
                    else if (kind == "Box" && w.Count == 4)
                    {
                        // one cutter at a time: what is left of the box goes to the next cutter
                        List<double[][]> cur = new List<double[][]>(); cur.Add(new double[][] { w[0], w[1], w[2], w[3] }); bool touched = false;
                        foreach (CutBox b in near)
                        {
                            List<double[][]> next = new List<double[][]>();
                            foreach (double[][] bx in cur) { List<double[][]> r = SplitBox(bx, b); if (r == null) next.Add(bx); else { touched = true; next.AddRange(r); } }
                            cur = next; if (cur.Count == 0) break;
                        }
                        if (!touched) { st.Kept++; continue; }
                        g.PolysNode.RemoveChild(pe); removedHere++; st.Removed++;
                        foreach (double[][] bx in cur)
                        {
                            XmlElement t = doc.CreateElement("Box"); t.SetAttribute("m", m);
                            for (int i = 0; i < 4; i++) t.SetAttribute("v" + (i + 1), VertexFor(g, bx[i], newLines).ToString());
                            add.Add(t); st.Added++;
                        }
                    }
                    else
                    {
                        // cylinders, capsules, spheres: removed when their centre is inside a cutter
                        double[] c = new double[] { 0, 0, 0 }; foreach (double[] p in w) for (int a = 0; a < 3; a++) c[a] += p[a] / w.Count;
                        bool inside = false; foreach (CutBox b in near) if (Inside(b, c)) { inside = true; break; }
                        if (inside) { g.PolysNode.RemoveChild(pe); removedHere++; st.Removed++; } else st.Kept++;
                    }
                }
                if (removedHere == 0) continue;
                any = true;
                foreach (XmlElement t in add) g.PolysNode.AppendChild(t);
                if (newLines.Count > 0) g.VertsNode.InnerText = g.VertsNode.InnerText.TrimEnd() + "\n" + string.Join("\n", newLines.ToArray()) + "\n    ";
            }
            return any ? doc : null;
        }

        // The triangles and boxes of a document around a point, for picking them in the editor. meta: 5 numbers per polygon (file, child, polygon, kind 0 triangle / 1 box,
        // material); verts: 12 numbers per polygon (4 corners; a triangle repeats its last), in the model's own coordinates like Lines. Numbering as in Cut's `deletes`.
        public static void ListPolys(XmlDocument doc, int fileNo, double[] entPos, double entHeadingRad, double[] near, double radius, List<int> meta, List<float> verts)
        {
            double c = Math.Cos(-entHeadingRad), s = Math.Sin(-entHeadingRad); List<string> warns = new List<string>(); int childNo = -1;
            foreach (ColGeom g in ColDoc.Geoms(doc, warns, ""))
            {
                childNo++; int polyNo = -1;
                foreach (XmlNode n in g.PolysNode.ChildNodes)
                {
                    XmlElement pe = n as XmlElement; if (pe == null) continue; polyNo++;
                    if (pe.Name != "Triangle" && pe.Name != "Box") continue;
                    List<double[]> w = new List<double[]>(); bool bad = false;
                    foreach (string a in new string[] { "v1", "v2", "v3", "v4" })
                    {
                        if (!pe.HasAttribute(a)) continue; int i = int.Parse(pe.GetAttribute(a), CultureInfo.InvariantCulture); if (i < 0 || i >= g.V.Count) { bad = true; break; }
                        double[] p = ColDoc.World(g, i), d = new double[] { p[0] - entPos[0], p[1] - entPos[1], p[2] - entPos[2] }; w.Add(new double[] { d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2] });
                    }
                    if (bad || (pe.Name == "Triangle" && w.Count != 3) || (pe.Name == "Box" && w.Count != 4)) continue;
                    double cx = 0, cy = 0; foreach (double[] p in w) { cx += p[0] / w.Count; cy += p[1] / w.Count; }
                    if (Math.Abs(cx - near[0]) > radius || Math.Abs(cy - near[1]) > radius) continue;
                    int m = 0; int.TryParse(pe.GetAttribute("m"), out m);
                    meta.Add(fileNo); meta.Add(childNo); meta.Add(polyNo); meta.Add(pe.Name == "Triangle" ? 0 : 1); meta.Add(m);
                    for (int k = 0; k < 4; k++) { double[] p = w[Math.Min(k, w.Count - 1)]; verts.Add((float)p[0]); verts.Add((float)p[1]); verts.Add((float)p[2]); }
                }
            }
        }

        // the edges of one collision polygon (a triangle, or a box from its 4 stored corners) as pairs of end points
        static void Wire(List<float> o, string kind, List<double[]> w)
        {
            if (kind == "Triangle") { for (int k = 0; k < 3; k++) { double[] a = w[k], b = w[(k + 1) % 3]; o.AddRange(new float[] { (float)a[0], (float)a[1], (float)a[2], (float)b[0], (float)b[1], (float)b[2] }); } }
            else
            {
                // 8 corners from the 4 stored ones
                double[] bc = new double[3]; foreach (double[] p in w) for (int a = 0; a < 3; a++) bc[a] += p[a] / 4;
                double[][] sg = new double[][] { new double[] { 1, 1, -1, -1 }, new double[] { 1, -1, 1, -1 }, new double[] { 1, -1, -1, 1 } }; double[][] ee = new double[3][];
                for (int j = 0; j < 3; j++) { ee[j] = new double[3]; for (int a = 0; a < 3; a++) ee[j][a] = (sg[j][0] * w[0][a] + sg[j][1] * w[1][a] + sg[j][2] * w[2][a] + sg[j][3] * w[3][a]) / 4; }
                double[][] cs = new double[8][];
                for (int q = 0; q < 8; q++) { cs[q] = new double[3]; for (int a = 0; a < 3; a++) cs[q][a] = bc[a] + ((q & 1) == 0 ? 1 : -1) * ee[0][a] + ((q & 2) == 0 ? 1 : -1) * ee[1][a] + ((q & 4) == 0 ? 1 : -1) * ee[2][a]; }
                int[][] edges = new int[][] { new int[] { 0, 1 }, new int[] { 2, 3 }, new int[] { 4, 5 }, new int[] { 6, 7 }, new int[] { 0, 2 }, new int[] { 1, 3 }, new int[] { 4, 6 }, new int[] { 5, 7 }, new int[] { 0, 4 }, new int[] { 1, 5 }, new int[] { 2, 6 }, new int[] { 3, 7 } };
                foreach (int[] ed in edges) { double[] a = cs[ed[0]], b = cs[ed[1]]; o.AddRange(new float[] { (float)a[0], (float)a[1], (float)a[2], (float)b[0], (float)b[1], (float)b[2] }); }
            }
        }

        // wire-frame of the (cut) collision around a point of the model, in the model's own coordinates: pairs of end points
        public static List<float> Lines(XmlDocument doc, double[] entPos, double entHeadingRad, double[] near, double radius)
        {
            List<float> o = new List<float>(); double c = Math.Cos(-entHeadingRad), s = Math.Sin(-entHeadingRad); List<string> warns = new List<string>();
            foreach (ColGeom g in ColDoc.Geoms(doc, warns, ""))
            {
                foreach (XmlNode n in g.PolysNode.ChildNodes)
                {
                    XmlElement pe = n as XmlElement; if (pe == null || (pe.Name != "Triangle" && pe.Name != "Box")) continue;
                    List<double[]> w = new List<double[]>();
                    foreach (string a in new string[] { "v1", "v2", "v3", "v4" })
                    {
                        if (!pe.HasAttribute(a)) continue; int i = int.Parse(pe.GetAttribute(a), CultureInfo.InvariantCulture); if (i < 0 || i >= g.V.Count) { w = null; break; }
                        double[] p = ColDoc.World(g, i), d = new double[] { p[0] - entPos[0], p[1] - entPos[1], p[2] - entPos[2] }; w.Add(new double[] { d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2] });
                    }
                    if (w == null || w.Count < 3) continue;
                    double[] cen = new double[3]; foreach (double[] p in w) for (int a = 0; a < 3; a++) cen[a] += p[a] / w.Count;
                    if (Math.Abs(cen[0] - near[0]) > radius || Math.Abs(cen[1] - near[1]) > radius) continue;
                    Wire(o, pe.Name, w);
                }
            }
            return o;
        }

        // How many collision polygons of a document lie inside the rooms (their centre at least `margin` inside one of the boxes); with `lines` their wire-frames are added in
        // the model's own coordinates, like Lines.
        public static int CountInside(XmlDocument doc, List<CutBox> rooms, double margin, List<float> lines, double[] entPos, double entHeadingRad)
        {
            if (rooms == null || rooms.Count == 0) return 0; int count = 0; double c = Math.Cos(-entHeadingRad), s = Math.Sin(-entHeadingRad); List<string> warns = new List<string>();
            foreach (ColGeom g in ColDoc.Geoms(doc, warns, ""))
            {
                foreach (XmlNode n in g.PolysNode.ChildNodes)
                {
                    XmlElement pe = n as XmlElement; if (pe == null) continue;
                    List<double[]> w = new List<double[]>(); bool bad = false;
                    foreach (string a in new string[] { "v1", "v2", "v3", "v4" })
                    {
                        if (!pe.HasAttribute(a)) continue; int i = int.Parse(pe.GetAttribute(a), CultureInfo.InvariantCulture); if (i < 0 || i >= g.V.Count) { bad = true; break; } w.Add(ColDoc.World(g, i));
                    }
                    if (bad || w.Count == 0) continue;
                    double[] cen = new double[3]; foreach (double[] p in w) for (int a = 0; a < 3; a++) cen[a] += p[a] / w.Count;
                    bool inside = false;
                    foreach (CutBox b in rooms)
                    {
                        bool all = true; for (int k = 0; k < 6 && all; k++) if (b.Nrm[k][0] * cen[0] + b.Nrm[k][1] * cen[1] + b.Nrm[k][2] * cen[2] - b.Off[k] > -margin) all = false;
                        if (all) { inside = true; break; }
                    }
                    if (!inside) continue; count++;
                    if (lines != null && ((pe.Name == "Triangle" && w.Count == 3) || (pe.Name == "Box" && w.Count == 4)))
                    {
                        List<double[]> loc = new List<double[]>(); foreach (double[] p in w) { double[] d = new double[] { p[0] - entPos[0], p[1] - entPos[1], p[2] - entPos[2] }; loc.Add(new double[] { d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2] }); }
                        Wire(lines, pe.Name, loc);
                    }
                }
            }
            return count;
        }
    }
}
