// Small WebGL1 renderer: lit textured batches, a grid, translucent overlays, and an orbit camera. Z is up.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const mat4 = M.mat4, TEX = M.TEX;

    function Camera() {
        this.target = [0, 0, 0]; this.dist = 20; this.yaw = 225 * Math.PI / 180; this.pitch = 50 * Math.PI / 180; this.fov = 45 * Math.PI / 180;
        this.vp = mat4.create(); this.inv = mat4.create(); this.view = mat4.create(); this.proj = mat4.create(); this.aspect = 1;
    }
    Camera.prototype.eye = function () {
        const cp = Math.cos(this.pitch);
        return [this.target[0] + this.dist * cp * Math.cos(this.yaw), this.target[1] + this.dist * cp * Math.sin(this.yaw), this.target[2] + this.dist * Math.sin(this.pitch)];
    };
    Camera.prototype.update = function (aspect) {
        this.aspect = aspect;
        mat4.perspective(this.proj, this.fov, aspect, Math.max(0.08, this.dist * 0.02), this.dist * 30 + 400);
        mat4.lookAt(this.view, this.eye(), this.target, [0, 0, 1]);
        mat4.mul(this.vp, this.proj, this.view);
        mat4.invert(this.inv, this.vp);
    };
    Camera.prototype.ray = function (nx, ny) {
        const un = (z) => {
            const x = nx, y = ny, i = this.inv;
            const ox = i[0] * x + i[4] * y + i[8] * z + i[12], oy = i[1] * x + i[5] * y + i[9] * z + i[13], oz = i[2] * x + i[6] * y + i[10] * z + i[14], ow = i[3] * x + i[7] * y + i[11] * z + i[15];
            return [ox / ow, oy / ow, oz / ow];
        };
        const a = un(-1), b = un(1), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]);
        return { o: this.eye(), d: [d[0] / l, d[1] / l, d[2] / l] };
    };
    Camera.prototype.project = function (p, w, h) {
        const v = this.vp, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13], ww = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
        if (ww <= 0) return null; return [(x / ww * 0.5 + 0.5) * w, (1 - (y / ww * 0.5 + 0.5)) * h];
    };
    Camera.prototype.orbit = function (dx, dy) {
        this.yaw -= dx * 0.008; this.pitch = M.clamp(this.pitch + dy * 0.008, 0.08, 1.553);
    };
    Camera.prototype.pan = function (dx, dy) {
        const s = this.dist * 0.0016, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        // screen right = (-sin, cos); screen up on the ground = (-cos, -sin)
        this.target[0] += (-sy * -dx + -cy * dy) * s; this.target[1] += (cy * -dx + -sy * dy) * s;
    };
    Camera.prototype.zoom = function (f) { this.dist = M.clamp(this.dist * f, 2.5, 160); };

    const VS = 'attribute vec3 aPos;attribute vec3 aNrm;attribute vec2 aUv;uniform mat4 uVP;varying vec3 vN;varying vec2 vUv;varying vec3 vW;void main(){vN=aNrm;vUv=aUv;vW=aPos;gl_Position=uVP*vec4(aPos,1.0);}';
    // uClip: x, y of the centre, squared radius (0 = no clip), highest z that is drawn; used to look into an imported model
    const FS = 'precision mediump float;uniform sampler2D uTex;uniform vec3 uSun;uniform vec4 uTint;uniform vec4 uClip;varying vec3 vN;varying vec2 vUv;varying vec3 vW;void main(){if(uClip.z>0.0){vec2 q=vW.xy-uClip.xy;if(dot(q,q)>uClip.z||vW.z>uClip.w)discard;}vec4 t=texture2D(uTex,vUv);vec3 n=normalize(vN);float d=max(dot(n,uSun),0.0);float l=0.50+0.42*d+0.10*max(n.z,0.0);gl_FragColor=vec4(t.rgb*l*uTint.rgb,uTint.a);}';
    const VS2 = 'attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uVP;varying vec4 vC;void main(){vC=aCol;gl_Position=uVP*vec4(aPos,1.0);}';
    const FS2 = 'precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}';

    function Renderer(canvas) {
        const gl = this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error('WebGL is not available');
        this.canvas = canvas; this.camera = new Camera();
        const mk = (vs, fs) => {
            const p = gl.createProgram();
            [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(s => { const sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh); });
            gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
        };
        this.pLit = mk(VS, FS); this.pFlat = mk(VS2, FS2);
        const L = this.lit = { aPos: gl.getAttribLocation(this.pLit, 'aPos'), aNrm: gl.getAttribLocation(this.pLit, 'aNrm'), aUv: gl.getAttribLocation(this.pLit, 'aUv'), uVP: gl.getUniformLocation(this.pLit, 'uVP'), uTex: gl.getUniformLocation(this.pLit, 'uTex'), uSun: gl.getUniformLocation(this.pLit, 'uSun'), uTint: gl.getUniformLocation(this.pLit, 'uTint'), uClip: gl.getUniformLocation(this.pLit, 'uClip') };
        this.flat = { aPos: gl.getAttribLocation(this.pFlat, 'aPos'), aCol: gl.getAttribLocation(this.pFlat, 'aCol'), uVP: gl.getUniformLocation(this.pFlat, 'uVP') };
        this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        this.bufs = []; this.mbufs = []; this.clip = null; this.gridBuf = null; this.gridCount = 0; this.statics = {};
        this.ovTris = []; this.ovLines = []; this.ovTopTris = []; this.ovTopLines = []; this.ovBuf = gl.createBuffer();
        this.clear = [0.055, 0.075, 0.12];
        const sun = [-0.45, -0.6, 0.66], sl = Math.hypot(sun[0], sun[1], sun[2]); this.sun = sun.map(v => v / sl);
        this.resize();
    }

    Renderer.prototype.resize = function () {
        const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(2, Math.floor(c.clientWidth * dpr)), h = Math.max(2, Math.floor(c.clientHeight * dpr));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    };

    Renderer.prototype.makeBufs = function (batches) {
        const gl = this.gl;
        return batches.map(b => {
            const nv = b.pos.length / 3, data = new Float32Array(nv * 8);
            for (let i = 0; i < nv; i++) { data.set(b.pos.subarray(i * 3, i * 3 + 3), i * 8); data.set(b.nrm.subarray(i * 3, i * 3 + 3), i * 8 + 3); data.set(b.uv.subarray(i * 2, i * 2 + 2), i * 8 + 6); }
            const vb = gl.createBuffer(), ib = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.idx, gl.STATIC_DRAW);
            return { vb, ib, count: b.idx.length, b };
        });
    };
    Renderer.prototype.setBatches = function (batches) {
        const gl = this.gl;
        this.bufs.forEach(b => { gl.deleteBuffer(b.vb); gl.deleteBuffer(b.ib); });
        this.bufs = this.makeBufs(batches);
    };
    // the imported model lives apart from the interior so editing the interior does not re-upload it
    Renderer.prototype.setModelBatches = function (batches) {
        const gl = this.gl;
        this.mbufs.forEach(b => { gl.deleteBuffer(b.vb); gl.deleteBuffer(b.ib); });
        this.mbufs = this.makeBufs(batches);
    };
    // image textures (from imported .ytd files) keyed by name
    Renderer.prototype.imgTexture = function (key) {
        const M2 = M.ImportModel; if (!M2 || !M2.textures[key]) return null;
        this.imgTex = this.imgTex || {}; if (this.imgTex[key]) return this.imgTex[key];
        const gl = this.gl, t = M2.textures[key], tx = gl.createTexture(), pot = (t.w & (t.w - 1)) === 0 && (t.h & (t.h - 1)) === 0;
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.rgba);
        if (pot) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); }
        else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return (this.imgTex[key] = tx);
    };
    Renderer.prototype.resetImgTextures = function () { const gl = this.gl; if (this.imgTex) for (const k in this.imgTex) gl.deleteTexture(this.imgTex[k]); this.imgTex = {}; };

    Renderer.prototype.setGrid = function (z, ext, cx, cy) {
        const gl = this.gl, v = [], x0 = cx - ext, x1 = cx + ext, y0 = cy - ext, y1 = cy + ext;
        const col = (major) => major ? [0.62, 0.70, 0.86, 0.34] : [0.62, 0.70, 0.86, 0.14];
        for (let i = x0; i <= x1; i++) { const c = col(i % 5 === 0); v.push(i, y0, z, ...c, i, y1, z, ...c); }
        for (let j = y0; j <= y1; j++) { const c = col(j % 5 === 0); v.push(x0, j, z, ...c, x1, j, z, ...c); }
        if (!this.gridBuf) this.gridBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); this.gridCount = v.length / 7;
    };

    // line sets that stay the same between frames (the vanilla collision outline); positions = x,y,z pairs
    Renderer.prototype.setStaticLines = function (name, pos, color, on) {
        const gl = this.gl; if (!this.statics) this.statics = {};
        let s = this.statics[name]; if (!s) s = this.statics[name] = { buf: gl.createBuffer(), count: 0, on: false };
        const n = pos ? pos.length / 3 : 0, data = new Float32Array(n * 7);
        for (let i = 0; i < n; i++) { data[i * 7] = pos[i * 3]; data[i * 7 + 1] = pos[i * 3 + 1]; data[i * 7 + 2] = pos[i * 3 + 2]; data[i * 7 + 3] = color[0]; data[i * 7 + 4] = color[1]; data[i * 7 + 5] = color[2]; data[i * 7 + 6] = color[3]; }
        gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); s.count = n; s.on = !!on;
    };
    Renderer.prototype.staticOn = function (name, on) { if (this.statics && this.statics[name]) this.statics[name].on = !!on; };

    // ---- overlays (rebuilt every frame by the tools) ----
    Renderer.prototype.ovClear = function () { this.ovTris.length = 0; this.ovLines.length = 0; this.ovTopTris.length = 0; this.ovTopLines.length = 0; };
    // the "top" overlay ignores depth, so a gizmo is never hidden by walls (like the transform gizmos in Blender)
    Renderer.prototype.ovTopQuad = function (a, b, c, d, col) { const t = this.ovTopTris; [a, b, c, a, c, d].forEach(p => t.push(p[0], p[1], p[2], col[0], col[1], col[2], col[3])); };
    Renderer.prototype.ovTopLine = function (a, b, col) { this.ovTopLines.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3], b[0], b[1], b[2], col[0], col[1], col[2], col[3]); };
    Renderer.prototype.ovQuad = function (a, b, c, d, col) { const t = this.ovTris; [a, b, c, a, c, d].forEach(p => t.push(p[0], p[1], p[2], col[0], col[1], col[2], col[3])); };
    Renderer.prototype.ovLine = function (a, b, col) { this.ovLines.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3], b[0], b[1], b[2], col[0], col[1], col[2], col[3]); };
    Renderer.prototype.ovBox = function (mn, mx, col, edgeCol) {
        const [x0, y0, z0] = mn, [x1, y1, z1] = mx, q = (a, b, c, d) => this.ovQuad(a, b, c, d, col);
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
        q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]); q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
        q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
        if (edgeCol) {
            const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
            [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => this.ovLine(c[e[0]], c[e[1]], edgeCol));
        }
    };

    // an oriented box: centre c, half sizes along its width (hu), depth (hn) and height (hz), turned by yaw about Z
    Renderer.prototype.ovOBox = function (c, hu, hn, hz, yaw, col, edgeCol) {
        const ux = Math.cos(yaw), uy = Math.sin(yaw), nx = -Math.sin(yaw), ny = Math.cos(yaw);
        const P = (su, sn, sz) => [c[0] + su * hu * ux + sn * hn * nx, c[1] + su * hu * uy + sn * hn * ny, c[2] + sz * hz];
        const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
        if (col) [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].forEach(f => this.ovQuad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], col));
        if (edgeCol) [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => this.ovLine(v[e[0]], v[e[1]], edgeCol));
    };

    // filter(batch) -> bool; tint(batch) -> [r,g,b,a] optional
    Renderer.prototype.render = function (filter) {
        const gl = this.gl, cam = this.camera; this.resize();
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        cam.update(this.canvas.width / this.canvas.height);
        gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

        const L = this.lit, drawBatches = (glassPass) => {
            gl.useProgram(this.pLit); gl.uniformMatrix4fv(L.uVP, false, cam.vp); gl.uniform3fv(L.uSun, this.sun); gl.uniform1i(L.uTex, 0);
            gl.enableVertexAttribArray(L.aPos); gl.enableVertexAttribArray(L.aNrm); gl.enableVertexAttribArray(L.aUv);
            const cl = this.clip;
            for (const list of [this.bufs, this.mbufs]) for (const o of list) {
                const b = o.b, trans = !!b.glass || (b.alpha != null && b.alpha < 1); if (trans !== glassPass || !filter(b)) continue;
                gl.activeTexture(gl.TEXTURE0);
                if (b.clip && cl) gl.uniform4f(L.uClip, cl.cx, cl.cy, cl.r * cl.r, cl.zmax); else gl.uniform4f(L.uClip, 0, 0, 0, 0);
                const al = b.alpha != null ? b.alpha : 1;
                if (b.glass) { gl.bindTexture(gl.TEXTURE_2D, this.white); gl.uniform4f(L.uTint, 0.62, 0.78, 0.92, 0.30); }
                else if (b.imgKey && this.imgTexture(b.imgKey)) { gl.bindTexture(gl.TEXTURE_2D, this.imgTexture(b.imgKey)); gl.uniform4f(L.uTint, 1, 1, 1, al); }
                else if (b.flat) { gl.bindTexture(gl.TEXTURE_2D, this.white); gl.uniform4f(L.uTint, b.flat[0], b.flat[1], b.flat[2], al); }
                else { gl.bindTexture(gl.TEXTURE_2D, TEX.glTexture(gl, b.tex)); gl.uniform4f(L.uTint, 1, 1, 1, 1); }
                if (b.noCull) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
                gl.bindBuffer(gl.ARRAY_BUFFER, o.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ib);
                gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(L.aNrm, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(L.aUv, 2, gl.FLOAT, false, 32, 24);
                gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_SHORT, 0);
            }
            gl.disableVertexAttribArray(L.aNrm); gl.disableVertexAttribArray(L.aUv);
        };
        gl.disable(gl.BLEND); drawBatches(false);

        // grid, glass and overlays: no depth writes
        const F = this.flat; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        gl.enable(gl.CULL_FACE); drawBatches(true); gl.disable(gl.CULL_FACE);
        gl.useProgram(this.pFlat); gl.uniformMatrix4fv(F.uVP, false, cam.vp); gl.enableVertexAttribArray(F.aPos); gl.enableVertexAttribArray(F.aCol);
        const drawFlat = (buf, mode, count) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(F.aPos, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(F.aCol, 4, gl.FLOAT, false, 28, 12); gl.drawArrays(mode, 0, count);
        };
        if (this.gridBuf && this.showGrid !== false) drawFlat(this.gridBuf, gl.LINES, this.gridCount);
        for (const k in this.statics) { const s = this.statics[k]; if (s.on) drawFlat(s.buf, gl.LINES, s.count); }
        if (this.ovTris.length) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ovBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.ovTris), gl.DYNAMIC_DRAW); drawFlat(this.ovBuf, gl.TRIANGLES, this.ovTris.length / 7); }
        if (this.ovLines.length) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ovBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.ovLines), gl.DYNAMIC_DRAW); drawFlat(this.ovBuf, gl.LINES, this.ovLines.length / 7); }
        if (this.ovTopTris.length || this.ovTopLines.length) {
            gl.disable(gl.DEPTH_TEST);
            if (this.ovTopTris.length) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ovBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.ovTopTris), gl.DYNAMIC_DRAW); drawFlat(this.ovBuf, gl.TRIANGLES, this.ovTopTris.length / 7); }
            if (this.ovTopLines.length) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ovBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.ovTopLines), gl.DYNAMIC_DRAW); drawFlat(this.ovBuf, gl.LINES, this.ovTopLines.length / 7); }
            gl.enable(gl.DEPTH_TEST);
        }
        gl.disableVertexAttribArray(F.aCol); gl.depthMask(true);
    };

    M.Renderer = Renderer; M.Camera = Camera;
})(window.MLO);
