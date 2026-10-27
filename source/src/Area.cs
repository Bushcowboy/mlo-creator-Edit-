// An area of the world in 3D: the game's buildings around a spot, your server's MLOs and map entities there (their models from your resources' stream files,
// or the game's), and the collision of both, so that MLOs that clash with each other or with the map can be seen. Coordinates are sent relative to the
// spot (float precision). Encrypted files are never opened. Runs as one background job at a time. C# 5.
using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace MloCreator
{
    public static class Area
    {
        public static volatile string Status = "", Error = "";
        static Thread worker; static Dictionary<string, object> result;
        public static bool Busy { get { return worker != null && worker.IsAlive; } }
        const int GameMax = 350000, ServerMax = 350000, ColMax = 300000;

        public static void Start(Dictionary<string, object> spec, string gta, string cache)
        {
            if (Busy) throw new Exception("Still loading the last area.");
            Error = ""; result = null;
            worker = new Thread(delegate () { try { result = Load(spec, gta, cache); } catch (Exception ex) { Error = ex.Message; } finally { Status = ""; } });
            worker.IsBackground = true; worker.Start();
        }
        public static Dictionary<string, object> StatusInfo() { Dictionary<string, object> d = new Dictionary<string, object>(); d["busy"] = Busy; d["status"] = Status; d["error"] = Error; d["ready"] = result != null; return d; }
        public static Dictionary<string, object> Result() { if (result == null) throw new Exception(string.IsNullOrEmpty(Error) ? "Nothing loaded yet." : Error); return result; }

        // ---------- a drawable's triangles in its own coordinates (most detailed model), cached ----------
        static Dictionary<string, float[]> meshes = new Dictionary<string, float[]>();
        static float[] Tris(DrawableBase d)
        {
            List<float> o = new List<float>();
            if (d == null || d.DrawableModels == null || d.DrawableModels.High == null) return o.ToArray();
            foreach (DrawableModel m in d.DrawableModels.High)
            {
                if (m.Geometries == null) continue;
                foreach (DrawableGeometry g in m.Geometries)
                {
                    VertexData vd = g.VertexData; if (vd == null || g.IndexBuffer == null || g.IndexBuffer.Indices == null) continue;
                    int po = vd.Info.GetComponentOffset(0), st = g.VertexStride; byte[] vb = vd.VertexBytes; if (po < 0 || st <= 0) continue;
                    int nv = vb.Length / st; ushort[] ix = g.IndexBuffer.Indices;
                    for (int t = 0; t + 2 < ix.Length; t += 3)
                    {
                        int a = ix[t], b = ix[t + 1], c = ix[t + 2]; if (a == b || b == c || a == c || a >= nv || b >= nv || c >= nv) continue;
                        foreach (int v in new int[] { a, b, c }) { int q = v * st + po; o.Add(BitConverter.ToSingle(vb, q)); o.Add(BitConverter.ToSingle(vb, q + 4)); o.Add(BitConverter.ToSingle(vb, q + 8)); }
                    }
                }
            }
            return o.ToArray();
        }
        // a model by name: from your resources' stream files first (readable ones), then the game's
        static float[] MeshOf(uint hash, Dictionary<uint, string> srvFiles, out string from)
        {
            from = null; string key = hash.ToString("X8"); float[] t;
            string path; bool srv = srvFiles.TryGetValue(hash, out path);
            string ck = (srv ? "s|" + path : "g|" + key); if (meshes.TryGetValue(ck, out t)) { from = srv ? "server" : (t.Length > 0 ? "game" : null); return t; }
            try
            {
                if (srv)
                {
                    byte[] data = File.ReadAllBytes(path);
                    if (path.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase)) { YdrFile y = new YdrFile(); y.Load(data); t = Tris(y.Drawable); }
                    else { YftFile y = new YftFile(); y.Load(data); t = y.Fragment == null ? new float[0] : Tris(y.Fragment.Drawable); }
                    from = "server";
                }
                else if (Vanilla.Ready)
                {
                    string name = JenkIndex.TryGetString(hash);
                    if (!string.IsNullOrEmpty(name))
                    {
                        RpfFileEntry e; byte[] d = Vanilla.Bytes(name + ".ydr", out e);
                        if (d != null) { YdrFile y = new YdrFile(); y.Load(d, e); t = Tris(y.Drawable); }
                        else { d = Vanilla.Bytes(name + ".yft", out e); if (d != null) { YftFile y = new YftFile(); y.Load(d, e); t = y.Fragment == null ? new float[0] : Tris(y.Fragment.Drawable); } }
                    }
                    if (t != null && t.Length > 0) from = "game";
                }
            }
            catch (Exception) { t = null; }
            if (t == null) t = new float[0];
            meshes[ck] = t; return t;
        }

        static string B64(List<float> l) { float[] a = l.ToArray(); byte[] b = new byte[a.Length * 4]; Buffer.BlockCopy(a, 0, b, 0, b.Length); return Convert.ToBase64String(b); }

        // ---------- collision: polygons of a bound (children with their own transforms), into triangles and boxes in the world, relative to the spot ----------
        static void Walk(Bounds b, Xf place, Matrix parent, V3 c, double[] win, List<float> tris, List<float> boxes, ref int count)
        {
            if (b == null || count > ColMax) return;
            Matrix m = parent;
            if (b.Parent != null) { try { m = b.Transform * parent; } catch (Exception) { } }
            BoundComposite comp = b as BoundComposite;
            if (comp != null) { if (comp.Children != null) foreach (Bounds ch in comp.Children.data_items) Walk(ch, place, m, c, win, tris, boxes, ref count); return; }
            BoundGeometry geo = b as BoundGeometry;
            Func<Vector3, V3> W = delegate (Vector3 v) { Vector3 q = Vector3.TransformCoordinate(v, m); return place.Apply(new V3(q.X, q.Y, q.Z)); };
            if (geo == null || geo.Polygons == null)
            {
                // a box, sphere, capsule or cylinder on its own: its box
                V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
                for (int i = 0; i < 8; i++) { V3 w = W(new Vector3((i & 1) == 0 ? b.BoxMin.X : b.BoxMax.X, (i & 2) == 0 ? b.BoxMin.Y : b.BoxMax.Y, (i & 4) == 0 ? b.BoxMin.Z : b.BoxMax.Z)); mn = new V3(Math.Min(mn.X, w.X), Math.Min(mn.Y, w.Y), Math.Min(mn.Z, w.Z)); mx = new V3(Math.Max(mx.X, w.X), Math.Max(mx.Y, w.Y), Math.Max(mx.Z, w.Z)); }
                if (mx.X < win[0] || mn.X > win[1] || mx.Y < win[2] || mn.Y > win[3]) return;
                boxes.Add((float)(mn.X - c.X)); boxes.Add((float)(mn.Y - c.Y)); boxes.Add((float)(mn.Z - c.Z)); boxes.Add((float)(mx.X - c.X)); boxes.Add((float)(mx.Y - c.Y)); boxes.Add((float)(mx.Z - c.Z)); count++; return;
            }
            foreach (BoundPolygon p in geo.Polygons)
            {
                Vector3[] vp = p.VertexPositions; if (vp == null) continue;
                BoundPolygonTriangle tp = p as BoundPolygonTriangle; BoundPolygonBox bp = p as BoundPolygonBox;
                if (tp != null && vp.Length >= 3)
                {
                    V3 a = W(vp[0]), bb = W(vp[1]), cc = W(vp[2]);
                    if (Math.Max(a.X, Math.Max(bb.X, cc.X)) < win[0] || Math.Min(a.X, Math.Min(bb.X, cc.X)) > win[1] || Math.Max(a.Y, Math.Max(bb.Y, cc.Y)) < win[2] || Math.Min(a.Y, Math.Min(bb.Y, cc.Y)) > win[3]) continue;
                    foreach (V3 v in new V3[] { a, bb, cc }) { tris.Add((float)(v.X - c.X)); tris.Add((float)(v.Y - c.Y)); tris.Add((float)(v.Z - c.Z)); }
                    if (++count > ColMax) return;
                }
                else if (bp != null && vp.Length >= 4)
                {
                    V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
                    foreach (Vector3 v0 in vp) { V3 w = W(v0); mn = new V3(Math.Min(mn.X, w.X), Math.Min(mn.Y, w.Y), Math.Min(mn.Z, w.Z)); mx = new V3(Math.Max(mx.X, w.X), Math.Max(mx.Y, w.Y), Math.Max(mx.Z, w.Z)); }
                    if (mx.X < win[0] || mn.X > win[1] || mx.Y < win[2] || mn.Y > win[3]) continue;
                    boxes.Add((float)(mn.X - c.X)); boxes.Add((float)(mn.Y - c.Y)); boxes.Add((float)(mn.Z - c.Z)); boxes.Add((float)(mx.X - c.X)); boxes.Add((float)(mx.Y - c.Y)); boxes.Add((float)(mx.Z - c.Z));
                    if (++count > ColMax) return;
                }
            }
        }

        // the same as Walk for one of your resources' files, remembering where every piece comes from: file, top child of the composite (-1: the file is one
        // shape), polygon in it (-1: the whole child is one shape), so a piece picked in the view can be taken out of that file
        static void WalkRef(Bounds b, Xf place, Matrix parent, V3 c, double[] win, List<float> tris, List<float> boxes, List<int> trefs, List<int> brefs, int file, int child, ref int count)
        {
            if (b == null || count > ColMax) return;
            Matrix m = parent; if (b.Parent != null) { try { m = b.Transform * parent; } catch (Exception) { } }
            BoundComposite comp = b as BoundComposite;
            if (comp != null) { if (comp.Children != null) { for (int i = 0; i < comp.Children.data_items.Length; i++) WalkRef(comp.Children.data_items[i], place, m, c, win, tris, boxes, trefs, brefs, file, child < 0 && b.Parent == null ? i : child, ref count); } return; }
            int t0 = tris.Count, b0 = boxes.Count;
            BoundGeometry geo = b as BoundGeometry;
            if (geo == null || geo.Polygons == null) { Walk(b, place, parent, c, win, tris, boxes, ref count); for (int k = b0; k < boxes.Count; k += 6) { brefs.Add(file); brefs.Add(child); brefs.Add(-1); } return; }
            Func<Vector3, V3> W = delegate (Vector3 v) { Vector3 q = Vector3.TransformCoordinate(v, m); return place.Apply(new V3(q.X, q.Y, q.Z)); };
            for (int pi = 0; pi < geo.Polygons.Length; pi++)
            {
                BoundPolygon p = geo.Polygons[pi]; Vector3[] vp = p.VertexPositions; if (vp == null) continue;
                if (p is BoundPolygonTriangle && vp.Length >= 3)
                {
                    V3 a = W(vp[0]), bb = W(vp[1]), cc = W(vp[2]);
                    if (Math.Max(a.X, Math.Max(bb.X, cc.X)) < win[0] || Math.Min(a.X, Math.Min(bb.X, cc.X)) > win[1] || Math.Max(a.Y, Math.Max(bb.Y, cc.Y)) < win[2] || Math.Min(a.Y, Math.Min(bb.Y, cc.Y)) > win[3]) continue;
                    foreach (V3 v in new V3[] { a, bb, cc }) { tris.Add((float)(v.X - c.X)); tris.Add((float)(v.Y - c.Y)); tris.Add((float)(v.Z - c.Z)); }
                    trefs.Add(file); trefs.Add(child); trefs.Add(pi); if (++count > ColMax) return;
                }
                else if (vp.Length >= 2 && (p is BoundPolygonBox || vp.Length >= 4))
                {
                    V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
                    foreach (Vector3 v0 in vp) { V3 w = W(v0); mn = new V3(Math.Min(mn.X, w.X), Math.Min(mn.Y, w.Y), Math.Min(mn.Z, w.Z)); mx = new V3(Math.Max(mx.X, w.X), Math.Max(mx.Y, w.Y), Math.Max(mx.Z, w.Z)); }
                    if (mx.X < win[0] || mn.X > win[1] || mx.Y < win[2] || mn.Y > win[3]) continue;
                    boxes.Add((float)(mn.X - c.X)); boxes.Add((float)(mn.Y - c.Y)); boxes.Add((float)(mn.Z - c.Z)); boxes.Add((float)(mx.X - c.X)); boxes.Add((float)(mx.Y - c.Y)); boxes.Add((float)(mx.Z - c.Z));
                    brefs.Add(file); brefs.Add(child); brefs.Add(pi); if (++count > ColMax) return;
                }
            }
        }
        static string B64i(List<int> l) { int[] a = l.ToArray(); byte[] b = new byte[a.Length * 4]; Buffer.BlockCopy(a, 0, b, 0, b.Length); return Convert.ToBase64String(b); }

        // an entity's model placed in the world: entity turn is stored inverted (inside an MLO and in a map file alike), the MLO instance's is not
        static int Place(float[] t, Xf x, double sxy, double sz, V3 c, double[] win, List<float> into, int budget)
        {
            int added = 0;
            for (int i = 0; i + 8 < t.Length; i += 9)
            {
                V3 a = x.Apply(new V3(t[i] * sxy, t[i + 1] * sxy, t[i + 2] * sz)), b = x.Apply(new V3(t[i + 3] * sxy, t[i + 4] * sxy, t[i + 5] * sz)), cc = x.Apply(new V3(t[i + 6] * sxy, t[i + 7] * sxy, t[i + 8] * sz));
                if (Math.Max(a.X, Math.Max(b.X, cc.X)) < win[0] || Math.Min(a.X, Math.Min(b.X, cc.X)) > win[1] || Math.Max(a.Y, Math.Max(b.Y, cc.Y)) < win[2] || Math.Min(a.Y, Math.Min(b.Y, cc.Y)) > win[3]) continue;
                foreach (V3 v in new V3[] { a, b, cc }) { into.Add((float)(v.X - c.X)); into.Add((float)(v.Y - c.Y)); into.Add((float)(v.Z - c.Z)); }
                if (++added >= budget) break;
            }
            return added;
        }
        static Xf EntXf(CEntityDef e, bool inverted)
        {
            Q r = new Q(e.rotation.X, e.rotation.Y, e.rotation.Z, e.rotation.W).Norm(); if (inverted) r = r.Conj();
            return new Xf(r, new V3(e.position.X, e.position.Y, e.position.Z));
        }

        static Dictionary<string, object> Load(Dictionary<string, object> spec, string gta, string cache)
        {
            double x = J.D(J.G(spec, "x"), 0), y = J.D(J.G(spec, "y"), 0), r = Math.Max(10, Math.Min(400, J.D(J.G(spec, "r"), 60)));
            bool wantGame = J.B(J.G(spec, "game"), true), wantServer = J.B(J.G(spec, "server"), true), wantCol = J.B(J.G(spec, "collision"), true);
            double[] win = new double[] { x - r, x + r, y - r, y + r, -1000, 4000 };
            List<string> log = new List<string>(), warns = new List<string>();
            object zo = J.G(spec, "z"); double z = zo == null ? double.NaN : J.D(zo, 0);
            if (wantGame) { Status = "Opening the game archives..."; try { Vanilla.Init(gta, cache); } catch (Exception ex) { warns.Add("The game was not loaded: " + ex.Message); wantGame = false; } }
            Dictionary<string, object> res = new Dictionary<string, object>();

            // ---- the game's buildings around the spot (nearest first, up to a budget) ----
            List<RefGroup> groups = new List<RefGroup>(); List<RefTri> rtris = new List<RefTri>(); List<EntityHit> hits = new List<EntityHit>();
            if (wantGame)
            {
                Status = "Finding the game's buildings around the spot (the first time the map files are indexed: a few minutes)...";
                hits = Vanilla.FindEntities(x, y, r + 40); hits.Sort(delegate (EntityHit a, EntityHit b) { return a.Dist.CompareTo(b.Dist); });
                Status = "Reading " + hits.Count + " of the game's models...";
                for (int i = 0; i < hits.Count && rtris.Count < GameMax; i += 8) Vanilla.ExtractGeometry(hits.GetRange(i, Math.Min(8, hits.Count - i)), win, groups, rtris);
                if (rtris.Count >= GameMax) warns.Add("The game's buildings were cut at " + GameMax + " triangles: make the area smaller to see everything.");
                log.Add("the game: " + hits.Count + " buildings, " + rtris.Count + " triangles");
            }
            if (double.IsNaN(z))
            {
                // the height of the spot: the middle of the game's geometry, or of the server's MLOs there
                List<double> zs = new List<double>(); foreach (RefTri t in rtris) if (zs.Count < 4000) zs.Add(t.P[2]);
                if (Server.Resources != null) foreach (SrvRes sr in Server.Resources) foreach (SrvPlace p in sr.Places) if (Math.Abs(p.P.X - x) < r && Math.Abs(p.P.Y - y) < r) zs.Add(p.P.Z);
                zs.Sort(); z = zs.Count > 0 ? zs[zs.Count / 2] : 0;
            }
            V3 c = new V3(x, y, z); res["centre"] = new double[] { x, y, z }; res["r"] = r;
            {
                List<object> gl = new List<object>(); Dictionary<int, List<float>> by = new Dictionary<int, List<float>>();
                foreach (RefTri t in rtris) { List<float> l; if (!by.TryGetValue(t.Group, out l)) by[t.Group] = l = new List<float>(); for (int k = 0; k < 9; k += 3) { l.Add((float)(t.P[k] - c.X)); l.Add((float)(t.P[k + 1] - c.Y)); l.Add((float)(t.P[k + 2] - c.Z)); } }
                // the buildings themselves (each placed model once), so one can be picked in the view and pulled into a project
                List<object> bl = new List<object>(); Dictionary<EntityHit, int> bi = new Dictionary<EntityHit, int>();
                foreach (KeyValuePair<int, List<float>> kv in by)
                {
                    EntityHit eh = groups[kv.Key].Hit; int b = -1;
                    if (eh != null && !bi.TryGetValue(eh, out b))
                    {
                        b = bl.Count; bi[eh] = b; Dictionary<string, object> e = new Dictionary<string, object>(); double hd = 2 * Math.Atan2(eh.Rot.Z, eh.Rot.W) * 180 / Math.PI;
                        e["name"] = eh.Name; e["ymap"] = eh.Ymap; e["x"] = Math.Round(eh.Pos.X, 3); e["y"] = Math.Round(eh.Pos.Y, 3); e["z"] = Math.Round(eh.Pos.Z, 3); e["heading"] = Math.Round(hd, 3);
                        e["size"] = new double[] { Math.Round((eh.BMax.X - eh.BMin.X) * (eh.Scale.X == 0 ? 1 : eh.Scale.X), 2), Math.Round((eh.BMax.Y - eh.BMin.Y) * (eh.Scale.X == 0 ? 1 : eh.Scale.X), 2), Math.Round((eh.BMax.Z - eh.BMin.Z) * (eh.Scale.Z == 0 ? 1 : eh.Scale.Z), 2) };
                        e["kb"] = eh.Ydr != null ? (int)(eh.Ydr.GetFileSize() / 1024) : 0; bl.Add(e);
                    }
                    Dictionary<string, object> g = new Dictionary<string, object>(); g["name"] = groups[kv.Key].Entity; g["color"] = groups[kv.Key].Color; g["pos"] = B64(kv.Value); g["b"] = b; gl.Add(g);
                }
                res["game"] = gl; res["buildings"] = bl;
            }

            // ---- your server: MLOs and map entities in the area ----
            List<object> srv = new List<object>(); int srvTris = 0;
            Dictionary<uint, string> srvFiles = new Dictionary<uint, string>();
            List<SrvRes> rs = Server.Resources;
            if (wantServer && rs == null) warns.Add("Scan your server's resources first (left) to see them here.");
            if (wantServer && rs != null)
            {
                foreach (SrvRes sr in rs) foreach (SrvFile f in sr.Files) if (f.State == "ok" && (f.Ext == ".ydr" || f.Ext == ".yft")) { uint h = JenkHash.GenHash(Path.GetFileNameWithoutExtension(f.Name)); if (!srvFiles.ContainsKey(h)) srvFiles[h] = Path.Combine(sr.Dir, f.Rel); }
                foreach (SrvRes sr in rs)
                {
                    List<float> pos = new List<float>(); int ents = 0, missing = 0, fromGame = 0;
                    Status = "Reading " + sr.Name + "...";
                    // MLOs placed in the area
                    foreach (SrvPlace p in sr.Places)
                    {
                        if (p.WMax.X < win[0] || p.WMin.X > win[1] || p.WMax.Y < win[2] || p.WMin.Y > win[3]) continue;
                        MloArchetype ma = FindMlo(rs, p.Hash); if (ma == null || ma.entities == null) { missing++; continue; }
                        Xf inst = new Xf(p.R, p.P);
                        foreach (MCEntityDef me in ma.entities)
                        {
                            if (srvTris >= ServerMax) break;
                            string from; float[] t = MeshOf(me._Data.archetypeName.Hash, srvFiles, out from); if (t.Length == 0) { missing++; continue; }
                            if (from == "game") fromGame++;
                            int n = Place(t, inst * EntXf(me._Data, true), me._Data.scaleXY == 0 ? 1 : me._Data.scaleXY, me._Data.scaleZ == 0 ? 1 : me._Data.scaleZ, c, win, pos, ServerMax - srvTris); srvTris += n; ents++;
                        }
                    }
                    // entities of its plain map files in the area
                    foreach (SrvFile f in sr.Files)
                    {
                        if (f.Ext != ".ymap" || f.State != "ok" || srvTris >= ServerMax) continue;
                        bool near = false; foreach (double[] mb in sr.MapBoxes) if (mb[3] >= win[0] && mb[0] <= win[1] && mb[4] >= win[2] && mb[1] <= win[3]) { near = true; break; }
                        if (!near) continue;
                        YmapFile ym = new YmapFile(); try { ym.Load(File.ReadAllBytes(Path.Combine(sr.Dir, f.Rel))); } catch (Exception) { continue; }
                        if (ym.AllEntities == null) continue;
                        foreach (YmapEntityDef en in ym.AllEntities)
                        {
                            if (en == null || en.IsMlo || srvTris >= ServerMax) continue; if (Math.Abs(en.Position.X - x) > r + 30 || Math.Abs(en.Position.Y - y) > r + 30) continue;
                            string lod = en._CEntityDef.lodLevel.ToString(); if (lod != "LODTYPES_DEPTH_HD" && lod != "LODTYPES_DEPTH_ORPHANHD") continue;
                            string from; float[] t = MeshOf(en._CEntityDef.archetypeName.Hash, srvFiles, out from); if (t.Length == 0) { missing++; continue; }
                            if (from == "game") fromGame++;
                            int n = Place(t, EntXf(en._CEntityDef, true), en._CEntityDef.scaleXY == 0 ? 1 : en._CEntityDef.scaleXY, en._CEntityDef.scaleZ == 0 ? 1 : en._CEntityDef.scaleZ, c, win, pos, ServerMax - srvTris); srvTris += n; ents++;
                        }
                    }
                    if (ents == 0 && missing == 0) continue;
                    Dictionary<string, object> o = new Dictionary<string, object>(); o["resource"] = sr.Name; o["pos"] = B64(pos); o["tris"] = pos.Count / 9; o["entities"] = ents; o["missing"] = missing; o["fromGame"] = fromGame; o["encrypted"] = sr.Encrypted; srv.Add(o);
                    log.Add(sr.Name + ": " + ents + " entities, " + (pos.Count / 9) + " triangles" + (missing > 0 ? ", " + missing + " models not found (encrypted, or not in the game)" : "") + (fromGame > 0 ? ", " + fromGame + " are the game's own models" : ""));
                }
                if (srvTris >= ServerMax) warns.Add("Your resources' models were cut at " + ServerMax + " triangles: make the area smaller to see everything.");
            }
            res["server"] = srv;

            // ---- collision: the game's (of its buildings there) and your resources' (interior collision moved by each placement, map collision as it is) ----
            if (wantCol)
            {
                Status = "Reading the collision...";
                List<object> cols = new List<object>(); int count = 0;
                if (wantGame && hits.Count > 0)
                {
                    List<float> ct = new List<float>(), cb = new List<float>(); HashSet<string> seen = new HashSet<string>();
                    foreach (EntityHit h in hits) h.Covers = true;
                    List<ColPoly> polys = new List<ColPoly>(); List<string> used = new List<string>(); Vanilla.ExtractCollision(hits, win, polys, used);
                    foreach (ColPoly p in polys)
                    {
                        if (p.Kind == 0) for (int k = 0; k < 9; k += 3) { ct.Add((float)(p.P[k] - c.X)); ct.Add((float)(p.P[k + 1] - c.Y)); ct.Add((float)(p.P[k + 2] - c.Z)); }
                        else { double x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; for (int k = 0; k + 2 < p.P.Length; k += 3) { x0 = Math.Min(x0, p.P[k]); y0 = Math.Min(y0, p.P[k + 1]); z0 = Math.Min(z0, p.P[k + 2]); x1 = Math.Max(x1, p.P[k]); y1 = Math.Max(y1, p.P[k + 1]); z1 = Math.Max(z1, p.P[k + 2]); } cb.Add((float)(x0 - c.X)); cb.Add((float)(y0 - c.Y)); cb.Add((float)(z0 - c.Z)); cb.Add((float)(x1 - c.X)); cb.Add((float)(y1 - c.Y)); cb.Add((float)(z1 - c.Z)); }
                        if (++count > ColMax) break;
                    }
                    Dictionary<string, object> o = new Dictionary<string, object>(); o["source"] = "the game"; o["tris"] = B64(ct); o["boxes"] = B64(cb); o["files"] = used; cols.Add(o);
                }
                if (wantServer && rs != null) foreach (SrvRes sr in rs)
                    {
                        List<float> ct = new List<float>(), cb = new List<float>(); List<string> used = new List<string>(); List<int> trefs = new List<int>(), brefs = new List<int>(); List<object> flist = new List<object>();
                        foreach (SrvFile f in sr.Files)
                        {
                            if (f.Ext != ".ybn" || f.State != "ok" || count > ColMax) continue;
                            int fi = flist.Count;
                            YbnFile yb = new YbnFile(); try { yb.Load(File.ReadAllBytes(Path.Combine(sr.Dir, f.Rel))); } catch (Exception) { continue; }
                            if (yb.Bounds == null) continue;
                            // an interior's collision: moved by every placement of that MLO; else the file is in world space
                            List<Xf> places = new List<Xf>(); bool interior = false;
                            foreach (SrvMlo m in sr.Mlos) if (m.Bounds.Contains(f.Name)) { interior = true; foreach (SrvRes r2 in rs) foreach (SrvPlace p in r2.Places) if (p.Hash == m.Hash) places.Add(new Xf(p.R, p.P)); }
                            if (!interior) places.Add(Xf.Identity);
                            int before = ct.Count + cb.Count;
                            foreach (Xf pl in places) WalkRef(yb.Bounds, pl, Matrix.Identity, c, win, ct, cb, trefs, brefs, fi, -1, ref count);
                            Dictionary<string, object> fo = new Dictionary<string, object>(); fo["name"] = f.Name; fo["rel"] = f.Rel; fo["interior"] = interior; flist.Add(fo);
                            if (ct.Count + cb.Count > before) used.Add(f.Name + (interior ? " (interior, " + places.Count + " placement" + (places.Count == 1 ? "" : "s") + ")" : ""));
                        }
                        if (used.Count == 0) continue;
                        Dictionary<string, object> o = new Dictionary<string, object>(); o["source"] = sr.Name; o["tris"] = B64(ct); o["boxes"] = B64(cb); o["files"] = used; o["fileList"] = flist; o["trefs"] = B64i(trefs); o["brefs"] = B64i(brefs); cols.Add(o);
                        log.Add(sr.Name + " collision: " + string.Join(", ", used.ToArray()));
                    }
                if (count > ColMax) warns.Add("The collision was cut at " + ColMax + " pieces: make the area smaller.");
                res["collision"] = cols;
            }
            res["ok"] = true; res["log"] = log; res["warnings"] = warns;
            return res;
        }

        // ---------- fixing a resource's collision file: pieces taken out, boxes added; the fixed copy goes to the output folder (the server folder is not touched) ----------
        public static Dictionary<string, object> Fix(Dictionary<string, object> spec, string outRoot)
        {
            List<SrvRes> rs = Server.Resources; if (rs == null) throw new Exception("Scan your server first.");
            string resName = J.S(J.G(spec, "resource"), ""), rel = J.S(J.G(spec, "file"), "");
            SrvRes sr = rs.Find(delegate (SrvRes q) { return q.Name == resName; }); if (sr == null) throw new Exception("No resource called " + resName + ".");
            SrvFile sf = sr.Files.Find(delegate (SrvFile q) { return q.Rel == rel; }); if (sf == null || sf.Ext != ".ybn") throw new Exception("No collision file " + rel + " in " + resName + ".");
            if (sf.State != "ok") throw new Exception(rel + " is encrypted or unreadable: it cannot be changed.");
            YbnFile yb = new YbnFile(); yb.Load(File.ReadAllBytes(Path.Combine(sr.Dir, sf.Rel)));
            XmlDocument doc = new XmlDocument(); doc.LoadXml(YbnXml.GetXml(yb));
            XmlElement root = doc.SelectSingleNode("/BoundsFile/Bounds") as XmlElement; if (root == null) throw new Exception("Could not read " + rel + ".");
            bool composite = root.GetAttribute("type") == "Composite";
            List<XmlElement> kids = new List<XmlElement>(); if (composite) foreach (XmlNode n in root.SelectNodes("Children/Item")) kids.Add((XmlElement)n);
            // pieces out: by top child and polygon (polygon -1: the whole child)
            int removed = 0; HashSet<string> gone = new HashSet<string>();
            foreach (object o in J.A(J.G(spec, "deletes"))) { List<object> d = J.A(o); if (d.Count >= 2) gone.Add(J.I(d[0], -1) + "|" + J.I(d[1], -1)); }
            Dictionary<XmlElement, List<XmlNode>> drop = new Dictionary<XmlElement, List<XmlNode>>(); List<XmlElement> dropKids = new List<XmlElement>();
            foreach (string g in gone)
            {
                string[] p = g.Split('|'); int ch = int.Parse(p[0]), pi = int.Parse(p[1]);
                XmlElement geo = composite ? (ch >= 0 && ch < kids.Count ? kids[ch] : null) : root; if (geo == null) continue;
                if (pi < 0) { if (composite && !dropKids.Contains(geo)) { dropKids.Add(geo); removed++; } continue; }
                XmlElement polys = geo.SelectSingleNode("Polygons") as XmlElement; if (polys == null) continue;
                List<XmlNode> items = new List<XmlNode>(); foreach (XmlNode n in polys.ChildNodes) if (n is XmlElement) items.Add(n);
                if (pi >= items.Count) continue; List<XmlNode> l; if (!drop.TryGetValue(geo, out l)) drop[geo] = l = new List<XmlNode>(); if (!l.Contains(items[pi])) { l.Add(items[pi]); removed++; }
            }
            foreach (KeyValuePair<XmlElement, List<XmlNode>> kv in drop)
            {
                XmlElement polys = kv.Key.SelectSingleNode("Polygons") as XmlElement; foreach (XmlNode n in kv.Value) polys.RemoveChild(n);
                bool empty = true; foreach (XmlNode n in polys.ChildNodes) if (n is XmlElement) { empty = false; break; }
                if (empty && composite && !dropKids.Contains(kv.Key)) dropKids.Add(kv.Key);
            }
            foreach (XmlElement k in dropKids) k.ParentNode.RemoveChild(k);
            // boxes in: given in the world; an interior's collision gets them in its own space (by the placement nearest to the box)
            List<object> adds = J.A(J.G(spec, "add")); int added = 0;
            if (adds.Count > 0)
            {
                if (!composite)
                {
                    // the file is one shape: it becomes a composite with that shape as its first child
                    XmlElement nroot = doc.CreateElement("Bounds"); nroot.SetAttribute("type", "Composite");
                    foreach (string tag in new string[] { "BoxMin", "BoxMax", "BoxCenter", "SphereCenter", "SphereRadius", "Margin", "Volume", "Inertia", "MaterialIndex", "MaterialColourIndex", "ProceduralID", "RoomID", "PedDensity", "UnkFlags", "PolyFlags", "UnkType" }) { XmlNode n = root.SelectSingleNode(tag); if (n != null) nroot.AppendChild(n.CloneNode(true)); }
                    XmlElement ch0 = doc.CreateElement("Children"), it = doc.CreateElement("Item"); it.SetAttribute("type", root.GetAttribute("type"));
                    foreach (XmlNode n in root.ChildNodes) it.AppendChild(n.CloneNode(true));
                    it.AppendChild(Tagged(doc, "CompositeTransform", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1")); it.AppendChild(Tagged(doc, "CompositeFlags1", Flags1)); it.AppendChild(Tagged(doc, "CompositeFlags2", Flags2));
                    ch0.AppendChild(it); nroot.AppendChild(ch0); root.ParentNode.ReplaceChild(nroot, root); root = nroot; composite = true;
                }
                List<Xf> places = new List<Xf>(); bool interior = false;
                foreach (SrvMlo m in sr.Mlos) if (m.Bounds.Contains(sf.Name)) { interior = true; foreach (SrvRes r2 in rs) foreach (SrvPlace p in r2.Places) if (p.Hash == m.Hash) places.Add(new Xf(p.R, p.P)); }
                XmlElement children = root.SelectSingleNode("Children") as XmlElement; if (children == null) { children = doc.CreateElement("Children"); root.AppendChild(children); }
                V3 bmn = Vec(root, "BoxMin"), bmx = Vec(root, "BoxMax");
                foreach (object ao in adds)
                {
                    Dictionary<string, object> ad = J.O(ao); List<object> a0 = J.A(J.G(ad, "min")), a1 = J.A(J.G(ad, "max")); if (a0.Count < 3 || a1.Count < 3) continue;
                    V3 w0 = new V3(J.D(a0[0], 0), J.D(a0[1], 0), J.D(a0[2], 0)), w1 = new V3(J.D(a1[0], 0), J.D(a1[1], 0), J.D(a1[2], 0)), wc = (w0 + w1) * 0.5;
                    Xf toFile = Xf.Identity;
                    if (interior && places.Count > 0) { Xf best = places[0]; foreach (Xf pl in places) if ((pl.T - wc).Len() < (best.T - wc).Len()) best = pl; toFile = best.Inverse(); }
                    List<V3> cs = new List<V3>(); for (int i = 0; i < 8; i++) cs.Add(toFile.Apply(new V3((i & 1) == 0 ? w0.X : w1.X, (i & 2) == 0 ? w0.Y : w1.Y, (i & 4) == 0 ? w0.Z : w1.Z)));
                    foreach (V3 v in cs) { bmn = new V3(Math.Min(bmn.X, v.X), Math.Min(bmn.Y, v.Y), Math.Min(bmn.Z, v.Z)); bmx = new V3(Math.Max(bmx.X, v.X), Math.Max(bmx.Y, v.Y), Math.Max(bmx.Z, v.Z)); }
                    int room = J.I(J.G(ad, "room"), interior ? 1 : 0), type = J.I(J.G(ad, "material"), 1);
                    children.AppendChild(BoxChild(doc, cs, type, room)); added++;
                }
                SetVec(root, "BoxMin", bmn); SetVec(root, "BoxMax", bmx); SetVec(root, "BoxCenter", (bmn + bmx) * 0.5); SetVec(root, "SphereCenter", (bmn + bmx) * 0.5);
                XmlElement sr2 = root.SelectSingleNode("SphereRadius") as XmlElement; if (sr2 != null) sr2.SetAttribute("value", Fs((bmx - bmn).Len() * 0.5));
            }
            if (removed == 0 && added == 0) throw new Exception("Nothing to change in " + rel + ".");
            YbnFile fixd = XmlYbn.GetYbn(doc); byte[] bytes = fixd.Save();
            string dir = Path.Combine(outRoot, sr.Name + "_collision_fix"), target = Path.Combine(dir, sf.Rel.Replace('\\', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(target)); File.WriteAllBytes(target, bytes);
            string readme = Path.Combine(dir, "README.md"), line = "- `" + sf.Rel + "`: " + removed + " piece(s) taken out, " + added + " box(es) added (" + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + ")\n";
            if (!File.Exists(readme)) File.WriteAllText(readme, "# Collision fixes for " + sr.Name + "\n\nMade by MLO Creator (Server and world). Copy each file over the one with the same path in the resource `" + sr.Name + "` (keep a copy of the original), then restart the resource.\n\n");
            File.AppendAllText(readme, line);
            Dictionary<string, object> ok = new Dictionary<string, object>(); ok["ok"] = true; ok["dir"] = dir; ok["file"] = target; ok["removed"] = removed; ok["added"] = added; ok["bytes"] = bytes.Length; return ok;
        }
        const string Flags1 = "MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE";
        const string Flags2 = "UNKNOWN, MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, OBJECT_ENV_CLOTH, PLANT, PROJECTILE, EXPLOSION, PICKUP, FOLIAGE, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS, MAP_RIVER, SMOKE, UNSMASHED, MAP_STAIRS, MAP_DEEP_SURFACE";
        static string Fs(double v) { return v.ToString("0.####", CultureInfo.InvariantCulture); }
        static XmlElement Tagged(XmlDocument d, string tag, string text) { XmlElement e = d.CreateElement(tag); e.InnerText = text; return e; }
        static V3 Vec(XmlElement p, string tag)
        {
            XmlElement e = p.SelectSingleNode(tag) as XmlElement; if (e == null) return new V3(1e9, 1e9, 1e9);
            Func<string, double> D = delegate (string a) { double v; double.TryParse(e.GetAttribute(a), NumberStyles.Float, CultureInfo.InvariantCulture, out v); return v; };
            return new V3(D("x"), D("y"), D("z"));
        }
        static void SetVec(XmlElement p, string tag, V3 v) { XmlElement e = p.SelectSingleNode(tag) as XmlElement; if (e == null) return; e.SetAttribute("x", Fs(v.X)); e.SetAttribute("y", Fs(v.Y)); e.SetAttribute("z", Fs(v.Z)); }
        static string VecXml(string tag, V3 v) { return "<" + tag + " x=\"" + Fs(v.X) + "\" y=\"" + Fs(v.Y) + "\" z=\"" + Fs(v.Z) + "\" />"; }
        // a box as a child of its own: 8 corners (in the file's space, turned like the placement), 12 triangles wound outwards
        static XmlElement BoxChild(XmlDocument d, List<V3> c, int type, int room)
        {
            V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9); foreach (V3 v in c) { mn = new V3(Math.Min(mn.X, v.X), Math.Min(mn.Y, v.Y), Math.Min(mn.Z, v.Z)); mx = new V3(Math.Max(mx.X, v.X), Math.Max(mx.Y, v.Y), Math.Max(mx.Z, v.Z)); }
            V3 ctr = (mn + mx) * 0.5; StringBuilder s = new StringBuilder();
            s.Append("<Item type=\"GeometryBVH\">" + VecXml("BoxMin", mn) + VecXml("BoxMax", mx) + VecXml("BoxCenter", ctr) + VecXml("SphereCenter", ctr) + "<SphereRadius value=\"" + Fs((mx - mn).Len() * 0.5) + "\" /><Margin value=\"0.04\" /><Volume value=\"1\" /><Inertia x=\"1\" y=\"1\" z=\"1\" /><MaterialIndex value=\"0\" /><MaterialColourIndex value=\"0\" /><ProceduralID value=\"0\" /><RoomID value=\"" + room + "\" /><PedDensity value=\"0\" /><UnkFlags value=\"0\" /><PolyFlags value=\"0\" /><UnkType value=\"1\" />");
            s.Append("<CompositeTransform>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</CompositeTransform><CompositeFlags1>" + Flags1 + "</CompositeFlags1><CompositeFlags2>" + Flags2 + "</CompositeFlags2>");
            s.Append(VecXml("GeometryCenter", new V3(0, 0, 0)) + "<UnkFloat1 value=\"0\" /><UnkFloat2 value=\"0\" /><Materials><Item><Type value=\"" + type + "\" /><ProceduralID value=\"0\" /><RoomID value=\"" + room + "\" /><PedDensity value=\"0\" /><Flags>NONE</Flags><MaterialColourIndex value=\"0\" /><Unk value=\"0\" /></Item></Materials><Vertices>");
            foreach (V3 v in c) s.Append(Fs(v.X) + ", " + Fs(v.Y) + ", " + Fs(v.Z) + "\n");
            s.Append("</Vertices><Polygons>");
            int[][] q = new int[][] { new int[] { 1, 3, 7, 5 }, new int[] { 0, 4, 6, 2 }, new int[] { 2, 6, 7, 3 }, new int[] { 0, 1, 5, 4 }, new int[] { 4, 5, 7, 6 }, new int[] { 0, 2, 3, 1 } };          // (corner i: x from bit 0, y bit 1, z bit 2)
            foreach (int[] f in q)
            {
                s.Append("<Triangle m=\"0\" v1=\"" + f[0] + "\" v2=\"" + f[1] + "\" v3=\"" + f[2] + "\" f1=\"0\" f2=\"0\" f3=\"0\" />");
                s.Append("<Triangle m=\"0\" v1=\"" + f[0] + "\" v2=\"" + f[2] + "\" v3=\"" + f[3] + "\" f1=\"0\" f2=\"0\" f3=\"0\" />");
            }
            s.Append("</Polygons></Item>");
            XmlDocument t = new XmlDocument(); t.LoadXml(s.ToString()); return (XmlElement)d.ImportNode(t.DocumentElement, true);
        }

        static Dictionary<string, MloArchetype> mloCache = new Dictionary<string, MloArchetype>();
        static MloArchetype FindMlo(List<SrvRes> rs, uint hash)
        {
            foreach (SrvRes sr in rs) foreach (SrvMlo m in sr.Mlos)
                {
                    if (m.Hash != hash) continue; string path = Path.Combine(sr.Dir, m.File), k = path + "|" + hash; MloArchetype ma;
                    if (mloCache.TryGetValue(k, out ma)) return ma;
                    try { YtypFile y = new YtypFile(); y.Load(File.ReadAllBytes(path)); foreach (Archetype a in y.AllArchetypes) if (a != null && a.Hash.Hash == hash) { ma = a as MloArchetype; break; } } catch (Exception) { }
                    mloCache[k] = ma; return ma;
                }
            return null;
        }

        // for tests: run now, on this thread
        public static Dictionary<string, object> LoadNow(Dictionary<string, object> spec, string gta, string cache) { return Load(spec, gta, cache); }
    }
}
