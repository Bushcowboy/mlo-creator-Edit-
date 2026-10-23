// DDS writer (DXT1 / DXT5 with a full mip chain down to 4x4). C# 5.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace MloCreator
{
    public static class Dds
    {
        // ARGB ints, 0xAARRGGBB
        static int[] Down(int[] src, int size)
        {
            int ns = size / 2; int[] d = new int[ns * ns];
            for (int y = 0; y < ns; y++)
                for (int x = 0; x < ns; x++)
                {
                    int a = 0, r = 0, g = 0, b = 0;
                    for (int dy = 0; dy < 2; dy++)
                        for (int dx = 0; dx < 2; dx++)
                        {
                            int p = src[(y * 2 + dy) * size + (x * 2 + dx)];
                            a += (p >> 24) & 255; r += (p >> 16) & 255; g += (p >> 8) & 255; b += p & 255;
                        }
                    d[y * ns + x] = ((a / 4) << 24) | ((r / 4) << 16) | ((g / 4) << 8) | (b / 4);
                }
            return d;
        }

        static int To565(int r, int g, int b) { return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); }
        static void From565(int c, out int r, out int g, out int b)
        {
            r = ((c >> 11) & 31); r = (r << 3) | (r >> 2);
            g = ((c >> 5) & 63); g = (g << 2) | (g >> 4);
            b = (c & 31); b = (b << 3) | (b >> 2);
        }

        static void Dxt1Block(int[] px, int size, int bx, int by, byte[] outb, int off)
        {
            int minR = 255, minG = 255, minB = 255, maxR = 0, maxG = 0, maxB = 0;
            int[] rr = new int[16], gg = new int[16], bb = new int[16];
            for (int i = 0; i < 16; i++)
            {
                int p = px[(by * 4 + i / 4) * size + (bx * 4 + i % 4)];
                rr[i] = (p >> 16) & 255; gg[i] = (p >> 8) & 255; bb[i] = p & 255;
                if (rr[i] < minR) minR = rr[i]; if (gg[i] < minG) minG = gg[i]; if (bb[i] < minB) minB = bb[i];
                if (rr[i] > maxR) maxR = rr[i]; if (gg[i] > maxG) maxG = gg[i]; if (bb[i] > maxB) maxB = bb[i];
            }
            int c0 = To565(maxR, maxG, maxB), c1 = To565(minR, minG, minB);
            if (c0 == c1)
            {
                outb[off] = (byte)(c0 & 255); outb[off + 1] = (byte)(c0 >> 8);
                outb[off + 2] = (byte)(c1 & 255); outb[off + 3] = (byte)(c1 >> 8);
                outb[off + 4] = 0; outb[off + 5] = 0; outb[off + 6] = 0; outb[off + 7] = 0;
                return;
            }
            if (c0 < c1) { int t = c0; c0 = c1; c1 = t; }
            int[] pr = new int[4], pg = new int[4], pb = new int[4];
            From565(c0, out pr[0], out pg[0], out pb[0]);
            From565(c1, out pr[1], out pg[1], out pb[1]);
            pr[2] = (2 * pr[0] + pr[1]) / 3; pg[2] = (2 * pg[0] + pg[1]) / 3; pb[2] = (2 * pb[0] + pb[1]) / 3;
            pr[3] = (pr[0] + 2 * pr[1]) / 3; pg[3] = (pg[0] + 2 * pg[1]) / 3; pb[3] = (pb[0] + 2 * pb[1]) / 3;
            uint bits = 0;
            for (int i = 0; i < 16; i++)
            {
                int best = 0, bd = int.MaxValue;
                for (int k = 0; k < 4; k++)
                {
                    int dr = rr[i] - pr[k], dg = gg[i] - pg[k], db = bb[i] - pb[k];
                    int d = dr * dr + dg * dg + db * db;
                    if (d < bd) { bd = d; best = k; }
                }
                bits |= (uint)best << (2 * i);
            }
            outb[off] = (byte)(c0 & 255); outb[off + 1] = (byte)(c0 >> 8);
            outb[off + 2] = (byte)(c1 & 255); outb[off + 3] = (byte)(c1 >> 8);
            outb[off + 4] = (byte)(bits & 255); outb[off + 5] = (byte)((bits >> 8) & 255);
            outb[off + 6] = (byte)((bits >> 16) & 255); outb[off + 7] = (byte)((bits >> 24) & 255);
        }

        static void Dxt5AlphaBlock(int[] px, int size, int bx, int by, byte[] outb, int off)
        {
            int mn = 255, mx = 0; int[] al = new int[16];
            for (int i = 0; i < 16; i++)
            {
                int p = px[(by * 4 + i / 4) * size + (bx * 4 + i % 4)];
                al[i] = (p >> 24) & 255; if (al[i] < mn) mn = al[i]; if (al[i] > mx) mx = al[i];
            }
            int a0 = mx, a1 = mn;
            int[] pal = new int[8]; pal[0] = a0; pal[1] = a1;
            for (int k = 1; k <= 6; k++) pal[1 + k] = ((7 - k) * a0 + k * a1) / 7;
            ulong bits = 0;
            for (int i = 0; i < 16; i++)
            {
                int best = 0, bd = int.MaxValue;
                for (int k = 0; k < 8; k++) { int d = Math.Abs(al[i] - pal[k]); if (d < bd) { bd = d; best = k; } }
                bits |= (ulong)best << (3 * i);
            }
            outb[off] = (byte)a0; outb[off + 1] = (byte)a1;
            for (int i = 0; i < 6; i++) outb[off + 2 + i] = (byte)((bits >> (8 * i)) & 255);
        }

        public static int MipCount(int size) { int c = 1; while (size > 4) { size /= 2; c++; } return c; }

        public static void Write(string path, int[] level0, int size, bool dxt5)
        {
            List<int[]> levels = new List<int[]>(); List<int> sizes = new List<int>();
            int[] cur = level0; int s = size;
            while (true)
            {
                levels.Add(cur); sizes.Add(s);
                if (s <= 4) break;
                cur = Down(cur, s); s /= 2;
            }
            int blockBytes = dxt5 ? 16 : 8;
            using (BinaryWriter w = new BinaryWriter(File.Create(path)))
            {
                w.Write(Encoding.ASCII.GetBytes("DDS "));
                w.Write(124);
                w.Write(0x000A1007);
                w.Write(size); w.Write(size);
                w.Write((size / 4) * (size / 4) * blockBytes);
                w.Write(0);
                w.Write(levels.Count);
                for (int i = 0; i < 11; i++) w.Write(0);
                w.Write(32); w.Write(4);
                w.Write(Encoding.ASCII.GetBytes(dxt5 ? "DXT5" : "DXT1"));
                w.Write(0); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
                w.Write(0x401008); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
                for (int li = 0; li < levels.Count; li++)
                {
                    int ls = sizes[li]; int[] px = levels[li];
                    int nb = ls / 4;
                    byte[] data = new byte[nb * nb * blockBytes];
                    for (int by = 0; by < nb; by++)
                        for (int bx = 0; bx < nb; bx++)
                        {
                            int off = (by * nb + bx) * blockBytes;
                            if (dxt5) { Dxt5AlphaBlock(px, ls, bx, by, data, off); Dxt1Block(px, ls, bx, by, data, off + 8); }
                            else Dxt1Block(px, ls, bx, by, data, off);
                        }
                    w.Write(data);
                }
            }
        }
    }
}
