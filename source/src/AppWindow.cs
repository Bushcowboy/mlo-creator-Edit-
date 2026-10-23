// The program's own window. A WinForms form that shows the editor page with WebView2 (the same Chromium engine Windows already has, no browser window, no tabs), so MLO Creator is
// one application. The page still talks to the small local server of this program. If the WebView2 files or the runtime are missing the caller falls back to the old browser window. C# 5.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MloCreator
{
    public class AppWindow : Form
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectory(string path);

        WebView2 web; readonly string url, dataDir, boundsFile; readonly bool devTools; bool flushed;

        // the WebView2 runtime is part of Windows 11 and of Edge; this says which version is there (throws when there is none)
        public static string RuntimeVersion(string libDir)
        {
            string loader = Path.Combine(libDir, "WebView2Loader.dll"); if (File.Exists(loader)) { SetDllDirectory(libDir); LoadLibrary(loader); }
            return CoreWebView2Environment.GetAvailableBrowserVersionString();
        }

        // opens the window and returns when it is closed
        public static void Run(string url, string appDataDir, bool devTools)
        {
            Application.EnableVisualStyles();
            using (AppWindow w = new AppWindow(url, appDataDir, devTools)) Application.Run(w);
        }

        AppWindow(string url, string appDataDir, bool devTools)
        {
            this.url = url; this.devTools = devTools; dataDir = Path.Combine(appDataDir, "webview"); boundsFile = Path.Combine(appDataDir, "window.txt");
            Directory.CreateDirectory(dataDir);
            Text = "MLO Creator"; BackColor = Color.FromArgb(11, 17, 29); MinimumSize = new Size(1000, 640); StartPosition = FormStartPosition.Manual;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            RestoreBounds0();
            web = new WebView2(); web.Dock = DockStyle.Fill; web.DefaultBackgroundColor = BackColor; Controls.Add(web);
            Shown += delegate { Init(); };
            FormClosing += OnClosing;
        }

        // where the window was last time (on a screen that is still there), else most of the screen the cursor is on
        void RestoreBounds0()
        {
            Rectangle wa = Screen.FromPoint(Cursor.Position).WorkingArea; Rectangle r = new Rectangle(wa.X + wa.Width / 20, wa.Y + wa.Height / 20, wa.Width * 9 / 10, wa.Height * 9 / 10); bool max = false;
            try
            {
                if (File.Exists(boundsFile))
                {
                    string[] p = File.ReadAllText(boundsFile).Split(' ');
                    if (p.Length >= 5)
                    {
                        Rectangle b = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                        foreach (Screen s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(b) && b.Width >= 600 && b.Height >= 400) { r = b; max = p[4] == "1"; break; }
                    }
                }
            }
            catch (Exception) { }
            Bounds = r; if (max) WindowState = FormWindowState.Maximized;
        }
        void SaveBounds()
        {
            try { Rectangle b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds; File.WriteAllText(boundsFile, b.X + " " + b.Y + " " + b.Width + " " + b.Height + " " + (WindowState == FormWindowState.Maximized ? "1" : "0")); } catch (Exception) { }
        }

        async void Init()
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir);
                await web.EnsureCoreWebView2Async(env);
                CoreWebView2 c = web.CoreWebView2; CoreWebView2Settings s = c.Settings;
                // it is an application, not a browser: no browser menus, keys, zoom or status bar (the editor has its own keys and right-drag camera)
                s.AreDefaultContextMenusEnabled = false; s.AreBrowserAcceleratorKeysEnabled = false; s.IsStatusBarEnabled = false; s.IsZoomControlEnabled = false;
                s.IsPinchZoomEnabled = false; s.IsSwipeNavigationEnabled = false; s.IsPasswordAutosaveEnabled = false; s.IsGeneralAutofillEnabled = false; s.AreDevToolsEnabled = devTools;
                c.NewWindowRequested += delegate (object o, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };             // nothing opens a second window
                c.NavigationStarting += delegate (object o, CoreWebView2NavigationStartingEventArgs e) { if (!e.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) e.Cancel = true; };      // a file dropped beside the drop zone must not replace the editor
                c.ProcessFailed += delegate (object o, CoreWebView2ProcessFailedEventArgs e) { if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) { try { c.Reload(); } catch (Exception) { } } };
                c.Navigate(url);
            }
            catch (Exception ex)
            {
                MessageBox.Show("The window could not be started:\n\n" + ex.Message + "\n\nThe WebView2 runtime that comes with Windows 11 and Edge is needed.", "MLO Creator", MessageBoxButtons.OK, MessageBoxIcon.Error);
                flushed = true; Close();
            }
        }

        // closing: the editor saves what is unsaved first (it does it by itself a moment after a change, this covers the last moment)
        void OnClosing(object sender, FormClosingEventArgs e)
        {
            SaveBounds();
            if (flushed || web == null || web.CoreWebView2 == null) return;
            e.Cancel = true; flushed = true; FlushThenClose();
        }
        async void FlushThenClose()
        {
            try
            {
                string expr = "(async function () { try { var M = window.MLO; if (M && M.Model && M.Model.state && !M.Model.state.saved) await M.Model.save(); } catch (e) { } return 1; })()";
                Task t = web.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", "{\"expression\":" + new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(expr) + ",\"awaitPromise\":true,\"returnByValue\":true}");
                await Task.WhenAny(t, Task.Delay(5000));
            }
            catch (Exception) { }
            Close();
        }
    }
}
