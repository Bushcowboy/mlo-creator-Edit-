// The props the Place props tool offers, from what the project is made of: the props its imported map files place, model files of the project that nothing
// places, the props the game places around the building, the other models of the game archive the building comes from, the props of a game interior
// (the ones near the building first), and a search of every model of the game. C# 5.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public static class Assets
    {
        // never offered: lower-detail copies, shadow and proxy meshes, nameless models
        static readonly Regex Skip = new Regex("(_lod\\d*$|^slod|_slod\\d*|_proxy|_shadow|_occl|^lod_)", RegexOptions.IgnoreCase);
        public static bool Offered(string n) { return !string.IsNullOrEmpty(n) && !Skip.IsMatch(n); }

        static Dictionary<string, object> Item(string n, int c, string src)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(); d["n"] = n; d["c"] = c; if (src != null) d["src"] = src; return d;
        }
        static List<object> Sorted(Dictionary<string, int> count, string src, int max)
        {
            List<KeyValuePair<string, int>> l = new List<KeyValuePair<string, int>>(count);
            l.Sort(delegate (KeyValuePair<string, int> a, KeyValuePair<string, int> b) { int c = b.Value.CompareTo(a.Value); return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key); });
            List<object> r = new List<object>(); foreach (KeyValuePair<string, int> kv in l) { if (r.Count >= max) break; r.Add(Item(kv.Key, kv.Value, src)); }
            return r;
        }

        // ---- the project's own files ----
        // The props the imported map files (.ymap) place, without the building's own models (the model files of the project), counted;
        // then the project's model files that no map file places and that are not the building: models of your own to place by hand.
        // (gta: when a name is only known as a number and the game's folder is set, the game's file names are read to name it)
        public static List<object> FromFiles(string project, string target) { return FromFiles(project, target, null); }
        public static List<object> FromFiles(string project, string target, string gta)
        {
            string dir = ImportHost.FilesDir(project); List<object> r = new List<object>(); if (!Directory.Exists(dir)) return r;
            HashSet<string> own = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string f in Directory.GetFiles(dir, "*.ydr")) { string n = Path.GetFileNameWithoutExtension(f).ToLowerInvariant(); own.Add(n); JenkIndex.Ensure(n); }
            Dictionary<uint, int> byHash = new Dictionary<uint, int>(); HashSet<uint> ownHash = new HashSet<uint>(); foreach (string n in own) ownHash.Add(JenkHash.GenHash(n));
            HashSet<string> placed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string f in Directory.GetFiles(dir, "*.ymap"))
            {
                try
                {
                    YmapFile y = new YmapFile(); y.Load(File.ReadAllBytes(f)); if (y.AllEntities == null) continue;
                    foreach (YmapEntityDef en in y.AllEntities)
                    {
                        if (en == null || en.IsMlo) continue;
                        string lod = en.CEntityDef.lodLevel.ToString(); if (lod != "LODTYPES_DEPTH_HD" && lod != "LODTYPES_DEPTH_ORPHANHD") continue;
                        uint h = en.CEntityDef.archetypeName.Hash;
                        if (ownHash.Contains(h)) { placed.Add(Interiors.NameOf(h).ToLowerInvariant()); continue; }                 // (the building and its detail models)
                        int c; byHash.TryGetValue(h, out c); byHash[h] = c + 1;
                    }
                }
                catch (Exception) { }
            }
            // names the program does not know yet: the game's file names know most of them
            bool unknown = false; foreach (uint h in byHash.Keys) if (string.IsNullOrEmpty(JenkIndex.TryGetString(h))) { unknown = true; break; }
            if (unknown && !Vanilla.Ready && !string.IsNullOrWhiteSpace(gta) && File.Exists(Path.Combine(gta, "GTA5.exe"))) { try { Vanilla.Init(gta, ImportHost.CacheDir); } catch (Exception) { } }
            Dictionary<string, int> count = new Dictionary<string, int>();
            foreach (KeyValuePair<uint, int> kv in byHash) { string n = Interiors.NameOf(kv.Key).ToLowerInvariant(); if (!Offered(n)) continue; int c; count.TryGetValue(n, out c); count[n] = c + kv.Value; }
            r.AddRange(Sorted(count, "map", 300));
            string tgt = Path.GetFileNameWithoutExtension(target ?? "").ToLowerInvariant();
            List<string> loose = new List<string>(); foreach (string n in own) if (n != tgt && !placed.Contains(n) && Offered(n)) loose.Add(n);
            loose.Sort(StringComparer.Ordinal); foreach (string n in loose) r.Add(Item(n, 0, "own"));
            return r;
        }

        // ---- the game ----
        // the props the game's map places around the building (its footprint and 25 m), by how often each model stands there
        public static List<object> Near(string project, string target, string gta, Dictionary<string, object> entity)
        {
            Vanilla.Init(gta, ImportHost.CacheDir); double[] box = ImportHost.ModelWorldBox(project, target, entity); List<object> r = new List<object>(); if (box == null) return r;
            HashSet<string> own = new HashSet<string>(StringComparer.OrdinalIgnoreCase); string dir = ImportHost.FilesDir(project);
            if (Directory.Exists(dir)) foreach (string f in Directory.GetFiles(dir, "*.ydr")) own.Add(Path.GetFileNameWithoutExtension(f));
            List<PropHit> hits = Vanilla.PropsInBox(box[0] - 25, box[1] - 25, box[2] + 25, box[3] + 25, delegate (string n) { return false; }, null, true, delegate (string n) { return own.Contains(n) || !Offered(n) || n.StartsWith("hash_", StringComparison.OrdinalIgnoreCase); });
            Dictionary<string, int> count = new Dictionary<string, int>(); Dictionary<string, string> kind = new Dictionary<string, string>();
            foreach (PropHit p in hits) { string n = p.Name.ToLowerInvariant(); if (own.Contains(n)) continue; int c; count.TryGetValue(n, out c); count[n] = c + 1; kind[n] = p.Kind; }
            foreach (object o in Sorted(count, "near", 250)) { Dictionary<string, object> d = (Dictionary<string, object>)o; d["k"] = kind[(string)d["n"]]; r.Add(d); }
            return r;
        }

        // the other models of the game archive (.rpf) that holds the building's model: what was made for the same block
        public static Dictionary<string, object> Archive(string target, string gta)
        {
            Vanilla.Init(gta, ImportHost.CacheDir); Dictionary<string, object> res = new Dictionary<string, object>(); List<object> r = new List<object>(); res["items"] = r;
            string stem = Path.GetFileNameWithoutExtension(target ?? "").ToLowerInvariant(); RpfFile owner; RpfFileEntry e = Vanilla.GetEntry(stem + ".ydr", out owner);
            if (e == null || owner == null) { res["archive"] = ""; res["note"] = "The building's model " + stem + ".ydr is not a file of the game (or the game's files are not read)."; return res; }
            res["archive"] = owner.Path; List<string> names = new List<string>();
            foreach (RpfEntry re in owner.AllEntries)
            {
                RpfFileEntry fe = re as RpfFileEntry; if (fe == null) continue; string n = fe.Name.ToLowerInvariant();
                if (!n.EndsWith(".ydr") && !n.EndsWith(".yft")) continue; string b = Path.GetFileNameWithoutExtension(n);
                if (b == stem || !Offered(b) || b.EndsWith("_hi")) continue;
                if (fe.GetFileSize() > 1500000) continue;                              // (whole buildings)
                if (!names.Contains(b)) names.Add(b);
            }
            names.Sort(StringComparer.Ordinal); foreach (string n in names) { if (r.Count >= 300) break; r.Add(Item(n, 0, "archive")); }
            return res;
        }

        // every model of the game whose name has all the words searched for (props first: prop_ and v_ names)
        public static Dictionary<string, object> Search(string q, string gta, int max)
        {
            Vanilla.Init(gta, ImportHost.CacheDir); Dictionary<string, object> res = new Dictionary<string, object>(); List<object> r = new List<object>(); res["items"] = r;
            string[] words = (q ?? "").Trim().ToLowerInvariant().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries); if (words.Length == 0) { res["total"] = 0; return res; }
            HashSet<string> seen = new HashSet<string>(); List<string> hits = new List<string>();
            foreach (string ext in new string[] { ".ydr", ".yft" })
                foreach (string f in Vanilla.Names(ext))
                {
                    string b = f.Substring(0, f.Length - ext.Length); if (seen.Contains(b) || !Offered(b) || b.EndsWith("_hi")) continue;
                    bool ok = true; foreach (string w in words) if (b.IndexOf(w, StringComparison.Ordinal) < 0) { ok = false; break; }
                    if (ok) { seen.Add(b); hits.Add(b); }
                }
            hits.Sort(delegate (string a, string b) { int pa = a.StartsWith("prop_") || a.StartsWith("v_") ? 0 : 1, pb = b.StartsWith("prop_") || b.StartsWith("v_") ? 0 : 1; return pa != pb ? pa.CompareTo(pb) : string.CompareOrdinal(a, b); });
            foreach (string n in hits) { if (r.Count >= max) break; r.Add(Item(n, 0, "search")); }
            res["total"] = hits.Count; return res;
        }
    }
}
