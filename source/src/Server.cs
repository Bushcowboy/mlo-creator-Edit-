// Your server's resources: finds every resource under a folder, tells which files are encrypted (Tebex / Cfx asset escrow: a .fxap file, stream files whose
// bytes are not a GTA file) and reads the others: the MLOs their .ytyp files define, where their .ymap files place them, their interiors' collision (.ymf).
// Then what clashes: MLOs whose boxes overlap (with each other and with the game's own interiors), archetype names defined twice, file names streamed by two
// resources. Nothing is written to the server folder. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public class SrvFile { public string Rel, Name, Ext, State, Why; public long Size; }     // State: ok, encrypted, unreadable, xml
    public class SrvMlo { public string Resource, Name, File; public uint Hash; public int Ents, Rooms, Portals; public V3 BMin, BMax; public List<string> Bounds = new List<string>(); }
    public class SrvPlace { public string Resource, Ymap, Name; public uint Hash; public V3 P, WMin, WMax; public Q R; public bool Game; }
    public class SrvRes
    {
        public string Name, Dir; public bool Escrow; public int Ok, Encrypted, Unreadable;
        public List<SrvFile> Files = new List<SrvFile>(); public List<SrvMlo> Mlos = new List<SrvMlo>(); public List<SrvPlace> Places = new List<SrvPlace>();
        public List<double[]> MapBoxes = new List<double[]>();          // the entity extents of its plain map files (not MLOs): x0 y0 z0 x1 y1 z1
    }

    public static class Server
    {
        public static volatile string Status = "", Error = "";
        static Thread worker; static List<SrvRes> result; static string scanned;
        static List<object> conflicts = new List<object>();
        public static bool Busy { get { return worker != null && worker.IsAlive; } }
        public static List<SrvRes> Resources { get { return result; } }
        static readonly string[] Exts = { ".ytyp", ".ymap", ".ybn", ".ydr", ".ydd", ".yft", ".ytd", ".ymf" };
        static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }

        public static void StartScan(string root)
        {
            if (Busy) return;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) throw new Exception("The folder \"" + root + "\" does not exist.");
            Error = "";
            worker = new Thread(delegate () { try { Scan(root); } catch (Exception ex) { Error = ex.Message; } finally { Status = ""; } });
            worker.IsBackground = true; worker.Start();
        }

        // the folders that are resources (they hold fxmanifest.lua or __resource.lua); [category] folders are walked into
        static void FindResources(string dir, List<string> into, int depth)
        {
            if (depth > 8) return;
            if (File.Exists(Path.Combine(dir, "fxmanifest.lua")) || File.Exists(Path.Combine(dir, "__resource.lua"))) { into.Add(dir); return; }
            string[] subs; try { subs = Directory.GetDirectories(dir); } catch (Exception) { return; }
            foreach (string s in subs) { string n = Path.GetFileName(s).ToLowerInvariant(); if (n == "node_modules" || n == ".git" || n == "cache") continue; FindResources(s, into, depth + 1); }
        }

        // what the first bytes say a file is: RSC7 (a GTA resource: models, maps, types, collision), PSIN (meta), RBF0, XML (CodeWalker's text form); anything else is encrypted
        public static string Kind(byte[] head, int n, out string why)
        {
            why = "";
            if (n >= 4 && head[0] == 'R' && head[1] == 'S' && head[2] == 'C' && head[3] == '7') return "ok";
            if (n >= 4 && head[0] == 'P' && head[1] == 'S' && head[2] == 'I' && head[3] == 'N') return "ok";
            if (n >= 4 && head[0] == 'R' && head[1] == 'B' && head[2] == 'F' && head[3] == '0') return "ok";
            int i = 0; if (n >= 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF) i = 3; while (i < n && (head[i] == ' ' || head[i] == '\r' || head[i] == '\n' || head[i] == '\t')) i++;
            if (i < n && head[i] == '<') { why = "CodeWalker XML (not a game file)"; return "xml"; }
            if (n >= 4 && head[0] == 'F' && head[1] == 'X' && head[2] == 'A' && head[3] == 'P') { why = "escrow (FXAP)"; return "encrypted"; }
            why = n == 0 ? "empty" : "not a GTA file header (" + BitConverter.ToString(head, 0, Math.Min(4, n)) + "): encrypted"; return "encrypted";
        }

        static void Scan(string root)
        {
            Status = "Looking for resources in " + root + "...";
            List<string> dirs = new List<string>(); FindResources(root, dirs, 0);
            List<SrvRes> res = new List<SrvRes>(); int k = 0;
            // every file name first: archetypes are named like their model files, so their names are known before the type files are read
            Dictionary<string, string[]> filesOf = new Dictionary<string, string[]>();
            foreach (string d in dirs) { string[] fs; try { fs = Directory.GetFiles(d, "*", SearchOption.AllDirectories); } catch (Exception) { fs = new string[0]; } filesOf[d] = fs; foreach (string f in fs) JenkIndex.Ensure(Path.GetFileNameWithoutExtension(f).ToLowerInvariant()); }
            foreach (string d in dirs)
            {
                k++; SrvRes r = new SrvRes(); r.Name = Path.GetFileName(d); r.Dir = d; Status = "Reading resource " + k + " / " + dirs.Count + ": " + r.Name;
                try { foreach (string f in Directory.GetFiles(d, "*.fxap", SearchOption.TopDirectoryOnly)) r.Escrow = true; if (File.Exists(Path.Combine(d, ".fxap"))) r.Escrow = true; } catch (Exception) { }
                string[] files = filesOf[d];
                foreach (string f in files)
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant(); if (Array.IndexOf(Exts, ext) < 0) continue;
                    SrvFile sf = new SrvFile(); sf.Rel = f.Substring(d.Length).TrimStart('\\', '/'); sf.Name = Path.GetFileName(f).ToLowerInvariant(); sf.Ext = ext;
                    try { sf.Size = new FileInfo(f).Length; } catch (Exception) { }
                    byte[] head = new byte[16]; int n = 0; try { using (FileStream fs = File.OpenRead(f)) n = fs.Read(head, 0, 16); } catch (Exception ex) { sf.State = "unreadable"; sf.Why = ex.Message; }
                    if (sf.State == null) { string why; sf.State = Kind(head, n, out why); sf.Why = why; }
                    if (sf.State == "ok" && sf.Size < 200L * 1024 * 1024 && (ext == ".ytyp" || ext == ".ymap" || ext == ".ymf"))
                    {
                        try { Parse(r, sf, File.ReadAllBytes(f)); } catch (Exception ex) { sf.State = "unreadable"; sf.Why = ex.Message; }
                    }
                    if (sf.State == "ok") r.Ok++; else if (sf.State == "encrypted") r.Encrypted++; else r.Unreadable++;
                    r.Files.Add(sf);
                }
                res.Add(r);
            }
            Status = "Working out where the MLOs stand and what overlaps...";
            Finish(res);
            result = res; scanned = root;
        }

        static void Parse(SrvRes r, SrvFile sf, byte[] data)
        {
            if (sf.Ext == ".ytyp")
            {
                YtypFile y = new YtypFile(); y.Load(data); if (y.AllArchetypes == null) return;
                foreach (Archetype a in y.AllArchetypes)
                {
                    MloArchetype m = a as MloArchetype; if (m == null) continue;
                    SrvMlo sm = new SrvMlo(); sm.Resource = r.Name; sm.File = sf.Rel; sm.Hash = a.Hash.Hash; sm.Name = Interiors.NameOf(sm.Hash);
                    sm.Ents = m.entities == null ? 0 : m.entities.Length; sm.Rooms = m.rooms == null ? 0 : m.rooms.Length; sm.Portals = m.portals == null ? 0 : m.portals.Length;
                    sm.BMin = new V3(a.BBMin.X, a.BBMin.Y, a.BBMin.Z); sm.BMax = new V3(a.BBMax.X, a.BBMax.Y, a.BBMax.Z); r.Mlos.Add(sm);
                }
                foreach (Archetype a in y.AllArchetypes) if (a != null) Defs.Add(new KeyValuePair<uint, string>(a.Hash.Hash, r.Name));
            }
            else if (sf.Ext == ".ymap")
            {
                YmapFile y = new YmapFile(); y.Load(data); if (y.AllEntities == null) return;
                bool any = false;
                foreach (YmapEntityDef en in y.AllEntities)
                {
                    if (en == null) continue;
                    if (en.IsMlo)
                    {
                        SrvPlace p = new SrvPlace(); p.Resource = r.Name; p.Ymap = sf.Rel; p.Hash = en._CEntityDef.archetypeName.Hash; p.Name = Interiors.NameOf(p.Hash);
                        p.P = new V3(en._CEntityDef.position.X, en._CEntityDef.position.Y, en._CEntityDef.position.Z);
                        p.R = new Q(en._CEntityDef.rotation.X, en._CEntityDef.rotation.Y, en._CEntityDef.rotation.Z, en._CEntityDef.rotation.W).Norm(); r.Places.Add(p);
                    }
                    else any = true;
                }
                if (any)
                {
                    SharpDX.Vector3 a = y.CMapData.entitiesExtentsMin, b = y.CMapData.entitiesExtentsMax;
                    if (!float.IsNaN(a.X) && b.X > a.X) r.MapBoxes.Add(new double[] { a.X, a.Y, a.Z, b.X, b.Y, b.Z });
                }
            }
            else if (sf.Ext == ".ymf")
            {
                YmfFile y = new YmfFile(); y.Load(data, null); if (y.Interiors == null) return;
                foreach (YmfInterior yi in y.Interiors) { List<string> b = new List<string>(); if (yi.Bounds != null) foreach (MetaHash h in yi.Bounds) b.Add(h.Hash.ToString("X8")); IntBounds[r.Name + "|" + yi.Interior.Name.Hash.ToString("X8")] = b; }
            }
        }
        [ThreadStatic] static List<KeyValuePair<uint, string>> defs; static List<KeyValuePair<uint, string>> Defs { get { return defs ?? (defs = new List<KeyValuePair<uint, string>>()); } }
        [ThreadStatic] static Dictionary<string, List<string>> intBounds; static Dictionary<string, List<string>> IntBounds { get { return intBounds ?? (intBounds = new Dictionary<string, List<string>>()); } }     // "resource|MLO hash" -> collision file hashes

        static void Finish(List<SrvRes> res)
        {
            // the MLOs by name, and the names of the resources' collision files (the manifests name them by hash)
            // (a collision file belongs to the resource whose manifest names it, even when another resource defines an MLO of the same name)
            Dictionary<uint, SrvMlo> mlo = new Dictionary<uint, SrvMlo>();
            foreach (SrvRes r in res)
            {
                Dictionary<string, string> ybnByHash = new Dictionary<string, string>(); foreach (SrvFile f in r.Files) if (f.Ext == ".ybn" && f.State == "ok") ybnByHash[JenkHash.GenHash(Path.GetFileNameWithoutExtension(f.Name)).ToString("X8")] = f.Name;
                foreach (SrvMlo m in r.Mlos)
                {
                    if (!mlo.ContainsKey(m.Hash) || mlo[m.Hash].Bounds.Count == 0) mlo[m.Hash] = m;
                    List<string> hs; if (!IntBounds.TryGetValue(r.Name + "|" + m.Hash.ToString("X8"), out hs)) continue;
                    foreach (string h in hs) { string n; if (ybnByHash.TryGetValue(h, out n) && !m.Bounds.Contains(n)) m.Bounds.Add(n); }
                    if (m.Bounds.Count > 0) mlo[m.Hash] = m;
                }
            }
            // where each placed MLO reaches in the world: its archetype's box turned and moved (a server MLO, or one of the game's when the game's list is loaded)
            foreach (SrvRes r in res) foreach (SrvPlace p in r.Places)
                {
                    SrvMlo m; V3 mn, mx; bool known = false;
                    if (mlo.TryGetValue(p.Hash, out m)) { mn = m.BMin; mx = m.BMax; known = true; }
                    else { mn = new V3(-5, -5, -1); mx = new V3(5, 5, 4); try { if (Interiors.Ready) { MloInfo gi = Interiors.Find(p.Hash.ToString("X8")); mn = gi.BMin; mx = gi.BMax; known = true; } } catch (Exception) { } }
                    V3 a = new V3(1e9, 1e9, 1e9), b = new V3(-1e9, -1e9, -1e9); new Xf(p.R, p.P).Box(mn, mx, ref a, ref b); p.WMin = a; p.WMax = b;
                    if (!known) p.Name += " (its type file was not found or is encrypted: size guessed)";
                }
            List<object> c = new List<object>();
            // file names streamed by two resources: only one of them loads
            Dictionary<string, List<string>> byFile = new Dictionary<string, List<string>>();
            foreach (SrvRes r in res) foreach (SrvFile f in r.Files) { if (f.Ext == ".ymf") continue; List<string> l; if (!byFile.TryGetValue(f.Name, out l)) byFile[f.Name] = l = new List<string>(); if (!l.Contains(r.Name)) l.Add(r.Name); }
            foreach (KeyValuePair<string, List<string>> kv in byFile) if (kv.Value.Count > 1) c.Add(Conflict("file", kv.Key + " is streamed by " + string.Join(", ", kv.Value.ToArray()) + ": only one copy loads", kv.Value, null));
            // archetype names defined twice
            Dictionary<uint, List<string>> byArch = new Dictionary<uint, List<string>>();
            foreach (KeyValuePair<uint, string> d in Defs) { List<string> l; if (!byArch.TryGetValue(d.Key, out l)) byArch[d.Key] = l = new List<string>(); if (!l.Contains(d.Value)) l.Add(d.Value); }
            foreach (KeyValuePair<uint, List<string>> kv in byArch) if (kv.Value.Count > 1) c.Add(Conflict("archetype", Interiors.NameOf(kv.Key) + " is defined by " + string.Join(", ", kv.Value.ToArray()), kv.Value, null));
            // MLOs that overlap (by their boxes; at least 0.5 m deep in every direction): each other, and the game's own interiors
            List<SrvPlace> all = new List<SrvPlace>(); foreach (SrvRes r in res) all.AddRange(r.Places);
            if (Interiors.Ready) foreach (MloInfo gi in GameInteriors()) foreach (MloPlace gp in gi.Places)
                    {
                        SrvPlace p = new SrvPlace(); p.Game = true; p.Resource = "the game (" + gi.Pack + ")"; p.Name = gi.Name; p.Ymap = gp.Ymap; p.Hash = gi.Hash; p.P = gp.P; p.R = gp.R;
                        V3 a = new V3(1e9, 1e9, 1e9), b = new V3(-1e9, -1e9, -1e9); new Xf(gp.R, gp.P).Box(gi.BMin, gi.BMax, ref a, ref b); p.WMin = a; p.WMax = b; all.Add(p);
                    }
            for (int i = 0; i < all.Count; i++) for (int j = i + 1; j < all.Count; j++)
                {
                    SrvPlace a = all[i], b = all[j]; if (a.Game && b.Game) continue; if (a.Resource == b.Resource && a.Hash == b.Hash && (a.P - b.P).Len() < 0.05) continue;
                    double ox = Math.Min(a.WMax.X, b.WMax.X) - Math.Max(a.WMin.X, b.WMin.X), oy = Math.Min(a.WMax.Y, b.WMax.Y) - Math.Max(a.WMin.Y, b.WMin.Y), oz = Math.Min(a.WMax.Z, b.WMax.Z) - Math.Max(a.WMin.Z, b.WMin.Z);
                    if (ox < 0.5 || oy < 0.5 || oz < 0.5) continue;
                    if (b.Game && a.Hash == b.Hash && (a.P - b.P).Len() < 0.5) continue;              // (the game's own interior, placed again by a resource that just loads it)
                    V3 ctr = new V3((Math.Max(a.WMin.X, b.WMin.X) + Math.Min(a.WMax.X, b.WMax.X)) / 2, (Math.Max(a.WMin.Y, b.WMin.Y) + Math.Min(a.WMax.Y, b.WMax.Y)) / 2, (Math.Max(a.WMin.Z, b.WMin.Z) + Math.Min(a.WMax.Z, b.WMax.Z)) / 2);
                    c.Add(Conflict("overlap", a.Name + " (" + a.Resource + ") and " + b.Name + " (" + b.Resource + ") overlap by " + F(ox) + " x " + F(oy) + " x " + F(oz) + " m", new List<string> { a.Resource, b.Resource }, new double[] { ctr.X, ctr.Y, ctr.Z }));
                }
            conflicts = c;
        }
        static IEnumerable<MloInfo> GameInteriors() { return Interiors.All; }
        static Dictionary<string, object> Conflict(string kind, string text, List<string> res, double[] at)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(); d["kind"] = kind; d["text"] = text; d["resources"] = res; if (at != null) d["at"] = at; return d;
        }

        public static Dictionary<string, object> StatusInfo()
        {
            Dictionary<string, object> d = new Dictionary<string, object>(); d["busy"] = Busy; d["status"] = Status; d["error"] = Error; d["ready"] = result != null; d["root"] = scanned ?? ""; return d;
        }

        static double[] A(V3 v) { return new double[] { Math.Round(v.X, 3), Math.Round(v.Y, 3), Math.Round(v.Z, 3) }; }
        public static Dictionary<string, object> Result()
        {
            Dictionary<string, object> d = StatusInfo(); List<object> rs = new List<object>();
            if (result != null) foreach (SrvRes r in result)
                {
                    Dictionary<string, object> o = new Dictionary<string, object>(); o["name"] = r.Name; o["dir"] = r.Dir; o["escrow"] = r.Escrow; o["ok"] = r.Ok; o["encrypted"] = r.Encrypted; o["unreadable"] = r.Unreadable;
                    List<object> fl = new List<object>(); foreach (SrvFile f in r.Files) { Dictionary<string, object> fo = new Dictionary<string, object>(); fo["rel"] = f.Rel; fo["state"] = f.State; fo["why"] = f.Why ?? ""; fo["size"] = f.Size; fl.Add(fo); } o["files"] = fl;
                    List<object> ml = new List<object>(); foreach (SrvMlo m in r.Mlos) { Dictionary<string, object> mo = new Dictionary<string, object>(); mo["name"] = m.Name; mo["hash"] = m.Hash.ToString("X8"); mo["file"] = m.File; mo["ents"] = m.Ents; mo["rooms"] = m.Rooms; mo["portals"] = m.Portals; mo["bmin"] = A(m.BMin); mo["bmax"] = A(m.BMax); mo["bounds"] = m.Bounds; ml.Add(mo); } o["mlos"] = ml;
                    List<object> pl = new List<object>(); foreach (SrvPlace p in r.Places) { Dictionary<string, object> po = new Dictionary<string, object>(); po["name"] = p.Name; po["hash"] = p.Hash.ToString("X8"); po["ymap"] = p.Ymap; po["p"] = A(p.P); po["heading"] = Math.Round(p.R.HeadingDeg(), 2); po["wmin"] = A(p.WMin); po["wmax"] = A(p.WMax); pl.Add(po); } o["places"] = pl;
                    o["mapBoxes"] = r.MapBoxes; rs.Add(o);
                }
            d["resources"] = rs; d["conflicts"] = conflicts;
            // the game's interiors, for the map (when their list is loaded)
            List<object> gp = new List<object>();
            if (Interiors.Ready) foreach (MloInfo gi in GameInteriors()) foreach (MloPlace p in gi.Places) gp.Add(new double[] { Math.Round(p.P.X, 1), Math.Round(p.P.Y, 1), Math.Round(p.P.Z, 1) });
            d["gameInteriors"] = gp;
            return d;
        }

        // for tests: scan a folder now, on this thread
        public static void ScanNow(string root) { defs = null; intBounds = null; Scan(root); }
    }
}
