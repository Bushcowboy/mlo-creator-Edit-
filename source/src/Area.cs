// An area of the world in 3D: the game's buildings around a spot, your server's MLOs and map entities there (their models from your resources' stream files,
// or the game's), and the collision of both, so that MLOs that clash with each other or with the map can be seen. Coordinates are sent relative to the
// spot (float precision). Encrypted files are never opened. Runs as one background job at a time. C# 5.
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
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
                foreach (KeyValuePair<int, List<float>> kv in by) { Dictionary<string, object> g = new Dictionary<string, object>(); g["name"] = groups[kv.Key].Entity; g["color"] = groups[kv.Key].Color; g["pos"] = B64(kv.Value); gl.Add(g); }
                res["game"] = gl;
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
                        List<float> ct = new List<float>(), cb = new List<float>(); List<string> used = new List<string>();
                        foreach (SrvFile f in sr.Files)
                        {
                            if (f.Ext != ".ybn" || f.State != "ok" || count > ColMax) continue;
                            YbnFile yb = new YbnFile(); try { yb.Load(File.ReadAllBytes(Path.Combine(sr.Dir, f.Rel))); } catch (Exception) { continue; }
                            if (yb.Bounds == null) continue;
                            // an interior's collision: moved by every placement of that MLO; else the file is in world space
                            List<Xf> places = new List<Xf>(); bool interior = false;
                            foreach (SrvMlo m in sr.Mlos) if (m.Bounds.Contains(f.Name)) { interior = true; foreach (SrvRes r2 in rs) foreach (SrvPlace p in r2.Places) if (p.Hash == m.Hash) places.Add(new Xf(p.R, p.P)); }
                            if (!interior) places.Add(Xf.Identity);
                            int before = ct.Count + cb.Count;
                            foreach (Xf pl in places) Walk(yb.Bounds, pl, Matrix.Identity, c, win, ct, cb, ref count);
                            if (ct.Count + cb.Count > before) used.Add(f.Name + (interior ? " (interior, " + places.Count + " placement" + (places.Count == 1 ? "" : "s") + ")" : ""));
                        }
                        if (used.Count == 0) continue;
                        Dictionary<string, object> o = new Dictionary<string, object>(); o["source"] = sr.Name; o["tris"] = B64(ct); o["boxes"] = B64(cb); o["files"] = used; cols.Add(o);
                        log.Add(sr.Name + " collision: " + string.Join(", ", used.ToArray()));
                    }
                if (count > ColMax) warns.Add("The collision was cut at " + ColMax + " pieces: make the area smaller.");
                res["collision"] = cols;
            }
            res["ok"] = true; res["log"] = log; res["warnings"] = warns;
            return res;
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
