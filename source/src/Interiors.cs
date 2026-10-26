// The game's own interiors (MLOs): the casino, apartments, offices, garages... Lists every MLO the game defines (its .ytyp files), where the game places it
// (.ymap) and its collision (the .ymf manifests link an interior to its .ybn files). A copy of one, or several joined into one big MLO, is written as a new
// resource: a new MLO archetype whose rooms, portals, entity sets and timecycle modifiers are the game's, moved to where you put each piece. The entities
// keep the game's own model names, so no model or texture file is copied: the game streams them itself. The collision is the game's, moved the same way. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Xml;
using CodeWalker.GameFiles;

namespace MloCreator
{
    // a turn as a unit quaternion (x y z w); Rot turns a point
    public struct Q
    {
        public double X, Y, Z, W;
        public Q(double x, double y, double z, double w) { X = x; Y = y; Z = z; W = w; }
        public static readonly Q Identity = new Q(0, 0, 0, 1);
        public static Q Yaw(double deg) { double r = deg * Math.PI / 360.0; return new Q(0, 0, Math.Sin(r), Math.Cos(r)); }
        public static Q operator *(Q a, Q b)
        {
            return new Q(a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y, a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X, a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W, a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);
        }
        public Q Conj() { return new Q(-X, -Y, -Z, W); }
        public Q Norm() { double l = Math.Sqrt(X * X + Y * Y + Z * Z + W * W); return l < 1e-12 ? Identity : new Q(X / l, Y / l, Z / l, W / l); }
        public V3 Rot(V3 v)
        {
            // v + 2w(q x v) + 2 q x (q x v)
            double tx = 2 * (Y * v.Z - Z * v.Y), ty = 2 * (Z * v.X - X * v.Z), tz = 2 * (X * v.Y - Y * v.X);
            return new V3(v.X + W * tx + (Y * tz - Z * ty), v.Y + W * ty + (Z * tx - X * tz), v.Z + W * tz + (X * ty - Y * tx));
        }
        public double HeadingDeg() { return Math.Atan2(2 * (W * Z + X * Y), 1 - 2 * (Y * Y + Z * Z)) * 180.0 / Math.PI; }
    }
    // a placement: turn, then move (p' = R p + T)
    public struct Xf
    {
        public Q R; public V3 T;
        public Xf(Q r, V3 t) { R = r; T = t; }
        public static readonly Xf Identity = new Xf(Q.Identity, new V3(0, 0, 0));
        public V3 Apply(V3 p) { return R.Rot(p) + T; }
        public static Xf operator *(Xf a, Xf b) { return new Xf((a.R * b.R).Norm(), a.R.Rot(b.T) + a.T); }      // b first, then a
        public Xf Inverse() { Q c = R.Conj(); V3 t = c.Rot(T); return new Xf(c, new V3(-t.X, -t.Y, -t.Z)); }
        // the axis-aligned box around a box after the move
        public void Box(V3 mn, V3 mx, ref V3 omn, ref V3 omx)
        {
            for (int i = 0; i < 8; i++)
            {
                V3 w = Apply(new V3((i & 1) == 0 ? mn.X : mx.X, (i & 2) == 0 ? mn.Y : mx.Y, (i & 4) == 0 ? mn.Z : mx.Z));
                omn = new V3(Math.Min(omn.X, w.X), Math.Min(omn.Y, w.Y), Math.Min(omn.Z, w.Z)); omx = new V3(Math.Max(omx.X, w.X), Math.Max(omx.Y, w.Y), Math.Max(omx.Z, w.Z));
            }
        }
    }

    public class MloInfo
    {
        public uint Hash; public string Name, Ytyp, Pack; public int Ents, Rooms, Portals; public V3 BMin, BMax;
        public List<string> Sets = new List<string>(), RoomNames = new List<string>(), Bounds = new List<string>();
        public List<MloPlace> Places = new List<MloPlace>();
    }
    public class MloPlace { public string Ymap; public V3 P; public Q R; public List<string> Sets = new List<string>(); }

    public static class Interiors
    {
        public static volatile string Status = "";
        public static volatile string Error = "";
        static List<MloInfo> mlos; static Dictionary<uint, MloInfo> byHash = new Dictionary<uint, MloInfo>();
        static Dictionary<uint, string> archYtyp;                  // every archetype the game defines -> the .ytyp that defines it (for the dependencies of a copy)
        static readonly object gate = new object();
        static Thread worker;
        const string Version = "mlo-index-2";

        public static bool Ready { get { return mlos != null; } }
        public static bool Busy { get { return worker != null && worker.IsAlive; } }

        static string F(double v) { return v.ToString("0.######", CultureInfo.InvariantCulture); }
        static double D(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0; }
        public static string NameOf(uint h) { string s = JenkIndex.TryGetString(h); return string.IsNullOrEmpty(s) ? "hash_" + h.ToString("X8") : s; }
        public static uint HashOf(string s)
        {
            s = (s ?? "").Trim(); if (s.Length == 0) return 0;
            if (s.StartsWith("hash_", StringComparison.OrdinalIgnoreCase)) { uint h; if (uint.TryParse(s.Substring(5), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out h)) return h; }
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) { uint h; if (uint.TryParse(s.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out h)) return h; }
            return JenkHash.GenHash(s.ToLowerInvariant());
        }
        static string Base(string file) { int i = file.LastIndexOf('.'); return i > 0 ? file.Substring(0, i) : file; }
        // the DLC pack that holds a file: "mpvinewood" for the casino, "base game" for the game itself
        static string PackOf(RpfFile owner)
        {
            if (owner == null) return "base game";
            string p = (owner.Path ?? "").ToLowerInvariant().Replace('/', '\\');
            foreach (string key in new string[] { "dlcpacks\\", "dlc_patch\\" })
            {
                int i = p.IndexOf(key); if (i < 0) continue; string rest = p.Substring(i + key.Length); int j = rest.IndexOf('\\'); string n = j > 0 ? rest.Substring(0, j) : rest;
                return key == "dlc_patch\\" ? "patch " + n : n;
            }
            return "base game";
        }

        // ---------------- the list of the game's interiors: built once in the background, then read from the cache ----------------
        public static void StartIndex(string gta, string cacheDir, bool force)
        {
            lock (gate)
            {
                if (Busy) return; if (Ready && !force) return;
                Error = "";
                worker = new Thread(delegate ()
                {
                    try { Vanilla.Init(gta, cacheDir); BuildIndex(force); }
                    catch (Exception ex) { Error = ex.Message; }
                    finally { Status = ""; }
                });
                worker.IsBackground = true; worker.Start();
            }
        }

        static string Stamp() { return Version + "|" + Vanilla.GtaPath + "|" + File.GetLastWriteTimeUtc(Path.Combine(Vanilla.GtaPath, "GTA5.exe")).Ticks + "|" + Vanilla.EntryCount; }

        static void BuildIndex(bool force)
        {
            string f = Path.Combine(Vanilla.CacheDir, "mlo_index.txt"), stamp = Stamp();
            Status = "Reading the list of the game's interiors...";
            // names that are only known as files help to name the interiors (most MLO names are not stored as text in the game)
            foreach (string ext in new string[] { ".ytyp", ".ymap", ".ybn" }) foreach (string n in Vanilla.Names(ext)) JenkIndex.Ensure(Base(n));
            LoadLearnedNames();
            if (!force && File.Exists(f) && LoadIndex(f, stamp)) return;

            List<MloInfo> list = new List<MloInfo>(); Dictionary<uint, MloInfo> idx = new Dictionary<uint, MloInfo>(); Dictionary<uint, string> arch = new Dictionary<uint, string>();
            // 1. every .ytyp: its archetypes, and the MLOs among them
            List<string> ytyps = Vanilla.Names(".ytyp"); int n0 = 0;
            foreach (string yn in ytyps)
            {
                n0++; if (n0 % 200 == 0) Status = "Finding the game's interiors (1/3, type files): " + n0 + " / " + ytyps.Count;
                try
                {
                    RpfFileEntry e; byte[] data = Vanilla.Bytes(yn, out e); if (data == null) continue;
                    YtypFile y = new YtypFile(); y.Load(data, e); if (y.AllArchetypes == null) continue;
                    RpfFile owner; Vanilla.GetEntry(yn, out owner);
                    foreach (Archetype a in y.AllArchetypes)
                    {
                        if (a == null) continue; uint h = a.Hash.Hash; arch[h] = Base(yn);
                        MloArchetype m = a as MloArchetype; if (m == null) continue;
                        MloInfo mi = new MloInfo(); mi.Hash = h; mi.Name = NameOf(h); mi.Ytyp = Base(yn); mi.Pack = PackOf(owner);
                        mi.Ents = m.entities == null ? 0 : m.entities.Length; mi.Rooms = m.rooms == null ? 0 : m.rooms.Length; mi.Portals = m.portals == null ? 0 : m.portals.Length;
                        mi.BMin = new V3(a.BBMin.X, a.BBMin.Y, a.BBMin.Z); mi.BMax = new V3(a.BBMax.X, a.BBMax.Y, a.BBMax.Z);
                        if (m.rooms != null) foreach (MCMloRoomDef r in m.rooms) mi.RoomNames.Add(r.RoomName ?? "");
                        if (m.entitySets != null) foreach (MCMloEntitySet s in m.entitySets) mi.Sets.Add(NameOf(s.Data.name.Hash));
                        if (!idx.ContainsKey(h)) { idx[h] = mi; list.Add(mi); }
                    }
                }
                catch (Exception) { }
            }
            // 2. every .ymap: where the game places each MLO, and the entity sets it shows there
            List<string> ymaps = Vanilla.Names(".ymap"); int n1 = 0;
            foreach (string mn in ymaps)
            {
                n1++; if (n1 % 500 == 0) Status = "Finding where the game places them (2/3, map files): " + n1 + " / " + ymaps.Count;
                try
                {
                    RpfFileEntry e; byte[] data = Vanilla.Bytes(mn, out e); if (data == null) continue;
                    YmapFile y = new YmapFile(); y.Load(data, e); if (y.AllEntities == null) continue;
                    foreach (YmapEntityDef en in y.AllEntities)
                    {
                        if (en == null || !en.IsMlo) continue; uint h = en._CEntityDef.archetypeName.Hash; MloInfo mi; if (!idx.TryGetValue(h, out mi)) continue;
                        MloPlace pl = new MloPlace(); pl.Ymap = Base(mn);
                        pl.P = new V3(en._CEntityDef.position.X, en._CEntityDef.position.Y, en._CEntityDef.position.Z);
                        pl.R = new Q(en._CEntityDef.rotation.X, en._CEntityDef.rotation.Y, en._CEntityDef.rotation.Z, en._CEntityDef.rotation.W).Norm();       // (an MLO instance's turn is stored as it is, not inverted)
                        try { if (en.MloInstance != null && en.MloInstance.defaultEntitySets != null) foreach (uint sh in en.MloInstance.defaultEntitySets) pl.Sets.Add(NameOf(sh)); } catch (Exception) { }
                        bool dup = false; foreach (MloPlace o in mi.Places) if ((o.P - pl.P).Len() < 0.05) { dup = true; break; }
                        if (!dup) mi.Places.Add(pl);
                    }
                }
                catch (Exception) { }
            }
            // 3. the manifests (.ymf, one per archive, all of the same name): which collision files belong to an interior
            Dictionary<uint, string> ybnByHash = new Dictionary<uint, string>(); foreach (string b in Vanilla.Names(".ybn")) ybnByHash[JenkHash.GenHash(Base(b))] = Base(b);
            int n2 = 0;
            foreach (RpfFile rf in Vanilla.Manager.AllRpfs)
            {
                if (rf.AllEntries == null) continue;
                foreach (RpfEntry re in rf.AllEntries)
                {
                    RpfFileEntry fe = re as RpfFileEntry; if (fe == null || !fe.Name.EndsWith(".ymf", StringComparison.OrdinalIgnoreCase)) continue;
                    n2++; if (n2 % 20 == 0) Status = "Reading the interiors' collision lists (3/3): " + n2 + " manifests";
                    try
                    {
                        YmfFile ym = new YmfFile(); ym.Load(rf.ExtractFile(fe), fe); if (ym.Interiors == null) continue;
                        foreach (YmfInterior yi in ym.Interiors)
                        {
                            MloInfo mi; if (!idx.TryGetValue(yi.Interior.Name.Hash, out mi) || yi.Bounds == null) continue;
                            foreach (MetaHash bh in yi.Bounds) { string bn; if (ybnByHash.TryGetValue(bh.Hash, out bn) && !mi.Bounds.Contains(bn)) mi.Bounds.Add(bn); }
                        }
                    }
                    catch (Exception) { }
                }
            }
            list.Sort(delegate (MloInfo a, MloInfo b) { int c = string.Compare(a.Pack, b.Pack, StringComparison.Ordinal); return c != 0 ? c : string.Compare(a.Name, b.Name, StringComparison.Ordinal); });
            SaveIndex(f, stamp, list, arch);
            lock (gate) { mlos = list; byHash = idx; archYtyp = arch; }
        }

        static string V(V3 v) { return F(v.X) + "," + F(v.Y) + "," + F(v.Z); }
        static V3 PV(string s) { string[] p = s.Split(','); return p.Length < 3 ? new V3(0, 0, 0) : new V3(D(p[0]), D(p[1]), D(p[2])); }
        static string Join(List<string> l) { return string.Join(";", l.ToArray()); }
        static List<string> Split(string s) { List<string> l = new List<string>(); if (string.IsNullOrEmpty(s)) return l; foreach (string x in s.Split(';')) if (x.Length > 0) l.Add(x); return l; }

        static void SaveIndex(string f, string stamp, List<MloInfo> list, Dictionary<uint, string> arch)
        {
            StringBuilder sb = new StringBuilder(); sb.AppendLine(stamp);
            foreach (MloInfo m in list)
            {
                sb.AppendLine("M|" + m.Hash.ToString("X8") + "|" + m.Ytyp + "|" + m.Pack + "|" + m.Ents + "|" + m.Rooms + "|" + m.Portals + "|" + V(m.BMin) + "|" + V(m.BMax) + "|" + Join(m.Sets) + "|" + Join(m.RoomNames) + "|" + Join(m.Bounds));
                foreach (MloPlace p in m.Places) sb.AppendLine("P|" + m.Hash.ToString("X8") + "|" + p.Ymap + "|" + V(p.P) + "|" + F(p.R.X) + "," + F(p.R.Y) + "," + F(p.R.Z) + "," + F(p.R.W) + "|" + Join(p.Sets));
            }
            File.WriteAllText(f, sb.ToString());
            StringBuilder ab = new StringBuilder(); ab.AppendLine(stamp); foreach (KeyValuePair<uint, string> kv in arch) ab.AppendLine(kv.Key.ToString("X8") + "|" + kv.Value);
            File.WriteAllText(Path.Combine(Vanilla.CacheDir, "mlo_archetypes.txt"), ab.ToString());
        }

        static bool LoadIndex(string f, string stamp)
        {
            string[] lines = File.ReadAllLines(f); if (lines.Length < 1 || lines[0] != stamp) return false;
            List<MloInfo> list = new List<MloInfo>(); Dictionary<uint, MloInfo> idx = new Dictionary<uint, MloInfo>();
            for (int i = 1; i < lines.Length; i++)
            {
                string[] p = lines[i].Split('|');
                if (p[0] == "M" && p.Length >= 12)
                {
                    MloInfo m = new MloInfo(); m.Hash = uint.Parse(p[1], NumberStyles.HexNumber); m.Name = NameOf(m.Hash); m.Ytyp = p[2]; m.Pack = p[3]; m.Ents = int.Parse(p[4]); m.Rooms = int.Parse(p[5]); m.Portals = int.Parse(p[6]);
                    m.BMin = PV(p[7]); m.BMax = PV(p[8]); m.Sets = Split(p[9]); m.RoomNames = Split(p[10]); m.Bounds = Split(p[11]); list.Add(m); idx[m.Hash] = m;
                }
                else if (p[0] == "P" && p.Length >= 6)
                {
                    MloInfo m; if (!idx.TryGetValue(uint.Parse(p[1], NumberStyles.HexNumber), out m)) continue;
                    MloPlace pl = new MloPlace(); pl.Ymap = p[2]; pl.P = PV(p[3]); string[] q = p[4].Split(','); if (q.Length == 4) pl.R = new Q(D(q[0]), D(q[1]), D(q[2]), D(q[3])); else pl.R = Q.Identity; pl.Sets = Split(p[5]); m.Places.Add(pl);
                }
            }
            lock (gate) { mlos = list; byHash = idx; archYtyp = null; }
            return true;
        }

        // a test sets the list directly (no game install needed)
        public static void SetIndexForTest(List<MloInfo> list, Dictionary<uint, string> arch)
        {
            Dictionary<uint, MloInfo> idx = new Dictionary<uint, MloInfo>(); foreach (MloInfo m in list) idx[m.Hash] = m;
            lock (gate) { mlos = list; byHash = idx; archYtyp = arch; }
        }

        static Dictionary<uint, string> ArchYtyps()
        {
            if (archYtyp != null) return archYtyp;
            Dictionary<uint, string> d = new Dictionary<uint, string>(); string f = Path.Combine(Vanilla.CacheDir, "mlo_archetypes.txt");
            if (File.Exists(f)) { string[] lines = File.ReadAllLines(f); for (int i = 1; i < lines.Length; i++) { int k = lines[i].IndexOf('|'); uint h; if (k > 0 && uint.TryParse(lines[i].Substring(0, k), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out h)) d[h] = lines[i].Substring(k + 1); } }
            archYtyp = d; return d;
        }

        // names typed into the search box that turned out to be an interior's real name are kept, so the list shows them next time
        static string LearnedFile { get { return Path.Combine(Vanilla.CacheDir, "mlo_names.txt"); } }
        static void LoadLearnedNames() { try { if (File.Exists(LearnedFile)) foreach (string l in File.ReadAllLines(LearnedFile)) if (l.Trim().Length > 0) JenkIndex.Ensure(l.Trim().ToLowerInvariant()); } catch (Exception) { } }
        static void Learn(string name, MloInfo m)
        {
            name = name.Trim().ToLowerInvariant(); JenkIndex.Ensure(name); m.Name = name;
            try { File.AppendAllText(LearnedFile, name + Environment.NewLine); } catch (Exception) { }
        }

        static Dictionary<string, object> Summary(MloInfo m)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["hash"] = m.Hash.ToString("X8"); d["name"] = m.Name; d["ytyp"] = m.Ytyp; d["pack"] = m.Pack; d["ents"] = m.Ents; d["rooms"] = m.Rooms; d["portals"] = m.Portals; d["sets"] = m.Sets.Count;
            d["size"] = new double[] { Math.Round(m.BMax.X - m.BMin.X, 1), Math.Round(m.BMax.Y - m.BMin.Y, 1), Math.Round(m.BMax.Z - m.BMin.Z, 1) };
            List<string> pls = new List<string>(); foreach (MloPlace p in m.Places) if (!pls.Contains(p.Ymap)) pls.Add(p.Ymap); d["ymaps"] = pls;
            d["placed"] = m.Places.Count; d["collision"] = m.Bounds.Count;
            List<string> rn = new List<string>(); for (int i = 1; i < m.RoomNames.Count && rn.Count < 6; i++) rn.Add(m.RoomNames[i]); d["roomNames"] = rn;
            return d;
        }

        // the interiors whose name, type file, map file, pack or room names contain the words searched for (all of them must match)
        public static Dictionary<string, object> List(string q, int max)
        {
            Dictionary<string, object> r = new Dictionary<string, object>(); List<object> items = new List<object>();
            if (!Ready) { r["ready"] = false; r["items"] = items; return r; }
            q = (q ?? "").Trim().ToLowerInvariant(); string[] words = q.Length == 0 ? new string[0] : q.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            // the exact name of an interior typed in: it becomes the interior's name in the list
            if (q.Length > 0 && words.Length == 1) { MloInfo hm; if (byHash.TryGetValue(HashOf(q), out hm) && hm.Name.StartsWith("hash_")) Learn(q, hm); }
            int total = 0;
            foreach (MloInfo m in mlos)
            {
                bool ok = true;
                if (words.Length > 0)
                {
                    StringBuilder hay = new StringBuilder(); hay.Append(m.Name).Append(' ').Append(m.Ytyp).Append(' ').Append(m.Pack).Append(' ').Append(m.Hash.ToString("x8"));
                    foreach (MloPlace p in m.Places) hay.Append(' ').Append(p.Ymap); foreach (string rn in m.RoomNames) hay.Append(' ').Append(rn);
                    string h = hay.ToString().ToLowerInvariant(); foreach (string w in words) if (h.IndexOf(w) < 0) { ok = false; break; }
                }
                if (!ok) continue; total++;
                if (items.Count < max) items.Add(Summary(m));
            }
            r["ready"] = true; r["items"] = items; r["total"] = total; r["all"] = mlos.Count; return r;
        }

        // ---------------- one interior, read again from its .ytyp: rooms, portals, entity sets and where its entities stand (for the plan) ----------------
        // the game's files by name; a test swaps this for files on disk
        public static Func<string, byte[]> GameFile = delegate (string name) { RpfFileEntry e; return Vanilla.Bytes(name, out e); };

        static MloArchetype LoadMlo(MloInfo m, out YtypFile ytyp)
        {
            byte[] data = GameFile(m.Ytyp + ".ytyp"); ytyp = null;
            if (data == null) throw new Exception("The type file " + m.Ytyp + ".ytyp is not in the game files any more.");
            ytyp = new YtypFile(); ytyp.Load(data);
            foreach (Archetype a in ytyp.AllArchetypes) if (a != null && a.Hash.Hash == m.Hash) { MloArchetype ma = a as MloArchetype; if (ma != null) return ma; }
            throw new Exception("The interior " + m.Name + " was not found in " + m.Ytyp + ".ytyp.");
        }

        public static MloInfo Find(string hashOrName)
        {
            if (!Ready) throw new Exception("The list of the game's interiors is not built yet.");
            MloInfo m; uint h; string s = (hashOrName ?? "").Trim();
            if (s.Length == 8 && uint.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out h) && byHash.TryGetValue(h, out m)) return m;
            if (byHash.TryGetValue(HashOf(s), out m)) return m;
            throw new Exception("No interior called " + s + " in the game files.");
        }

        public static Dictionary<string, object> Detail(string key)
        {
            MloInfo m = Find(key); YtypFile y; MloArchetype ma = LoadMlo(m, out y);
            Dictionary<string, object> d = Summary(m);
            d["bmin"] = new double[] { m.BMin.X, m.BMin.Y, m.BMin.Z }; d["bmax"] = new double[] { m.BMax.X, m.BMax.Y, m.BMax.Z };
            List<object> rooms = new List<object>();
            if (ma.rooms != null) foreach (MCMloRoomDef r in ma.rooms)
                {
                    Dictionary<string, object> rd = new Dictionary<string, object>(); rd["name"] = r.RoomName ?? ""; rd["mn"] = new double[] { r.BBMin.X, r.BBMin.Y, r.BBMin.Z }; rd["mx"] = new double[] { r.BBMax.X, r.BBMax.Y, r.BBMax.Z };
                    rd["objects"] = r.AttachedObjects == null ? 0 : r.AttachedObjects.Length; rooms.Add(rd);
                }
            d["roomList"] = rooms;
            List<object> portals = new List<object>();
            if (ma.portals != null) foreach (MCMloPortalDef p in ma.portals)
                {
                    Dictionary<string, object> pd = new Dictionary<string, object>(); pd["from"] = (int)p.Data.roomFrom; pd["to"] = (int)p.Data.roomTo; pd["flags"] = (int)p.Data.flags;
                    List<double> c = new List<double>(); if (p.Corners != null) foreach (SharpDX.Vector4 v in p.Corners) { c.Add(v.X); c.Add(v.Y); c.Add(v.Z); }
                    pd["c"] = c; portals.Add(pd);
                }
            d["portalList"] = portals;
            List<object> sets = new List<object>();
            if (ma.entitySets != null) foreach (MCMloEntitySet s in ma.entitySets) { Dictionary<string, object> sd = new Dictionary<string, object>(); sd["name"] = NameOf(s.Data.name.Hash); sd["n"] = s.Entities == null ? 0 : s.Entities.Length; sets.Add(sd); }
            d["setList"] = sets;
            // where the entities stand (one point each, at most 8000): enough to see the shape of the place in the plan
            List<double> pts = new List<double>();
            if (ma.entities != null) { int step = Math.Max(1, ma.entities.Length / 8000); for (int i = 0; i < ma.entities.Length; i += step) { SharpDX.Vector3 p = ma.entities[i].Data.position; pts.Add(Math.Round(p.X, 2)); pts.Add(Math.Round(p.Y, 2)); pts.Add(Math.Round(p.Z, 2)); } }
            d["points"] = pts;
            List<object> places = new List<object>();
            foreach (MloPlace p in m.Places) { Dictionary<string, object> pd = new Dictionary<string, object>(); pd["ymap"] = p.Ymap; pd["p"] = new double[] { p.P.X, p.P.Y, p.P.Z }; pd["q"] = new double[] { p.R.X, p.R.Y, p.R.Z, p.R.W }; pd["heading"] = Math.Round(p.R.HeadingDeg(), 3); pd["sets"] = p.Sets; places.Add(pd); }
            d["places"] = places; d["bounds"] = m.Bounds;
            return d;
        }

        // ---------------- export: the pieces joined into one MLO ----------------
        class Piece
        {
            public MloInfo Info; public Xf X; public XmlElement Arch; public List<string> Sets; public string Label;
            public int EntBase; public Dictionary<int, int> RoomMap = new Dictionary<int, int>(); public MloPlace Place;
        }
        class PortalRec { public XmlElement El; public int Piece, Room, From, To; public V3 C, N; public double Area; public bool Gone; }

        static XmlElement Child(XmlNode n, string name) { return n == null ? null : n.SelectSingleNode(name) as XmlElement; }
        static V3 GetV(XmlElement e) { return e == null ? new V3(0, 0, 0) : new V3(D(e.GetAttribute("x")), D(e.GetAttribute("y")), D(e.GetAttribute("z"))); }
        static void SetV(XmlElement e, V3 v) { if (e == null) return; e.SetAttribute("x", F(v.X)); e.SetAttribute("y", F(v.Y)); e.SetAttribute("z", F(v.Z)); }
        static List<int> Ints(XmlElement e)
        {
            List<int> l = new List<int>(); if (e == null) return l;
            foreach (string s in e.InnerText.Split(new char[] { ' ', '\n', '\r', '\t', ',' }, StringSplitOptions.RemoveEmptyEntries)) { int v; if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) l.Add(v); }
            return l;
        }
        static void SetInts(XmlElement e, List<int> l)
        {
            if (e == null) return; e.RemoveAll();
            List<string> s = new List<string>(); foreach (int v in l) s.Add(v.ToString(CultureInfo.InvariantCulture)); e.InnerText = string.Join(" ", s.ToArray());
        }
        static int IntVal(XmlElement e, int def) { if (e == null) return def; int v; return int.TryParse(e.GetAttribute("value"), out v) ? v : def; }
        static void SetVal(XmlElement e, string v) { if (e != null) e.SetAttribute("value", v); }
        static string Unique(string n, HashSet<string> used, int piece)
        {
            if (used.Add(n)) return n;
            if (!n.StartsWith("hash_")) { for (int k = 2; ; k++) { string c = n + "_" + k; if (used.Add(c)) return c; } }
            for (int k = 1; ; k++) { string c = "p" + (piece + 1) + "_set" + k; if (used.Add(c)) return c; }
        }

        // an entity of a room or an entity set: moved with its piece. A room entity's turn is stored inverted (the game and CodeWalker read it so).
        static void MoveEntity(XmlElement e, Xf x, int entBase)
        {
            XmlElement pos = Child(e, "position"); SetV(pos, x.Apply(GetV(pos)));
            XmlElement rot = Child(e, "rotation");
            if (rot != null)
            {
                Q s = new Q(D(rot.GetAttribute("x")), D(rot.GetAttribute("y")), D(rot.GetAttribute("z")), D(rot.GetAttribute("w")));
                Q n = (s * x.R.Conj()).Norm(); rot.SetAttribute("x", F(n.X)); rot.SetAttribute("y", F(n.Y)); rot.SetAttribute("z", F(n.Z)); rot.SetAttribute("w", F(n.W));
            }
            XmlElement par = Child(e, "parentIndex"); int pi = IntVal(par, -1); if (pi >= 0) SetVal(par, (pi + entBase).ToString(CultureInfo.InvariantCulture));
        }

        static XmlElement FindArch(XmlDocument doc, uint hash)
        {
            foreach (XmlNode n in doc.SelectNodes("/CMapTypes/archetypes/Item"))
            {
                XmlElement e = n as XmlElement; if (e == null || e.GetAttribute("type") != "CMloArchetypeDef") continue;
                if (HashOf(Child(e, "name").InnerText) == hash) return e;
            }
            return null;
        }

        static readonly string BoundsCommon = "  <Margin value=\"0\" />\n  <Volume value=\"1\" />\n  <Inertia x=\"1\" y=\"1\" z=\"1\" />\n  <MaterialIndex value=\"0\" />\n  <MaterialColourIndex value=\"0\" />\n  <ProceduralID value=\"0\" />\n  <RoomID value=\"0\" />\n  <PedDensity value=\"0\" />\n  <UnkFlags value=\"0\" />\n  <PolyFlags value=\"0\" />\n  <UnkType value=\"1\" />\n";

        // a 4x4 transform as CodeWalker writes it (rows; the move is the last row): child space -> the file's space
        static double[] ParseMatrix(string s)
        {
            List<double> l = new List<double>(); foreach (string t in s.Split(new char[] { ' ', '\n', '\r', '\t', ',' }, StringSplitOptions.RemoveEmptyEntries)) l.Add(D(t));
            if (l.Count != 16) return new double[] { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };
            return l.ToArray();
        }
        static string MatrixText(double[] m, string pad)
        {
            StringBuilder s = new StringBuilder("\n");
            for (int r = 0; r < 4; r++) s.Append(pad + " " + F(m[r * 4]) + " " + F(m[r * 4 + 1]) + " " + F(m[r * 4 + 2]) + " " + F(m[r * 4 + 3]) + "\n");
            return s.Append(pad).ToString();
        }
        // x after the child's own transform: rows of the 3x3 part are where the child's axes go
        static double[] Compose(Xf x, double[] m)
        {
            double[] o = (double[])m.Clone();
            for (int r = 0; r < 3; r++) { V3 a = x.R.Rot(new V3(m[r * 4], m[r * 4 + 1], m[r * 4 + 2])); o[r * 4] = a.X; o[r * 4 + 1] = a.Y; o[r * 4 + 2] = a.Z; }
            V3 t = x.Apply(new V3(m[12], m[13], m[14])); o[12] = t.X; o[13] = t.Y; o[14] = t.Z;
            return o;
        }

        public static Dictionary<string, object> Export(Dictionary<string, object> spec, string outRoot)
        {
            List<string> log = new List<string>(), files = new List<string>(), warns = new List<string>();
            try
            {
                if (!Ready) throw new Exception("Build the list of the game's interiors first.");
                string res = Regex(J.S(J.G(spec, "resource"), ""), "combined_interior", 40);
                string P = Regex(J.S(J.G(spec, "prefix"), ""), "cmb", 10).ToLowerInvariant() + "_"; string mlo = P + "mlo", label = J.S(J.G(spec, "label"), res);
                Dictionary<string, object> pl = J.O(J.G(spec, "placement"));
                double wx = J.D(J.G(pl, "x"), 0), wy = J.D(J.G(pl, "y"), 0), wz = J.D(J.G(pl, "z"), 0), wh = J.D(J.G(pl, "heading"), 0);
                Xf world = new Xf(Q.Yaw(wh), new V3(wx, wy, wz));
                bool link = J.B(J.G(spec, "linkPortals"), true), wantCol = J.B(J.G(spec, "collision"), true), loadOrig = J.B(J.G(spec, "loadOriginals"), false);

                // ---- the pieces ----
                List<Piece> pieces = new List<Piece>(); Dictionary<string, XmlDocument> ytypDocs = new Dictionary<string, XmlDocument>();
                foreach (object po in J.A(J.G(spec, "pieces")))
                {
                    Dictionary<string, object> pd = J.O(po); if (pd == null) continue;
                    Piece p = new Piece(); p.Info = Find(J.S(J.G(pd, "hash"), J.S(J.G(pd, "name"), "")));
                    List<object> q = J.A(J.G(pd, "q")); Q r = q.Count == 4 ? new Q(J.D(q[0], 0), J.D(q[1], 0), J.D(q[2], 0), J.D(q[3], 1)).Norm() : Q.Yaw(J.D(J.G(pd, "heading"), 0));
                    p.X = new Xf(r, new V3(J.D(J.G(pd, "x"), 0), J.D(J.G(pd, "y"), 0), J.D(J.G(pd, "z"), 0)));
                    p.Sets = new List<string>(); foreach (object so in J.A(J.G(pd, "sets"))) p.Sets.Add(J.S(so, ""));
                    p.Label = J.S(J.G(pd, "label"), p.Info.Name);
                    int pi = J.I(J.G(pd, "place"), 0); if (p.Info.Places.Count > 0) p.Place = p.Info.Places[Math.Max(0, Math.Min(p.Info.Places.Count - 1, pi))];
                    XmlDocument yd;
                    if (!ytypDocs.TryGetValue(p.Info.Ytyp, out yd))
                    {
                        YtypFile y; LoadMlo(p.Info, out y); string fn; yd = new XmlDocument(); yd.LoadXml(MetaXml.GetXml(y, out fn)); ytypDocs[p.Info.Ytyp] = yd;
                    }
                    p.Arch = FindArch(yd, p.Info.Hash); if (p.Arch == null) throw new Exception("Could not read " + p.Info.Name + " from " + p.Info.Ytyp + ".ytyp.");
                    pieces.Add(p);
                }
                if (pieces.Count == 0) throw new Exception("Add at least one interior first.");

                // ---- the new MLO: an empty archetype filled piece by piece ----
                XmlDocument doc = new XmlDocument();
                doc.LoadXml("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>\n  <Item type=\"CMloArchetypeDef\">\n   <lodDist value=\"300\" />\n   <flags value=\"0\" />\n   <specialAttribute value=\"0\" />\n   <bbMin x=\"0\" y=\"0\" z=\"0\" />\n   <bbMax x=\"0\" y=\"0\" z=\"0\" />\n   <bsCentre x=\"0\" y=\"0\" z=\"0\" />\n   <bsRadius value=\"0\" />\n   <hdTextureDist value=\"100\" />\n   <name>" + mlo + "</name>\n   <textureDictionary />\n   <clipDictionary />\n   <drawableDictionary />\n   <physicsDictionary>" + mlo + "</physicsDictionary>\n   <assetType>ASSET_TYPE_ASSETLESS</assetType>\n   <assetName>" + mlo + "</assetName>\n   <extensions />\n   <mloFlags value=\"0\" />\n   <entities />\n   <rooms itemType=\"CMloRoomDef\" />\n   <portals itemType=\"CMloPortalDef\" />\n   <entitySets itemType=\"CMloEntitySet\" />\n   <timeCycleModifiers itemType=\"CMloTimeCycleModifier\" />\n  </Item>\n </archetypes>\n <name>" + P + "types</name>\n <dependencies />\n <compositeEntityTypes itemType=\"CCompositeEntityType\" />\n</CMapTypes>");
                XmlElement A = doc.SelectSingleNode("/CMapTypes/archetypes/Item") as XmlElement;
                XmlElement E = Child(A, "entities"), RM = Child(A, "rooms"), PT = Child(A, "portals"), ES = Child(A, "entitySets"), TC = Child(A, "timeCycleModifiers");
                // flags of the whole interior and the lod distance come from the first piece
                foreach (string tag in new string[] { "lodDist", "flags", "specialAttribute", "hdTextureDist", "mloFlags" }) { XmlElement src = Child(pieces[0].Arch, tag); if (src != null) SetVal(Child(A, tag), src.GetAttribute("value")); }

                XmlElement limbo = null; List<int> limboObjs = new List<int>(); HashSet<string> roomNames = new HashSet<string>(), setNames = new HashSet<string>();
                List<PortalRec> prs = new List<PortalRec>(); List<string> defaultSets = new List<string>(), scriptSets = new List<string>();
                V3 bmn = new V3(1e9, 1e9, 1e9), bmx = new V3(-1e9, -1e9, -1e9); int nEnt = 0, nRoom = 1; HashSet<uint> usedArch = new HashSet<uint>();
                for (int pi = 0; pi < pieces.Count; pi++)
                {
                    Piece p = pieces[pi]; p.EntBase = nEnt; Xf x = p.X;
                    x.Box(GetV(Child(p.Arch, "bbMin")), GetV(Child(p.Arch, "bbMax")), ref bmn, ref bmx);
                    foreach (XmlNode n in p.Arch.SelectNodes("entities/Item"))
                    {
                        XmlElement e = (XmlElement)doc.ImportNode(n, true); MoveEntity(e, x, p.EntBase); E.AppendChild(e); nEnt++;
                        XmlElement an = Child(e, "archetypeName"); if (an != null) usedArch.Add(HashOf(an.InnerText));
                    }
                    int ri = 0;
                    foreach (XmlNode n in p.Arch.SelectNodes("rooms/Item"))
                    {
                        XmlElement src = (XmlElement)n; List<int> objs = Ints(Child(src, "attachedObjects")); for (int k = 0; k < objs.Count; k++) objs[k] += p.EntBase;
                        if (ri == 0)
                        {
                            // one limbo (the outside) for the whole interior: the first piece's, with every piece's outside objects
                            if (limbo == null) { limbo = (XmlElement)doc.ImportNode(src, true); RM.AppendChild(limbo); roomNames.Add(Child(limbo, "name").InnerText); }
                            limboObjs.AddRange(objs); p.RoomMap[0] = 0;
                        }
                        else
                        {
                            XmlElement e = (XmlElement)doc.ImportNode(src, true); XmlElement nm = Child(e, "name"); nm.InnerText = Unique(nm.InnerText, roomNames, pi);
                            V3 rmn = new V3(1e9, 1e9, 1e9), rmx = new V3(-1e9, -1e9, -1e9); x.Box(GetV(Child(e, "bbMin")), GetV(Child(e, "bbMax")), ref rmn, ref rmx); SetV(Child(e, "bbMin"), rmn); SetV(Child(e, "bbMax"), rmx);
                            SetInts(Child(e, "attachedObjects"), objs); RM.AppendChild(e); p.RoomMap[ri] = nRoom++;
                        }
                        ri++;
                    }
                    foreach (XmlNode n in p.Arch.SelectNodes("portals/Item"))
                    {
                        XmlElement e = (XmlElement)doc.ImportNode(n, true); PortalRec pr = new PortalRec(); pr.El = e; pr.Piece = pi;
                        int rf = IntVal(Child(e, "roomFrom"), 0), rt = IntVal(Child(e, "roomTo"), 0), mf, mt; p.RoomMap.TryGetValue(rf, out mf); p.RoomMap.TryGetValue(rt, out mt);
                        pr.From = mf; pr.To = mt; SetVal(Child(e, "roomFrom"), mf.ToString()); SetVal(Child(e, "roomTo"), mt.ToString());
                        List<V3> cs = new List<V3>();
                        foreach (XmlNode cn in e.SelectNodes("corners/Item"))
                        {
                            string[] t = cn.InnerText.Split(','); if (t.Length < 3) continue; V3 w = x.Apply(new V3(D(t[0]), D(t[1]), D(t[2]))); cs.Add(w);
                            cn.InnerText = F(w.X) + ", " + F(w.Y) + ", " + F(w.Z) + (t.Length > 3 ? ", " + t[3].Trim() : ", 0");
                        }
                        List<int> objs = Ints(Child(e, "attachedObjects")); for (int k = 0; k < objs.Count; k++) objs[k] += p.EntBase; SetInts(Child(e, "attachedObjects"), objs);
                        if (cs.Count == 4)
                        {
                            pr.C = (cs[0] + cs[1] + cs[2] + cs[3]) * 0.25; V3 a = cs[2] - cs[0], b = cs[3] - cs[1];
                            V3 nn = new V3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X); double l = nn.Len(); pr.Area = l / 2; pr.N = l > 1e-9 ? nn * (1 / l) : new V3(0, 0, 1);
                        }
                        pr.Room = mf == 0 ? mt : (mt == 0 ? mf : -1); prs.Add(pr);
                    }
                    foreach (XmlNode n in p.Arch.SelectNodes("entitySets/Item"))
                    {
                        XmlElement e = (XmlElement)doc.ImportNode(n, true); XmlElement nm = Child(e, "name"); string orig = nm.InnerText.Trim(); string nn = Unique(orig, setNames, pi); nm.InnerText = nn;
                        List<int> locs = Ints(Child(e, "locations")); for (int k = 0; k < locs.Count; k++) { int m2; locs[k] = p.RoomMap.TryGetValue(locs[k], out m2) ? m2 : 0; } SetInts(Child(e, "locations"), locs);
                        foreach (XmlNode en in e.SelectNodes("entities/Item")) { MoveEntity((XmlElement)en, x, 0); XmlElement an = Child((XmlElement)en, "archetypeName"); if (an != null) usedArch.Add(HashOf(an.InnerText)); }
                        ES.AppendChild(e);
                        if (p.Sets.Contains(orig)) { defaultSets.Add(nn); if (!nn.StartsWith("hash_")) scriptSets.Add(nn); }
                    }
                    foreach (XmlNode n in p.Arch.SelectNodes("timeCycleModifiers/Item"))
                    {
                        XmlElement e = (XmlElement)doc.ImportNode(n, true); XmlElement sp = Child(e, "sphere");
                        if (sp != null) { V3 c = x.Apply(GetV(sp)); SetV(sp, c); }
                        TC.AppendChild(e);
                    }
                    log.Add(p.Label + ": " + p.Arch.SelectNodes("entities/Item").Count + " entities, " + (p.RoomMap.Count - 1) + " rooms, " + p.Arch.SelectNodes("portals/Item").Count + " portals, " + p.Arch.SelectNodes("entitySets/Item").Count + " entity sets");
                }
                if (limbo == null) throw new Exception("The first interior has no rooms.");
                SetInts(Child(limbo, "attachedObjects"), limboObjs);

                // ---- portals of two pieces that meet (same place, same size, same plane): one portal from room to room, so you can walk and see straight through ----
                if (link && pieces.Count > 1)
                {
                    int linked = 0;
                    for (int i = 0; i < prs.Count; i++)
                    {
                        PortalRec a = prs[i]; if (a.Gone || a.Room <= 0 || a.Area <= 0) continue;
                        for (int j = i + 1; j < prs.Count; j++)
                        {
                            PortalRec b = prs[j]; if (b.Gone || b.Room <= 0 || b.Piece == a.Piece || b.Area <= 0) continue;
                            double dot = Math.Abs(a.N.X * b.N.X + a.N.Y * b.N.Y + a.N.Z * b.N.Z), ratio = a.Area / b.Area;
                            if ((a.C - b.C).Len() > 0.35 || dot < 0.9 || ratio < 0.5 || ratio > 2) continue;
                            SetVal(Child(a.El, "roomFrom"), a.Room.ToString()); SetVal(Child(a.El, "roomTo"), b.Room.ToString()); a.From = a.Room; a.To = b.Room;
                            List<int> objs = Ints(Child(a.El, "attachedObjects")); foreach (int o in Ints(Child(b.El, "attachedObjects"))) if (!objs.Contains(o)) objs.Add(o); SetInts(Child(a.El, "attachedObjects"), objs);
                            b.Gone = true; a.Room = -1; linked++;
                            log.Add("joined a portal of " + pieces[a.Piece].Label + " and one of " + pieces[b.Piece].Label + " at " + F(Math.Round(a.C.X, 2)) + ", " + F(Math.Round(a.C.Y, 2)) + ", " + F(Math.Round(a.C.Z, 2)));
                            break;
                        }
                    }
                    if (linked == 0) log.Add("no portals of different pieces meet, so the pieces are joined through the outside (limbo), like the game's own separate interiors");
                }
                int nPortals = 0; foreach (PortalRec pr in prs) if (!pr.Gone) { PT.AppendChild(pr.El); nPortals++; }
                // every room's portal count
                {
                    int ri = 0;
                    foreach (XmlNode n in RM.SelectNodes("Item")) { int c = 0; foreach (PortalRec pr in prs) if (!pr.Gone && (pr.From == ri || pr.To == ri)) c++; SetVal(Child((XmlElement)n, "portalCount"), c.ToString()); ri++; }
                }
                SetV(Child(A, "bbMin"), bmn); SetV(Child(A, "bbMax"), bmx); SetV(Child(A, "bsCentre"), (bmn + bmx) * 0.5); SetVal(Child(A, "bsRadius"), F((bmx - bmn).Len() * 0.5));
                if (nRoom > 32) warns.Add("The joined interior has " + (nRoom - 1) + " rooms. The game's collision can name only 31 rooms, so the collision of rooms after the 31st says 'outside' there: the interior may switch to outside lighting or vanish in those rooms. Use fewer pieces, or pieces with fewer rooms.");
                if (nEnt > 10000) warns.Add("The joined interior has " + nEnt + " entities; that is a lot for one interior and may stream slowly.");
                log.Add("joined: " + nEnt + " entities, " + (nRoom - 1) + " rooms, " + nPortals + " portals, " + ES.ChildNodes.Count + " entity sets, " + TC.ChildNodes.Count + " timecycle modifiers");

                // ---- files ----
                string dir = Path.Combine(outRoot, res), stream = Path.Combine(dir, "stream"), client = Path.Combine(dir, "client");
                Directory.CreateDirectory(stream); Directory.CreateDirectory(client);
                foreach (string old in Directory.GetFiles(stream)) { try { File.Delete(old); } catch { } }
                long total = 0;
                total += Save(Path.Combine(stream, P + "types.ytyp"), XmlMeta.GetRSCData(doc), files);

                // ---- collision: the game's own collision files of every piece, moved into the new interior, in one file ----
                int colChildren = 0;
                if (wantCol)
                {
                    StringBuilder kids = new StringBuilder(); V3 cmn = new V3(1e9, 1e9, 1e9), cmx = new V3(-1e9, -1e9, -1e9); XmlDocument cdoc = new XmlDocument();
                    cdoc.LoadXml("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BoundsFile>\n <Bounds type=\"Composite\">\n  <BoxMin x=\"0\" y=\"0\" z=\"0\" />\n  <BoxMax x=\"0\" y=\"0\" z=\"0\" />\n  <BoxCenter x=\"0\" y=\"0\" z=\"0\" />\n  <SphereCenter x=\"0\" y=\"0\" z=\"0\" />\n  <SphereRadius value=\"0\" />\n" + BoundsCommon + "  <Children />\n </Bounds>\n</BoundsFile>");
                    XmlElement croot = cdoc.SelectSingleNode("/BoundsFile/Bounds") as XmlElement, ckids = Child(croot, "Children");
                    for (int pi = 0; pi < pieces.Count; pi++)
                    {
                        Piece p = pieces[pi];
                        if (p.Info.Bounds.Count == 0) { warns.Add(p.Label + ": the game lists no collision file for this interior, so it has no floor to stand on in the copy. Add collision boxes in an imported-model project, or pick another piece."); continue; }
                        foreach (string bn in p.Info.Bounds)
                        {
                            byte[] bb = GameFile(bn + ".ybn"); if (bb == null) { warns.Add(bn + ".ybn is not in the game files."); continue; }
                            YbnFile yb = new YbnFile(); yb.Load(bb); if (yb.Bounds == null) continue;
                            XmlDocument bd = new XmlDocument(); bd.LoadXml(YbnXml.GetXml(yb)); XmlElement root = bd.SelectSingleNode("/BoundsFile/Bounds") as XmlElement; if (root == null) continue;
                            // which room a piece of collision belongs to: the piece's room numbers become the joined interior's
                            int over = 0;
                            foreach (XmlNode rn in bd.GetElementsByTagName("RoomID"))
                            {
                                XmlElement re = (XmlElement)rn; int r = IntVal(re, 0), m2; if (!p.RoomMap.TryGetValue(r, out m2)) m2 = 0;
                                if (m2 > 31) { m2 = 0; over++; }
                                re.SetAttribute("value", m2.ToString());
                            }
                            if (over > 0) warns.Add(bn + ": " + over + " collision materials belong to rooms after the 31st and now say 'outside'.");
                            // a game interior's collision is normally in the interior's own space; if it is in world space (near where the game places the interior), it is brought back first
                            V3 smn = GetV(Child(root, "BoxMin")), smx = GetV(Child(root, "BoxMax")), sc = (smn + smx) * 0.5, lc = (p.Info.BMin + p.Info.BMax) * 0.5;
                            Xf m = p.X;
                            if (p.Place != null)
                            {
                                Xf inst = new Xf(p.Place.R, p.Place.P); V3 wc = inst.Apply(lc);
                                if ((sc - wc).Len() < (sc - lc).Len()) { m = p.X * inst.Inverse(); log.Add(bn + ".ybn is in world space; moved back into the interior first"); }
                            }
                            m.Box(smn, smx, ref cmn, ref cmx);
                            List<XmlElement> items = new List<XmlElement>();
                            if (root.GetAttribute("type") == "Composite") { foreach (XmlNode cn in root.SelectNodes("Children/Item")) items.Add((XmlElement)cn); }
                            else
                            {
                                // one shape on its own: it becomes a child of the joined file, with a transform of its own
                                XmlElement it = bd.CreateElement("Item"); it.SetAttribute("type", root.GetAttribute("type"));
                                foreach (XmlNode cn in root.ChildNodes) it.AppendChild(cn.CloneNode(true));
                                XmlElement ct = bd.CreateElement("CompositeTransform"); ct.InnerText = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"; it.AppendChild(ct);
                                XmlElement f1 = bd.CreateElement("CompositeFlags1"); f1.InnerText = "MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE"; it.AppendChild(f1);
                                XmlElement f2 = bd.CreateElement("CompositeFlags2"); f2.InnerText = "UNKNOWN, MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, OBJECT_ENV_CLOTH, PLANT, PROJECTILE, EXPLOSION, PICKUP, FOLIAGE, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS, MAP_RIVER, SMOKE, UNSMASHED, MAP_STAIRS, MAP_DEEP_SURFACE"; it.AppendChild(f2);
                                items.Add(it);
                            }
                            foreach (XmlElement it in items)
                            {
                                XmlElement ct = Child(it, "CompositeTransform"); if (ct == null) { ct = it.OwnerDocument.CreateElement("CompositeTransform"); ct.InnerText = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"; it.AppendChild(ct); }
                                ct.InnerText = MatrixText(Compose(m, ParseMatrix(ct.InnerText)), "    ");
                                ckids.AppendChild(cdoc.ImportNode(it, true)); colChildren++;
                            }
                            log.Add("collision " + bn + ".ybn: " + items.Count + " part(s)");
                        }
                    }
                    if (colChildren > 0)
                    {
                        SetV(Child(croot, "BoxMin"), cmn); SetV(Child(croot, "BoxMax"), cmx); SetV(Child(croot, "BoxCenter"), (cmn + cmx) * 0.5); SetV(Child(croot, "SphereCenter"), (cmn + cmx) * 0.5); SetVal(Child(croot, "SphereRadius"), F((cmx - cmn).Len() * 0.5));
                        YbnFile ybn = XmlYbn.GetYbn(cdoc); total += Save(Path.Combine(stream, mlo + ".ybn"), ybn.Save(), files);
                    }
                }
                else warns.Add("Collision was left out: you will fall through the floors.");

                // ---- where it stands, and the manifest that ties the interior to its collision and to the game's type files it needs ----
                V3 emn = new V3(1e9, 1e9, 1e9), emx = new V3(-1e9, -1e9, -1e9); world.Box(bmn, bmx, ref emn, ref emx);
                XmlDocument ymapDoc = new XmlDocument(); ymapDoc.LoadXml(YmapXml(P + "milo_", mlo, world, emn, emx, defaultSets));
                total += Save(Path.Combine(stream, P + "milo_.ymap"), XmlMeta.GetRSCData(ymapDoc), files);
                // the game's type files that define the models the entities use: the game loads them with this interior
                List<string> deps = new List<string>(); Dictionary<uint, string> ay = ArchYtyps(); int missing = 0;
                foreach (Piece p in pieces) if (!deps.Contains(p.Info.Ytyp)) deps.Add(p.Info.Ytyp);
                foreach (uint h in usedArch) { string yt; if (ay.TryGetValue(h, out yt)) { if (!deps.Contains(yt)) deps.Add(yt); } else missing++; }
                if (ay.Count == 0) warns.Add("The list of which type file defines each model is missing (rebuild the interior list); only the pieces' own type files are listed as dependencies.");
                else if (missing > 0) warns.Add(missing + " model name(s) used by the entities are not defined in any type file of the game; those entities will not show.");
                log.Add("type files of the game this interior needs: " + string.Join(", ", deps.ToArray()));
                XmlDocument mfDoc = new XmlDocument(); mfDoc.LoadXml(ManifestXml(P, mlo, colChildren > 0, deps));
                total += Save(Path.Combine(stream, "_manifest_" + P.TrimEnd('_') + ".ymf"), XmlMeta.GetPSOData(mfDoc), files);

                // ---- test spot: the middle of the first room of the first piece, a little over its floor ----
                V3 spot = world.T;
                {
                    XmlNodeList rl = RM.SelectNodes("Item");
                    if (rl.Count > 1) { V3 a = GetV(Child((XmlElement)rl[1], "bbMin")), b = GetV(Child((XmlElement)rl[1], "bbMax")); spot = world.Apply(new V3((a.X + b.X) / 2, (a.Y + b.Y) / 2, a.Z + 1.0)); }
                }
                // ---- the originals: loading their map files makes sure the game loads their models; only when the copy is somewhere else ----
                List<string> origIpls = new List<string>();
                foreach (Piece p in pieces)
                {
                    if (p.Place == null) continue;
                    V3 orig = new Xf(p.Place.R, p.Place.P).Apply((p.Info.BMin + p.Info.BMax) * 0.5), here = world.Apply(p.X.Apply((p.Info.BMin + p.Info.BMax) * 0.5));
                    if ((orig - here).Len() < 60) { warns.Add(p.Label + " stands within 60 m of where the game has its own copy (" + p.Place.Ymap + "). If the game's copy is loaded too, the two overlap: move the interior, or keep the original's map file unloaded."); if (loadOrig) warns.Add("Loading " + p.Place.Ymap + " was left out for that reason."); continue; }
                    if (loadOrig && !origIpls.Contains(p.Place.Ymap)) origIpls.Add(p.Place.Ymap);
                }

                // ---- resource ----
                StringBuilder fx = new StringBuilder("fx_version 'cerulean'\ngame 'gta5'\nlua54 'yes'\nthis_is_a_map 'yes'\n\nauthor 'MLO Creator'\ndescription '" + label.Replace("'", "") + "'\nversion '1.0.0'\n\ndata_file 'DLC_ITYP_REQUEST' 'stream/" + P + "types.ytyp'\n\nclient_script 'client/ipl.lua'\n");
                WriteText(Path.Combine(dir, "fxmanifest.lua"), fx.ToString());
                StringBuilder lua = new StringBuilder("-- Loads the joined interior's placement map, and the entity sets you ticked.\n");
                lua.Append("local spot = vector3(" + F(Math.Round(spot.X, 3)) + ", " + F(Math.Round(spot.Y, 3)) + ", " + F(Math.Round(spot.Z, 3)) + ")\n");
                lua.Append("local entitySets = {"); for (int i = 0; i < scriptSets.Count; i++) lua.Append((i > 0 ? ", " : " ") + "'" + scriptSets[i] + "'"); lua.Append(scriptSets.Count > 0 ? " }\n" : "}\n");
                lua.Append("local originals = {"); for (int i = 0; i < origIpls.Count; i++) lua.Append((i > 0 ? ", " : " ") + "'" + origIpls[i] + "'"); lua.Append(origIpls.Count > 0 ? " }   -- the game's own map files of the pieces (their models load with them)\n" : "}\n");
                lua.Append("\nCreateThread(function()\n    Wait(3000)\n    for _, ipl in ipairs(originals) do RequestIpl(ipl) end\n    RequestIpl('" + P + "milo_')\n    if #entitySets == 0 then return end\n    local id, tries = 0, 0\n    repeat\n        Wait(500)\n        id = GetInteriorAtCoords(spot.x, spot.y, spot.z)\n        tries = tries + 1\n    until IsValidInterior(id) or tries > 40\n    if not IsValidInterior(id) then return end\n    for _, name in ipairs(entitySets) do\n        if not IsInteriorEntitySetActive(id, name) then ActivateInteriorEntitySet(id, name) end\n    end\n    RefreshInterior(id)\nend)\n");
                WriteText(Path.Combine(client, "ipl.lua"), lua.ToString());

                StringBuilder rd = new StringBuilder("# " + label + "\n\nThe game's own interiors joined into one MLO by MLO Creator. It uses the game's models and textures (nothing of them is copied here), so the game must have them: interiors of a DLC need a server game build that has that DLC (`sv_enforceGameBuild`), for example at least 2060 for the Diamond Casino and Resort (pack `mpvinewood`).\n\n## Install\n\n1. Upload the `" + res + "` folder to the server's resources folder.\n2. `refresh`, then `ensure " + res + "`.\n3. The names `" + P + "...` must be unique on the server.\n\n## Where it is\n\n- Origin " + F(wx) + ", " + F(wy) + ", " + F(wz) + "  heading " + F(wh) + "\n- Test spot (teleport here): `" + F(Math.Round(spot.X, 3)) + ", " + F(Math.Round(spot.Y, 3)) + ", " + F(Math.Round(spot.Z, 3)) + "`\n\n## Pieces\n\n");
                foreach (Piece p in pieces)
                {
                    rd.Append("- **" + p.Label + "** (`" + p.Info.Name + "` from `" + p.Info.Ytyp + ".ytyp`, pack " + p.Info.Pack + "): moved by " + F(Math.Round(p.X.T.X, 3)) + ", " + F(Math.Round(p.X.T.Y, 3)) + ", " + F(Math.Round(p.X.T.Z, 3)) + ", turned " + F(Math.Round(p.X.R.HeadingDeg(), 3)) + " degrees");
                    rd.Append((p.Sets.Count > 0 ? "; entity sets on: " + string.Join(", ", p.Sets.ToArray()) : "; no entity sets on") + "\n");
                }
                rd.Append("\n## Entity sets\n\nThe ticked sets are on by default (in the placement map), and `client/ipl.lua` switches on the ones with a readable name once the interior has loaded. To switch others from your own script: `ActivateInteriorEntitySet(GetInteriorAtCoords(x, y, z), name)` then `RefreshInterior`.\n");
                rd.Append("\n## What to check in the game\n\nStreaming, portals (what you can see from room to room), lighting, collision and doors all have to be seen in the game. Pieces joined through the outside work like separate interiors next to each other; portals of two pieces that meet in the same place are joined into one.\n");
                if (warns.Count > 0) rd.Append("\n## Warnings from the export\n\n- " + string.Join("\n- ", warns.ToArray()) + "\n");
                WriteText(Path.Combine(dir, "README.md"), rd.ToString());

                Dictionary<string, object> ok = new Dictionary<string, object>();
                ok["ok"] = true; ok["dir"] = dir; ok["resource"] = res; ok["files"] = files; ok["log"] = log; ok["warnings"] = warns; ok["bytes"] = total;
                ok["spot"] = new double[] { Math.Round(spot.X, 3), Math.Round(spot.Y, 3), Math.Round(spot.Z, 3) };
                return ok;
            }
            catch (Exception ex)
            {
                Dictionary<string, object> bad = new Dictionary<string, object>(); bad["ok"] = false; bad["error"] = ex.Message; bad["detail"] = ex.ToString(); bad["log"] = log; return bad;
            }
        }

        static string Regex(string s, string def, int max)
        {
            s = System.Text.RegularExpressions.Regex.Replace(s ?? "", "[^A-Za-z0-9_]", "_").Trim('_'); if (s.Length == 0) s = def; if (s.Length > max) s = s.Substring(0, max); return s;
        }
        static long Save(string path, byte[] bytes, List<string> files)
        {
            File.WriteAllBytes(path, bytes); files.Add(Path.GetFileName(path) + "  (" + (bytes.Length / 1024.0).ToString("0.#", CultureInfo.InvariantCulture) + " KB)"); return bytes.Length;
        }
        static void WriteText(string path, string text) { File.WriteAllText(path, text.Replace("\r\n", "\n"), new UTF8Encoding(false)); }

        static string YmapXml(string mapName, string mlo, Xf world, V3 emn, V3 emx, List<string> sets)
        {
            StringBuilder ds = new StringBuilder(); foreach (string s in sets) ds.Append("\n    <Item>" + s + "</Item>");
            string dset = sets.Count == 0 ? "<defaultEntitySets />" : "<defaultEntitySets>" + ds + "\n   </defaultEntitySets>";
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapData>\n <name>" + mapName + "</name>\n <parent />\n <flags value=\"1\" />\n <contentFlags value=\"9\" />\n" +
                " <streamingExtentsMin x=\"" + F(emn.X - 300) + "\" y=\"" + F(emn.Y - 300) + "\" z=\"" + F(emn.Z - 300) + "\" />\n <streamingExtentsMax x=\"" + F(emx.X + 300) + "\" y=\"" + F(emx.Y + 300) + "\" z=\"" + F(emx.Z + 300) + "\" />\n" +
                " <entitiesExtentsMin x=\"" + F(emn.X) + "\" y=\"" + F(emn.Y) + "\" z=\"" + F(emn.Z) + "\" />\n <entitiesExtentsMax x=\"" + F(emx.X) + "\" y=\"" + F(emx.Y) + "\" z=\"" + F(emx.Z) + "\" />\n" +
                " <entities>\n  <Item type=\"CMloInstanceDef\">\n   <archetypeName>" + mlo + "</archetypeName>\n   <flags value=\"32\" />\n   <guid value=\"0\" />\n   <position x=\"" + F(world.T.X) + "\" y=\"" + F(world.T.Y) + "\" z=\"" + F(world.T.Z) + "\" />\n   <rotation x=\"" + F(world.R.X) + "\" y=\"" + F(world.R.Y) + "\" z=\"" + F(world.R.Z) + "\" w=\"" + F(world.R.W) + "\" />\n   <scaleXY value=\"1\" />\n   <scaleZ value=\"1\" />\n   <parentIndex value=\"-1\" />\n   <lodDist value=\"300\" />\n   <childLodDist value=\"0\" />\n   <lodLevel>LODTYPES_DEPTH_ORPHANHD</lodLevel>\n   <numChildren value=\"0\" />\n   <priorityLevel>PRI_REQUIRED</priorityLevel>\n   <extensions />\n   <ambientOcclusionMultiplier value=\"255\" />\n   <artificialAmbientOcclusion value=\"255\" />\n   <tintValue value=\"0\" />\n   <groupId value=\"0\" />\n   <floorId value=\"0\" />\n   " + dset + "\n   <numExitPortals value=\"0\" />\n   <MLOInstflags value=\"0\" />\n  </Item>\n </entities>\n" +
                " <containerLods itemType=\"rage__fwContainerLodDef\" />\n <boxOccluders itemType=\"BoxOccluder\" />\n <occludeModels itemType=\"OccludeModel\" />\n <physicsDictionaries />\n <instancedData>\n  <ImapLink />\n  <PropInstanceList itemType=\"rage__fwPropInstanceListDef\" />\n  <GrassInstanceList itemType=\"rage__fwGrassInstanceListDef\" />\n </instancedData>\n <timeCycleModifiers itemType=\"CTimeCycleModifier\" />\n <carGenerators itemType=\"CCarGen\" />\n <LODLightsSOA>\n  <direction itemType=\"FloatXYZ\" />\n  <falloff />\n  <falloffExponent />\n  <timeAndStateFlags />\n  <hash />\n  <coneInnerAngle />\n  <coneOuterAngleOrCapExt />\n  <coronaIntensity />\n </LODLightsSOA>\n <DistantLODLightsSOA>\n  <position itemType=\"FloatXYZ\" />\n  <RGBI />\n  <numStreetLights value=\"0\" />\n  <category value=\"0\" />\n </DistantLODLightsSOA>\n <block>\n  <version value=\"0\" />\n  <flags value=\"0\" />\n  <name>" + mapName + "</name>\n  <exportedBy>MLO Creator</exportedBy>\n  <owner></owner>\n  <time>" + DateTime.Now.ToString("d MMMM yyyy HH:mm", CultureInfo.InvariantCulture) + "</time>\n </block>\n</CMapData>\n";
        }

        static string ManifestXml(string P, string mlo, bool bounds, List<string> deps)
        {
            StringBuilder d = new StringBuilder(); d.Append("\n    <Item>" + P + "types</Item>"); foreach (string y in deps) d.Append("\n    <Item>" + y + "</Item>");
            StringBuilder dd = new StringBuilder(); foreach (string y in deps) dd.Append("\n    <Item>" + y + "</Item>");
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CPackFileMetaData>\n <MapDataGroups itemType=\"CMapDataGroup\" />\n <HDTxdBindingArray itemType=\"CHDTxdAssetBinding\" />\n <imapDependencies itemType=\"CImapDependency\" />\n <imapDependencies_2 itemType=\"CImapDependencies\">\n  <Item>\n   <imapName>" + P + "milo_</imapName>\n   <manifestFlags>INTERIOR_DATA</manifestFlags>\n   <itypDepArray>" + d + "\n   </itypDepArray>\n  </Item>\n </imapDependencies_2>\n <itypDependencies_2 itemType=\"CItypDependencies\">\n  <Item>\n   <itypName>" + P + "types</itypName>\n   <manifestFlags>INTERIOR_DATA</manifestFlags>\n   " + (deps.Count == 0 ? "<itypDepArray />" : "<itypDepArray>" + dd + "\n   </itypDepArray>") + "\n  </Item>\n </itypDependencies_2>\n <Interiors itemType=\"CInteriorBoundsFiles\">\n  <Item>\n   <Name>" + mlo + "</Name>\n   " + (bounds ? "<Bounds>\n    <Item>" + mlo + "</Item>\n   </Bounds>" : "<Bounds />") + "\n  </Item>\n </Interiors>\n</CPackFileMetaData>\n";
        }
    }
}
