// The game's timecycle modifiers (common:/data/timecycle/timecycle_mods_*.xml and the DLC ones): their names for an interior's rooms, and their values to start a
// modifier of your own from. The files are plain XML or the game's binary XML (RBF). C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Xml;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public static class Timecycles
    {
        static Dictionary<string, Dictionary<string, double[]>> mods;          // name -> variable -> [value, second value]
        static Dictionary<string, string> fileOf;
        static readonly object gate = new object();

        static void Ensure()
        {
            lock (gate)
            {
                if (mods != null) return;
                Dictionary<string, Dictionary<string, double[]>> m = new Dictionary<string, Dictionary<string, double[]>>(StringComparer.OrdinalIgnoreCase); Dictionary<string, string> f = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string n in Vanilla.Names(".xml"))
                {
                    if (n.IndexOf("timecycle", StringComparison.OrdinalIgnoreCase) < 0 || n.IndexOf("mod", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    try
                    {
                        RpfFileEntry e; byte[] data = Vanilla.Bytes(n, out e); if (data == null) continue;
                        string xml = Text(data); if (xml == null) continue;
                        Parse(xml, n, m, f);
                    }
                    catch (Exception) { }
                }
                mods = m; fileOf = f;
            }
        }

        // plain text, or the game's binary XML
        static string Text(byte[] data)
        {
            if (data.Length >= 4 && data[0] == 'R' && data[1] == 'B' && data[2] == 'F' && data[3] == '0') { RbfFile r = new RbfFile(); r.Load(data); return RbfXml.GetXml(r); }
            int i = 0; if (data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) i = 3;
            while (i < data.Length && (data[i] == ' ' || data[i] == '\r' || data[i] == '\n' || data[i] == '\t')) i++;
            if (i < data.Length && data[i] == '<') return Encoding.UTF8.GetString(data);
            return null;
        }

        public static int Parse(string xml, string file, Dictionary<string, Dictionary<string, double[]>> into, Dictionary<string, string> fileOf)
        {
            XmlDocument d = new XmlDocument(); d.LoadXml(xml); int n = 0;
            foreach (XmlNode mn in d.GetElementsByTagName("modifier"))
            {
                XmlElement me = mn as XmlElement; if (me == null) continue; string name = me.GetAttribute("name"); if (name.Length == 0) continue;
                Dictionary<string, double[]> vars = new Dictionary<string, double[]>();
                foreach (XmlNode vn in me.ChildNodes)
                {
                    XmlElement ve = vn as XmlElement; if (ve == null) continue;
                    string[] p = ve.InnerText.Split(new char[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries); if (p.Length == 0) continue;
                    double a, b = 0; if (!double.TryParse(p[0], NumberStyles.Float, CultureInfo.InvariantCulture, out a)) continue; if (p.Length > 1) double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out b);
                    vars[ve.Name] = new double[] { a, b };
                }
                into[name] = vars; if (fileOf != null) fileOf[name] = file; n++;
            }
            return n;
        }

        public static Dictionary<string, object> List(string gta, string cache)
        {
            Vanilla.Init(gta, cache); Ensure();
            List<string> names = new List<string>(mods.Keys); names.Sort(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true; r["names"] = names; r["count"] = names.Count; return r;
        }

        public static Dictionary<string, object> Get(string gta, string cache, string name)
        {
            Vanilla.Init(gta, cache); Ensure();
            Dictionary<string, double[]> v; if (name == null || !mods.TryGetValue(name, out v)) throw new Exception("The game has no timecycle modifier called " + name + ".");
            Dictionary<string, object> vars = new Dictionary<string, object>(); foreach (KeyValuePair<string, double[]> kv in v) vars[kv.Key] = kv.Value;
            Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true; r["name"] = name; r["file"] = fileOf[name]; r["vars"] = vars; return r;
        }

        // a modifier of your own as the game writes them: <modifier name numMods userFlags><variable>value second</variable>...</modifier>
        public static string ModifierXml(string name, Dictionary<string, object> vars)
        {
            StringBuilder s = new StringBuilder(); int n = 0; StringBuilder body = new StringBuilder();
            foreach (KeyValuePair<string, object> kv in vars)
            {
                string k = System.Text.RegularExpressions.Regex.Replace(kv.Key, "[^A-Za-z0-9_]", ""); if (k.Length == 0) continue;
                List<object> p = J.A(kv.Value); double a = p.Count > 0 ? J.D(p[0], 0) : J.D(kv.Value, 0), b = p.Count > 1 ? J.D(p[1], 0) : 0;
                body.Append("<" + k + ">" + a.ToString("0.000", CultureInfo.InvariantCulture) + " " + b.ToString("0.000", CultureInfo.InvariantCulture) + "</" + k + ">\n"); n++;
            }
            s.Append("<modifier name=\"" + name + "\" numMods=\"" + n + "\" userFlags=\"0\">\n").Append(body).Append("</modifier>\n");
            return s.ToString();
        }
    }
}
