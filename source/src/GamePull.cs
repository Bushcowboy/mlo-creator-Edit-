// Pulls a building out of the game into a project, with everything the import needs: its model, the texture files it uses (its archetype's texture
// dictionary and that one's parents, from the game's gtxd files), the map file that places it, its detail models (with their texture files), the
// collision files around it and the occlusion files with boxes near it. The game is read through CodeWalker's library (IGameFiles: the real game,
// or a folder of files for the tests). C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace MloCreator
{
    // the game's files, by name
    public interface IGameFiles
    {
        byte[] File(string name);                                   // a file whole, as it would lie on disk (resource header, compressed); null: the game has none
        string Archive(string name);                                // the archive that holds it ("" when none)
        List<string> InArchive(string archive);                     // the file names of an archive
        List<string> Names(string ext);                             // every file name with that extension
        List<string> MapsInBox(double x0, double y0, double x1, double y1);      // map files whose entities reach into a box
        List<byte[]> All(string fileName);                          // every file of that name in every archive (gtxd.meta as text)
        List<YmtFile> Ymts(string fileName);                        // every file of that name read as CodeWalker reads meta files (gtxd.ymt, binary gtxd.meta)
        YmapFile Ymap(string name); YtypFile Ytyp(string name); YbnFile Ybn(string name); YdrFile Ydr(string name);
    }

    // the game itself (GTA V's archives, through Vanilla)
    public class VanillaFiles : IGameFiles
    {
        static string K(string n) { return (n ?? "").ToLowerInvariant(); }
        public byte[] File(string name)
        {
            RpfFile owner; RpfFileEntry e = Vanilla.GetEntry(K(name), out owner); if (e == null) return null;
            byte[] data = owner.ExtractFile(e); RpfResourceFileEntry rre = e as RpfResourceFileEntry;
            return rre != null ? ResourceBuilder.AddResourceHeader(rre, ResourceBuilder.Compress(data)) : data;
        }
        public string Archive(string name) { RpfFile owner; return Vanilla.GetEntry(K(name), out owner) == null ? "" : owner.Path; }
        public List<string> InArchive(string archive)
        {
            List<string> l = new List<string>();
            foreach (RpfFile rf in Vanilla.Manager.AllRpfs) { if (rf.Path != archive || rf.AllEntries == null) continue; foreach (RpfEntry e in rf.AllEntries) if (e is RpfFileEntry) l.Add(K(e.Name)); }
            return l;
        }
        public List<string> Names(string ext) { return Vanilla.Names(ext); }
        public List<string> MapsInBox(double x0, double y0, double x1, double y1) { return Vanilla.MapsInBox(x0, y0, x1, y1); }
        public List<byte[]> All(string fileName)
        {
            List<byte[]> l = new List<byte[]>();
            foreach (RpfFile rf in Vanilla.Manager.AllRpfs)
            {
                if (rf.AllEntries == null) continue;
                foreach (RpfEntry e in rf.AllEntries)
                {
                    RpfFileEntry fe = e as RpfFileEntry; if (fe == null || !fe.Name.Equals(fileName, StringComparison.OrdinalIgnoreCase)) continue;
                    try { byte[] d = rf.ExtractFile(fe); RpfResourceFileEntry rre = fe as RpfResourceFileEntry; l.Add(rre != null ? ResourceBuilder.AddResourceHeader(rre, ResourceBuilder.Compress(d)) : d); } catch (Exception) { }
                }
            }
            return l;
        }
        public List<YmtFile> Ymts(string fileName)
        {
            List<YmtFile> l = new List<YmtFile>();
            foreach (RpfFile rf in Vanilla.Manager.AllRpfs)
            {
                if (rf.AllEntries == null) continue;
                foreach (RpfEntry e in rf.AllEntries)
                {
                    RpfFileEntry fe = e as RpfFileEntry; if (fe == null || !fe.Name.Equals(fileName, StringComparison.OrdinalIgnoreCase)) continue;
                    try { YmtFile y = new YmtFile(); y.Load(rf.ExtractFile(fe), fe); l.Add(y); } catch (Exception) { }          // (with its entry, like CodeWalker's own game cache: a gtxd.ymt is not a resource file)
                }
            }
            return l;
        }
        // (parsed straight from the archive: no compressing again)
        T Load<T>(string name, Action<T, byte[], RpfFileEntry> load) where T : class, new()
        {
            RpfFile owner; RpfFileEntry e = Vanilla.GetEntry(K(name), out owner); if (e == null) return null;
            try { T f = new T(); load(f, owner.ExtractFile(e), e); return f; } catch (Exception) { return null; }
        }
        public YmapFile Ymap(string name) { return Load<YmapFile>(name, delegate (YmapFile f, byte[] d, RpfFileEntry e) { f.Load(d, e); }); }
        public YtypFile Ytyp(string name) { return Load<YtypFile>(name, delegate (YtypFile f, byte[] d, RpfFileEntry e) { f.Load(d, e); }); }
        public YbnFile Ybn(string name) { return Load<YbnFile>(name, delegate (YbnFile f, byte[] d, RpfFileEntry e) { f.Load(d, e); }); }
        public YdrFile Ydr(string name) { return Load<YdrFile>(name, delegate (YdrFile f, byte[] d, RpfFileEntry e) { f.Load(d, e); }); }
    }

    // a folder of game files: every folder under it is an archive (for the tests, or files exported with CodeWalker or OpenIV)
    public class FolderFiles : IGameFiles
    {
        readonly Dictionary<string, string> path = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, List<string>> all = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        public FolderFiles(string root)
        {
            foreach (string f in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
            {
                string n = Path.GetFileName(f).ToLowerInvariant(); path[n] = f;
                List<string> l; if (!all.TryGetValue(n, out l)) all[n] = l = new List<string>(); l.Add(f);
            }
        }
        public byte[] File(string name) { string p; return path.TryGetValue(name ?? "", out p) ? System.IO.File.ReadAllBytes(p) : null; }
        public string Archive(string name) { string p; return path.TryGetValue(name ?? "", out p) ? Path.GetDirectoryName(p) : ""; }
        public List<string> InArchive(string archive) { List<string> l = new List<string>(); if (Directory.Exists(archive)) foreach (string f in Directory.GetFiles(archive)) l.Add(Path.GetFileName(f).ToLowerInvariant()); return l; }
        public List<string> Names(string ext) { List<string> l = new List<string>(); foreach (string n in path.Keys) if (n.EndsWith(ext, StringComparison.OrdinalIgnoreCase)) l.Add(n); l.Sort(StringComparer.Ordinal); return l; }
        public List<string> MapsInBox(double x0, double y0, double x1, double y1)
        {
            List<string> l = new List<string>();
            foreach (string n in Names(".ymap"))
            {
                YmapFile y = Ymap(n); if (y == null) continue; Vector3 a = y.CMapData.entitiesExtentsMin, b = y.CMapData.entitiesExtentsMax;
                if (x1 >= a.X - 2 && x0 <= b.X + 2 && y1 >= a.Y - 2 && y0 <= b.Y + 2) l.Add(n);
            }
            return l;
        }
        public List<byte[]> All(string fileName) { List<byte[]> r = new List<byte[]>(); List<string> l; if (all.TryGetValue(fileName ?? "", out l)) foreach (string f in l) r.Add(System.IO.File.ReadAllBytes(f)); return r; }
        public List<YmtFile> Ymts(string fileName)
        {
            List<YmtFile> r = new List<YmtFile>();
            foreach (byte[] b in All(fileName)) { try { RpfBinaryFileEntry e = new RpfBinaryFileEntry(); e.Name = fileName; e.NameLower = fileName.ToLowerInvariant(); YmtFile y = new YmtFile(); y.Load(b, e); r.Add(y); } catch (Exception) { } }
            return r;
        }
        T Load<T>(string name, Action<T, byte[]> load) where T : class, new() { byte[] d = File(name); if (d == null) return null; try { T f = new T(); load(f, d); return f; } catch (Exception) { return null; } }
        public YmapFile Ymap(string name) { return Load<YmapFile>(name, delegate (YmapFile f, byte[] d) { f.Load(d); }); }
        public YtypFile Ytyp(string name) { return Load<YtypFile>(name, delegate (YtypFile f, byte[] d) { f.Load(d); }); }
        public YbnFile Ybn(string name) { return Load<YbnFile>(name, delegate (YbnFile f, byte[] d) { f.Load(d); }); }
        public YdrFile Ydr(string name) { return Load<YdrFile>(name, delegate (YdrFile f, byte[] d) { f.Load(d); }); }
    }

    public static class GamePull
    {
        static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }
        static string Stem(string n) { n = Path.GetFileName(n ?? "").Trim().ToLowerInvariant(); foreach (string ext in new string[] { ".ydr", ".yft", ".ydd" }) if (n.EndsWith(ext)) n = n.Substring(0, n.Length - ext.Length); return n; }
        // the block a model belongs to by name: "dt1_02" for "dt1_02_build1"
        public static string Prefix(string stem) { string[] p = stem.Split('_'); return p.Length >= 2 ? p[0] + "_" + p[1] : stem; }
        public static string NameOf(uint h) { string s = JenkIndex.TryGetString(h); return string.IsNullOrEmpty(s) ? null : s.ToLowerInvariant(); }
        static readonly System.Text.RegularExpressions.Regex Lod = new System.Text.RegularExpressions.Regex("(_lod\\d*$|^slod|_slod|^lod_|_proxy|_shadow)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        // ---- the archetype of a model (its texture dictionary): the type file the game's list names, else the type files of the model's own archive ----
        public static Func<uint, string> YtypOf = delegate (uint h) { return Interiors.YtypOf(h); };
        static Dictionary<string, YtypFile> ytyps = new Dictionary<string, YtypFile>();
        static Archetype FindArchetype(IGameFiles g, string stem, string archive, out string ytypName)
        {
            uint h = JenkHash.GenHash(stem); ytypName = null; List<string> look = new List<string>();
            string listed = YtypOf(h); if (listed != null) look.Add(listed.ToLowerInvariant() + ".ytyp");
            if (!string.IsNullOrEmpty(archive)) foreach (string n in g.InArchive(archive)) if (n.EndsWith(".ytyp") && !look.Contains(n)) look.Add(n);
            string pre = Prefix(stem) + ".ytyp"; if (!look.Contains(pre)) look.Add(pre);
            foreach (string yn in look)
            {
                YtypFile y; if (!ytyps.TryGetValue(yn, out y)) { y = g.Ytyp(yn); ytyps[yn] = y; }
                if (y == null || y.AllArchetypes == null) continue;
                foreach (Archetype a in y.AllArchetypes) if (a != null && a.Hash.Hash == h) { ytypName = yn; return a; }
            }
            return null;
        }
        // child texture dictionary -> its parent, from every gtxd file of the game (gtxd.ymt, and gtxd.meta of the packs)
        static Dictionary<string, string> parents;
        public static void ResetCaches() { parents = null; ytyps.Clear(); }
        static Dictionary<string, string> Parents(IGameFiles g)
        {
            if (parents != null) return parents; Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string fn in new string[] { "gtxd.ymt", "gtxd.meta" })
                foreach (YmtFile y in g.Ymts(fn)) if (y.CMapParentTxds != null) foreach (KeyValuePair<string, string> kv in y.CMapParentTxds) d[kv.Key] = kv.Value;
            foreach (byte[] b in g.All("gtxd.meta"))
            {
                try
                {
                    string t = Encoding.UTF8.GetString(b); if (t.IndexOf('<') < 0) continue; XmlDocument x = new XmlDocument(); x.LoadXml(t.Substring(t.IndexOf('<')));
                    foreach (XmlNode it in x.SelectNodes("//txdRelationships/Item")) { XmlNode c = it.SelectSingleNode("child"), p = it.SelectSingleNode("parent"); if (c != null && p != null && c.InnerText.Trim().Length > 0) d[c.InnerText.Trim()] = p.InnerText.Trim(); }
                }
                catch (Exception) { }
            }
            parents = d; return d;
        }
        // the texture files a model needs: its archetype's dictionary and that one's parents (or, without an archetype, a file of its own name or the
        // texture file of its archive that holds most of the textures its shaders use)
        static List<string> TexturesOf(IGameFiles g, string stem, YdrFile ydr, List<string> why)
        {
            List<string> l = new List<string>(); string archive = g.Archive(stem + ".ydr"), yt; Archetype a = FindArchetype(g, stem, archive, out yt);
            string txd = null;
            if (a != null && a.TextureDict.Hash != 0)
            {
                txd = NameOf(a.TextureDict.Hash);
                if (txd == null) foreach (string n in g.InArchive(archive)) if (n.EndsWith(".ytd") && JenkHash.GenHash(n.Substring(0, n.Length - 4)) == a.TextureDict.Hash) { txd = n.Substring(0, n.Length - 4); break; }
                if (txd != null) why.Add("the texture dictionary of its archetype (" + yt + ")");
            }
            if (txd == null && g.File(stem + ".ytd") != null) { txd = stem; why.Add("a texture file of its own name"); }
            if (txd == null && ydr != null && ydr.Drawable != null)
            {
                // the archive's texture file with most of the model's textures
                HashSet<string> want = new HashSet<string>();
                try { foreach (ShaderFX sh in ydr.Drawable.ShaderGroup.Shaders.data_items) { if (sh == null || sh.ParametersList == null) continue; foreach (ShaderParameter sp in sh.ParametersList.Parameters) { TextureBase tb = sp.Data as TextureBase; if (tb != null && !(tb is Texture) && !string.IsNullOrEmpty(tb.Name)) want.Add(tb.Name.ToLowerInvariant()); } } } catch (Exception) { }
                int best = 0;
                if (want.Count > 0) foreach (string n in g.InArchive(archive))
                    {
                        if (!n.EndsWith(".ytd")) continue; byte[] b = g.File(n); if (b == null) continue; int hit = 0;
                        try { YtdFile y = new YtdFile(); y.Load(b); if (y.TextureDict != null && y.TextureDict.Textures != null) foreach (Texture t in y.TextureDict.Textures.data_items) if (want.Contains((t.Name ?? "").ToLowerInvariant())) hit++; } catch (Exception) { }
                        if (hit > best) { best = hit; txd = n.Substring(0, n.Length - 4); }
                    }
                if (txd != null) why.Add("the texture file of its archive with " + best + " of its textures");
            }
            Dictionary<string, string> par = Parents(g); int guard = 0;
            while (txd != null && guard++ < 8 && !l.Contains(txd))
            {
                if (g.File(txd + ".ytd") != null) l.Add(txd);
                string p; txd = par.TryGetValue(txd, out p) ? p.ToLowerInvariant() : null;
            }
            return l;
        }

        static Dictionary<string, object> EntityJson(string ymap, YmapEntityDef en)
        {
            Quaternion q = en.Orientation; Dictionary<string, object> e = new Dictionary<string, object>();
            e["ymap"] = ymap; e["x"] = en.Position.X; e["y"] = en.Position.Y; e["z"] = en.Position.Z; e["heading"] = 2 * Math.Atan2(q.Z, q.W) * 180 / Math.PI;
            e["qx"] = q.X; e["qy"] = q.Y; e["qz"] = q.Z; e["qw"] = q.W; e["scale"] = en.Scale.X; e["tilted"] = Math.Abs(q.X) > 0.002 || Math.Abs(q.Y) > 0.002;
            return e;
        }
        // an entity's world box from its model's box
        static double[] WorldBox(YmapEntityDef en, Vector3 mn, Vector3 mx)
        {
            double[] r = new double[] { 1e30, 1e30, 1e30, -1e30, -1e30, -1e30 }; float s = en.Scale.X == 0 ? 1 : en.Scale.X, sz = en.Scale.Z == 0 ? 1 : en.Scale.Z;
            for (int i = 0; i < 8; i++)
            {
                Vector3 c = new Vector3(((i & 1) == 0 ? mn.X : mx.X) * s, ((i & 2) == 0 ? mn.Y : mx.Y) * s, ((i & 4) == 0 ? mn.Z : mx.Z) * sz), w = Vector3.Transform(c, en.Orientation) + en.Position;
                r[0] = Math.Min(r[0], w.X); r[1] = Math.Min(r[1], w.Y); r[2] = Math.Min(r[2], w.Z); r[3] = Math.Max(r[3], w.X); r[4] = Math.Max(r[4], w.Y); r[5] = Math.Max(r[5], w.Z);
            }
            return r;
        }
        static bool Touch(double[] a, double[] b, double m) { return a[3] + m >= b[0] && a[0] - m <= b[3] && a[4] + m >= b[1] && a[1] - m <= b[4] && a[5] + m >= b[2] && a[2] - m <= b[5]; }

        // where the game places a model: the map file named (the placement nearest to x, y), else every map file, the block's own first
        public static List<object> Find(IGameFiles g, string model, string ymap, double x, double y, bool near, int max)
        {
            string stem = Stem(model); uint h = JenkHash.GenHash(stem); List<object> list = new List<object>(); List<string> maps = new List<string>();
            if (!string.IsNullOrEmpty(ymap)) maps.Add(Path.GetFileName(ymap).ToLowerInvariant().EndsWith(".ymap") ? Path.GetFileName(ymap).ToLowerInvariant() : Path.GetFileName(ymap).ToLowerInvariant() + ".ymap");
            else
            {
                string pre = Prefix(stem); List<string> rest = new List<string>();
                if (near) foreach (string m in g.MapsInBox(x - 5, y - 5, x + 5, y + 5)) if (!maps.Contains(m)) maps.Add(m);
                foreach (string m in g.Names(".ymap")) { if (m.IndexOf("occl", StringComparison.Ordinal) >= 0 || Lod.IsMatch(m.Replace(".ymap", "")) || maps.Contains(m)) continue; if (m.StartsWith(pre)) maps.Add(m); else rest.Add(m); }
                maps.AddRange(rest);
            }
            int n = 0;
            foreach (string mn in maps)
            {
                n++; if (n % 300 == 0) Vanilla.Status = "Looking for " + stem + " in the game's map files: " + n + " / " + maps.Count;
                YmapFile ym = g.Ymap(mn); if (ym == null || ym.AllEntities == null) continue;
                foreach (YmapEntityDef en in ym.AllEntities) if (en != null && en.CEntityDef.archetypeName.Hash == h) list.Add(EntityJson(mn, en));
                if (list.Count > 0 && (near || !string.IsNullOrEmpty(ymap) || list.Count >= max)) break;          // (the block's own map files come first: one that places it is enough)
            }
            Vanilla.Status = "";
            if (near) list.Sort(delegate (object a, object b) { Dictionary<string, object> p = (Dictionary<string, object>)a, q = (Dictionary<string, object>)b; double da = Math.Pow(J.D(p["x"], 0) - x, 2) + Math.Pow(J.D(p["y"], 0) - y, 2), db = Math.Pow(J.D(q["x"], 0) - x, 2) + Math.Pow(J.D(q["y"], 0) - y, 2); return da.CompareTo(db); });
            if (list.Count > max) list.RemoveRange(max, list.Count - max);
            return list;
        }

        // ---- a rough map of the city (cells of 25 m: how many detailed map files cover each), made once in the background ----
        static Dictionary<string, object> grid; static System.Threading.Thread gridJob; static string gridErr = "";
        public static Dictionary<string, object> MapGrid(string gta, string cache, bool start)
        {
            Dictionary<string, object> r = new Dictionary<string, object>();
            if (grid != null) { foreach (KeyValuePair<string, object> kv in grid) r[kv.Key] = kv.Value; r["ready"] = true; return r; }
            bool cached = File.Exists(Path.Combine(cache, "ymap_index.txt"));
            if (start && gridErr.Length > 0 && (gridJob == null || !gridJob.IsAlive)) gridErr = "";          // (asked again after an error: try again)
            if ((start || cached) && (gridJob == null || !gridJob.IsAlive) && gridErr.Length == 0)
            {
                gridJob = new System.Threading.Thread(delegate ()
                {
                    try
                    {
                        Vanilla.Init(gta, cache); double ox, oy; int w, h; byte[] g = Vanilla.MapDensity(25, out ox, out oy, out w, out h);
                        Dictionary<string, object> d = new Dictionary<string, object>(); d["cell"] = 25; d["ox"] = ox; d["oy"] = oy; d["w"] = w; d["h"] = h; d["grid"] = Convert.ToBase64String(g); grid = d;
                    }
                    catch (Exception ex) { gridErr = ex.Message; }
                });
                gridJob.IsBackground = true; gridJob.Start();
            }
            r["ready"] = false; r["busy"] = gridJob != null && gridJob.IsAlive; r["status"] = Vanilla.Status; r["error"] = gridErr; r["cached"] = cached;
            return r;
        }

        // ---- the pull ----
        // spec: name (the model), ymap / x y (which placement; the nearest one), what: { textures, map, details, collision, occlusion } (all on by default)
        public static Dictionary<string, object> Run(IGameFiles g, string dir, Dictionary<string, object> spec)
        {
            string stem = Stem(J.S(J.G(spec, "name"), "")); if (stem.Length == 0) throw new Exception("Which model? Give the building's model name.");
            Dictionary<string, object> what = J.O(J.G(spec, "what")); Func<string, bool> want = delegate (string k) { return J.B(J.G(what, k), true); };
            List<object> added = new List<object>(), had = new List<object>(); List<string> warns = new List<string>(), log = new List<string>(); HashSet<string> done = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Directory.CreateDirectory(dir);
            Action<string, string> put = delegate (string file, string why)
            {
                file = file.ToLowerInvariant(); if (!done.Add(file)) return;
                string to = Path.Combine(dir, file); byte[] b = g.File(file); if (b == null) { warns.Add(file + " is not in the game files."); return; }
                Dictionary<string, object> it = new Dictionary<string, object>(); it["name"] = file; it["why"] = why; it["bytes"] = b.Length;
                if (System.IO.File.Exists(to) && new FileInfo(to).Length == b.Length) { had.Add(it); return; }
                System.IO.File.WriteAllBytes(to, b); added.Add(it);
            };

            // 1. the model
            Vanilla.Status = "Reading " + stem + "...";
            YdrFile ydr = g.Ydr(stem + ".ydr");
            if (ydr == null || ydr.Drawable == null)
            {
                string arch0 = g.Archive(stem + ".yft"), yt0; Archetype a0 = FindArchetype(g, stem, arch0.Length > 0 ? arch0 : g.Archive(Prefix(stem) + ".ytyp"), out yt0);
                if (g.File(stem + ".yft") != null) throw new Exception(stem + " is a fragment model (.yft): MLO Creator imports plain models (.ydr) as buildings.");
                if (a0 != null && a0.DrawableDict.Hash != 0) throw new Exception(stem + " is in a drawable dictionary (" + (NameOf(a0.DrawableDict.Hash) ?? "a .ydd") + "): MLO Creator imports plain models (.ydr) as buildings.");
                throw new Exception("The game files have no model called " + stem + ".");
            }
            put(stem + ".ydr", "the building's model");
            if (want("textures"))
            {
                List<string> why = new List<string>(), tl = TexturesOf(g, stem, ydr, why);
                for (int i = 0; i < tl.Count; i++) put(tl[i] + ".ytd", i == 0 ? "the building's textures (" + (why.Count > 0 ? why[0] : "") + ")" : "the parent texture dictionary of " + tl[i - 1] + " (shared textures it uses)");
                if (tl.Count == 0) warns.Add("No texture file was found for " + stem + ": its textures are inside the model, or in a file the game shares (they show in plain colours in the editor; the game still has them).");
            }

            // 2. where it stands
            object xo = J.G(spec, "x"); double px = J.D(xo, 0), py = J.D(J.G(spec, "y"), 0); string ym = J.S(J.G(spec, "ymap"), "");
            List<object> places = Find(g, stem, ym, px, py, xo != null, 20);
            Dictionary<string, object> ent = places.Count > 0 ? (Dictionary<string, object>)places[0] : null;
            if (ent == null) warns.Add("No map file of the game places " + stem + ": set where it stands yourself (Import tab).");
            if (ent != null && want("map")) put((string)ent["ymap"], "the map file that places the building");

            if (ent != null)
            {
                // the building's box in the world
                YmapFile pm = g.Ymap((string)ent["ymap"]); YmapEntityDef me = null; uint h = JenkHash.GenHash(stem);
                if (pm != null && pm.AllEntities != null) foreach (YmapEntityDef en in pm.AllEntities) if (en.CEntityDef.archetypeName.Hash == h && Math.Abs(en.Position.X - J.D(ent["x"], 0)) < 0.01 && Math.Abs(en.Position.Y - J.D(ent["y"], 0)) < 0.01) { me = en; break; }
                double[] box = me != null ? WorldBox(me, ydr.Drawable.BoundingBoxMin, ydr.Drawable.BoundingBoxMax) : null;
                if (box != null) log.Add("the building: " + F(box[3] - box[0]) + " x " + F(box[4] - box[1]) + " x " + F(box[5] - box[2]) + " m");
                string pre = Prefix(stem);

                // 3. detail models: other full-detail models of the block's map files that touch the building (railings, ladders, signs, decals...)
                if (box != null && want("details"))
                {
                    List<string> maps = new List<string>(); maps.Add((string)ent["ymap"]);
                    foreach (string m in g.MapsInBox(box[0], box[1], box[3], box[4])) if (!maps.Contains(m) && m.StartsWith(pre) && m.IndexOf("occl", StringComparison.Ordinal) < 0 && !Lod.IsMatch(m.Replace(".ymap", ""))) maps.Add(m);
                    Dictionary<string, YdrFile> seen = new Dictionary<string, YdrFile>(); int count = 0;
                    foreach (string m in maps)
                    {
                        YmapFile y = g.Ymap(m); if (y == null || y.AllEntities == null) continue; bool used = false;
                        foreach (YmapEntityDef en in y.AllEntities)
                        {
                            if (en == null || en.IsMlo || count >= 40) continue; string lod = en.CEntityDef.lodLevel.ToString(); if (lod != "LODTYPES_DEPTH_HD" && lod != "LODTYPES_DEPTH_ORPHANHD") continue;
                            string n = NameOf(en.CEntityDef.archetypeName.Hash); if (n == null || n == stem || Lod.IsMatch(n)) continue;
                            if (!n.StartsWith(pre)) continue;                                   // (the block's own pieces: props of other names are for the Props tools)
                            YdrFile d; if (!seen.TryGetValue(n, out d)) { d = g.Ydr(n + ".ydr"); seen[n] = d; } if (d == null || d.Drawable == null) continue;
                            if (!Touch(box, WorldBox(en, d.Drawable.BoundingBoxMin, d.Drawable.BoundingBoxMax), 1.0)) continue;
                            if (!done.Contains(n + ".ydr")) { put(n + ".ydr", "a detail model of the building (placed by " + m + ")"); count++; if (want("textures")) { List<string> why = new List<string>(); foreach (string t in TexturesOf(g, n, d, why)) put(t + ".ytd", "textures of the detail model " + n); } }
                            used = true;
                        }
                        if (used && want("map")) put(m, "a map file that places detail models");
                    }
                    if (count >= 40) warns.Add("Only the first 40 detail models were pulled.");
                }

                // 4. collision: the block's collision files that reach the building
                if (box != null && want("collision"))
                {
                    int nc = 0;
                    foreach (string n in g.Names(".ybn"))
                    {
                        if (n.IndexOf(pre, StringComparison.Ordinal) < 0) continue; YbnFile yb = g.Ybn(n); if (yb == null || yb.Bounds == null) continue;
                        double[] b2 = new double[] { yb.Bounds.BoxMin.X, yb.Bounds.BoxMin.Y, yb.Bounds.BoxMin.Z, yb.Bounds.BoxMax.X, yb.Bounds.BoxMax.Y, yb.Bounds.BoxMax.Z };
                        if (!Touch(box, b2, 1.0)) continue; put(n, "collision around the building"); nc++;
                    }
                    if (nc == 0) warns.Add("No collision file of the block reaches the building.");
                }

                // 5. occlusion: map files with box occluders near the building (some stand inside houses and hide the interior)
                if (box != null && want("occlusion"))
                    foreach (string n in g.Names(".ymap"))
                    {
                        if (n.IndexOf("occl", StringComparison.Ordinal) < 0) continue; YmapFile y = g.Ymap(n); if (y == null || y.BoxOccluders == null) continue; bool hit = false;
                        foreach (YmapBoxOccluder o in y.BoxOccluders) if (o.Position.X >= box[0] - 2 && o.Position.X <= box[3] + 2 && o.Position.Y >= box[1] - 2 && o.Position.Y <= box[4] + 2) { hit = true; break; }
                        if (hit) put(n, "occlusion boxes near the building");
                    }
            }
            Vanilla.Status = "";
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["target"] = stem + ".ydr"; res["entity"] = ent; res["places"] = places; res["added"] = added; res["had"] = had; res["warnings"] = warns; res["log"] = log;
            return res;
        }
    }
}
