// Math, encoding and small DOM helpers shared by the editor. Z is up, one unit is one metre.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';

    const mat4 = {
        create() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
        mul(out, a, b) {
            for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
                let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = s;
            }
            return out;
        },
        perspective(out, fovy, aspect, near, far) {
            const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
            out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
            return out;
        },
        ortho(out, l, r, b, t, n, f) {
            out.fill(0); out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
            out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1; return out;
        },
        lookAt(out, eye, c, up) {
            let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2];
            let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
            let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
            l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
            const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
            out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
            out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
            out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
            out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
            out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
            out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]); out[15] = 1;
            return out;
        },
        invert(out, a) {
            const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
                a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
            const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
                b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
                b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
            let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
            if (!det) return null; det = 1 / det;
            out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
            out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
            out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
            out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
            out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
            out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
            out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
            out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
            return out;
        }
    };

    // base64 of typed arrays (the exporter reads little-endian float32 / int32)
    function toB64(typed) {
        const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
        let s = ''; const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return btoa(s);
    }

    function el(tag, attrs, ...kids) {
        const e = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            const v = attrs[k];
            if (v == null || v === false) continue;
            if (k === 'class') e.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (k === 'html') e.innerHTML = v;
            else if (v === true) e.setAttribute(k, '');
            else e.setAttribute(k, v);
        }
        for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
        return e;
    }

    const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
    const keyOf = (i, j) => i + ',' + j;
    const parseKey = (k) => { const p = k.split(','); return [parseInt(p[0], 10), parseInt(p[1], 10)]; };

    M.mat4 = mat4; M.toB64 = toB64; M.el = el; M.clamp = clamp; M.keyOf = keyOf; M.parseKey = parseKey;
})(window.MLO);
