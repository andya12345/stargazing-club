/* ==========================================================================
   星空社 · cosmos.js
   首屏 3D：银河 → 俯冲进星盘（恒星掠过）→ 穿过星云 → 落到一颗恒星 → 太阳系
   原生 WebGL2，无第三方库。HDR + 泛光 + 变焦拖影 + 电影色调映射。
   ========================================================================== */
(function () {
  'use strict';

  var NS = {};
  window.Cosmos = NS;

  /* ---------------------------------------------------------------- math */
  function mat4() { return new Float32Array(16); }

  function perspective(out, fovy, aspect, near, far, shiftX, shiftY) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = shiftX || 0; out[9] = shiftY || 0;
    out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }

  function lookAt(out, eye, center, up) {
    var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    var zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;

    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;

    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }

  function mat4Mul(out, a, b) {
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        out[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
      }
    }
    return out;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /* ---------------------------------------------------------------- data */
  var J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  var DAYS0 = (Date.now() - J2000) / 86400000;
  var DAYS_PER_SEC = 4.0;

  var PLANETS = [
    { a: 0.387, L0: 252.25084, n: 4.09233445, r: 0.383, c: [0.62, 0.58, 0.53], t: 1 },
    { a: 0.723, L0: 181.97973, n: 1.60213034, r: 0.949, c: [0.93, 0.84, 0.66], t: 1 },
    { a: 1.000, L0: 100.46435, n: 0.98560910, r: 1.000, c: [0.30, 0.48, 0.72], t: 2 },
    { a: 1.524, L0: 355.45332, n: 0.52403304, r: 0.532, c: [0.78, 0.38, 0.24], t: 1 },
    { a: 5.203, L0: 34.40438,  n: 0.08308676, r: 11.21, c: [0.80, 0.68, 0.52], t: 3 },
    { a: 9.537, L0: 50.07744,  n: 0.03344414, r: 9.45,  c: [0.86, 0.79, 0.62], t: 3 },
    { a: 19.19, L0: 314.05501, n: 0.01172834, r: 4.01,  c: [0.48, 0.72, 0.74], t: 4 },
    { a: 30.07, L0: 304.34866, n: 0.00598103, r: 3.88,  c: [0.28, 0.40, 0.72], t: 4 }
  ];

  var SYS_SCALE = 0.205;
  function orbitRadius(a) { return Math.pow(a, 0.52) * SYS_SCALE; }
  function planetRadius(r) { return 0.018 + 0.022 * Math.log10(1 + r); }

  // 目的地：星盘里的一颗恒星，不在银心
  var TARGET = [0.62, 0.015, 0.42];

  /* ---------------------------------------------------------------- shaders */
  var VS_POINTS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec3 aCol;',
    'layout(location=2) in float aSize;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform float uAlpha;',
    'uniform float uPixelScale;',
    'out vec3 vCol;',
    'out float vA;',
    'void main(){',
    '  vec4 mv = uView * vec4(aPos, 1.0);',
    '  gl_Position = uProj * mv;',
    '  float d = max(-mv.z, 0.0015);',
    '  gl_PointSize = clamp(aSize * uPixelScale / d, 0.8, 7.0);',
    '  vCol = aCol;',
    '  vA = uAlpha;',
    '}'
  ].join('\n');

  var FS_POINTS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vCol;',
    'in float vA;',
    'out vec4 outColor;',
    'void main(){',
    '  vec2 p = gl_PointCoord - 0.5;',
    '  float r2 = dot(p, p);',
    '  if (r2 > 0.25) discard;',
    '  float a = exp(-r2 * 14.0);',
    '  outColor = vec4(vCol * vA * a, a * vA);',
    '}'
  ].join('\n');

  // 星云：实例化广告牌
  var VS_NEB = [
    '#version 300 es',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec3 iCenter;',
    'layout(location=2) in vec3 iColor;',
    'layout(location=3) in vec4 iParam;',   // size, rot, alpha, _
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform float uAlpha;',
    'uniform vec3 uCam;',
    'out vec2 vUv;',
    'out vec3 vCol;',
    'out float vA;',
    'out float vRot;',
    'void main(){',
    '  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);',
    '  vec3 up    = vec3(uView[0][1], uView[1][1], uView[2][1]);',
    '  float c = cos(iParam.y), s = sin(iParam.y);',
    '  vec2 p = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);',
    '  vec3 w = iCenter + right * p.x * iParam.x + up * p.y * iParam.x;',
    '  gl_Position = uProj * uView * vec4(w, 1.0);',
    '  vUv = aCorner;',
    '  vCol = iColor;',
    '  float dcam = length(iCenter - uCam);',
    '  vA = iParam.z * uAlpha * smoothstep(0.03, 0.30, dcam);',
    '  vRot = iParam.w;',
    '}'
  ].join('\n');

  var FS_NEB = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'in vec3 vCol;',
    'in float vA;',
    'in float vRot;',
    'uniform sampler2D uTex;',
    'out vec4 outColor;',
    'void main(){',
    '  float c = cos(vRot), s = sin(vRot);',
    '  vec2 p = vec2(vUv.x * c - vUv.y * s, vUv.x * s + vUv.y * c) * 0.5 + 0.5;',
    '  float d = texture(uTex, p).a;',
    '  float rad = length(vUv);',
    '  float fall = smoothstep(1.0, 0.05, rad);',
    '  float a = d * fall * vA;',
    '  outColor = vec4(vCol * a, a);',
    '}'
  ].join('\n');

  var VS_LINES = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform mat4 uModel;',
    'uniform float uAlpha;',
    'out float vA;',
    'void main(){',
    '  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);',
    '  float front = smoothstep(-0.35, 0.35, aPos.z);',
    '  vA = uAlpha * mix(0.45, 1.75, front);',
    '}'
  ].join('\n');

  var FS_LINES = [
    '#version 300 es',
    'precision highp float;',
    'in float vA;',
    'uniform vec3 uColor;',
    'out vec4 outColor;',
    'void main(){ outColor = vec4(uColor * vA, vA); }'
  ].join('\n');

  var VS_MESH = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec3 aNrm;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform mat4 uModel;',
    'out vec3 vN;',
    'out vec3 vW;',
    'out vec3 vL;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vW = w.xyz;',
    '  vN = mat3(uModel) * aNrm;',
    '  vL = aPos;',
    '  gl_Position = uProj * uView * w;',
    '}'
  ].join('\n');

  var FS_MESH = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vN;',
    'in vec3 vW;',
    'in vec3 vL;',
    'uniform vec3 uColor;',
    'uniform vec3 uCam;',
    'uniform float uAlpha;',
    'uniform float uEmissive;',
    'uniform int uType;',
    'out vec4 outColor;',

    'float hash3(vec3 p){',
    '  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'float vnoise(vec3 x){',
    '  vec3 i = floor(x), f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float n000 = hash3(i);',
    '  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));',
    '  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));',
    '  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));',
    '  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));',
    '  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));',
    '  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));',
    '  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));',
    '  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),',
    '             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);',
    '}',
    'float fbm(vec3 p){',
    '  float s = 0.0, a = 0.5;',
    '  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }',
    '  return s;',
    '}',

    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 L = normalize(-vW);',
    '  vec3 V = normalize(uCam - vW);',
    '  float lam = max(dot(N, L), 0.0);',
    '  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);',
    '  vec3 base = uColor;',

    '  if (uType == 1) {',
    '    float n = fbm(vL * 5.0);',
    '    base = mix(uColor * 0.62, uColor * 1.22, n);',
    '    base *= 0.82 + 0.34 * fbm(vL * 16.0);',
    '  } else if (uType == 2) {',
    '    float h = fbm(vL * 2.1 + 3.7);',
    '    float land = smoothstep(0.50, 0.545, h);',
    '    vec3 ocean = vec3(0.035, 0.13, 0.30);',
    '    vec3 ground = mix(vec3(0.13, 0.24, 0.11), vec3(0.40, 0.33, 0.18), fbm(vL * 5.5));',
    '    base = mix(ocean, ground, land);',
    '    float ice = smoothstep(0.70, 0.88, abs(vL.y));',
    '    base = mix(base, vec3(0.88, 0.92, 0.95), ice);',
    '    float cl = smoothstep(0.52, 0.74, fbm(vL * 3.2 + 11.0));',
    '    base = mix(base, vec3(0.92, 0.94, 0.97), cl * 0.55);',
    '  } else if (uType == 3) {',
    '    float band = sin(vL.y * 13.0 + fbm(vL * 2.6) * 3.2);',
    '    base = mix(uColor * 0.62, uColor * 1.25, band * 0.5 + 0.5);',
    '    base *= 0.9 + 0.22 * fbm(vL * 7.0);',
    '    float spot = smoothstep(0.86, 0.94, fbm(vL * 3.4 + 20.0)) * (1.0 - abs(vL.y));',
    '    base = mix(base, uColor * 0.55, spot * 0.6);',
    '  } else if (uType == 4) {',
    '    float band = sin(vL.y * 6.0 + fbm(vL * 1.8) * 1.6);',
    '    base = mix(uColor * 0.72, uColor * 1.16, band * 0.5 + 0.5);',
    '  }',

    '  vec3 col = base * (0.03 + lam * 1.12);',
    '  col += base * rim * 0.5;',
    '  col += vec3(1.0, 0.86, 0.68) * uEmissive;',
    '  outColor = vec4(col * uAlpha, 1.0);',
    '}'
  ].join('\n');

  var VS_SPRITE = [
    '#version 300 es',
    'layout(location=0) in vec2 aQuad;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform vec3 uCenter;',
    'uniform float uSize;',
    'uniform vec2 uSquash;',
    'out vec2 vUv;',
    'void main(){',
    '  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);',
    '  vec3 up    = vec3(uView[0][1], uView[1][1], uView[2][1]);',
    '  vec3 p = uCenter + right * aQuad.x * uSize * uSquash.x + up * aQuad.y * uSize * uSquash.y;',
    '  gl_Position = uProj * uView * vec4(p, 1.0);',
    '  vUv = aQuad;',
    '}'
  ].join('\n');

  var FS_SPRITE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform float uAlpha;',
    'uniform float uPower;',
    'uniform float uCore;',
    'out vec4 outColor;',
    'void main(){',
    '  float r = length(vUv);',
    '  if (r > 1.0) discard;',
    '  float a = pow(max(0.0, 1.0 - r), uPower);',
    '  float core = exp(-r * r * 26.0) * uCore;',
    '  vec3 col = vec3(1.0, 0.93, 0.82) * (a * 1.4 + core * 6.0);',
    '  outColor = vec4(col * uAlpha, (a * 0.8 + core) * uAlpha);',
    '}'
  ].join('\n');


  var VS_TRAIL = [
    '#version 300 es',
    'layout(location=0) in float aSide;',
    'layout(location=1) in vec3 aPos;',
    'layout(location=2) in vec3 aCol;',
    'uniform mat4 uVP;',
    'uniform mat4 uVPprev;',
    'uniform float uAlpha;',
    'out vec3 vCol;',
    'out float vA;',
    'void main(){',
    '  mat4 M;',
    '  if (aSide < 0.5) M = uVP; else M = uVPprev;',
    '  gl_Position = M * vec4(aPos, 1.0);',
    '  vCol = aCol;',
    '  vA = uAlpha * (aSide < 0.5 ? 1.0 : 0.0);',
    '}'
  ].join('\n');

  var FS_TRAIL = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vCol;',
    'in float vA;',
    'out vec4 outColor;',
    'void main(){ outColor = vec4(vCol * vA, vA); }'
  ].join('\n');

  var VS_DOME = [
    '#version 300 es',
    'layout(location=0) in vec3 aDir;',
    'layout(location=1) in vec3 aCol;',
    'layout(location=2) in float aSize;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform vec3 uCam;',
    'uniform float uAlpha;',
    'out vec3 vCol;',
    'out float vA;',
    'void main(){',
    '  vec3 pos = uCam + aDir * 60.0;',
    '  gl_Position = uProj * uView * vec4(pos, 1.0);',
    '  gl_PointSize = aSize;',
    '  vCol = aCol;',
    '  vA = uAlpha;',
    '}'
  ].join('\n');

  var FS_DOME = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vCol;',
    'in float vA;',
    'out vec4 outColor;',
    'void main(){',
    '  vec2 p = gl_PointCoord - 0.5;',
    '  float r2 = dot(p, p);',
    '  if (r2 > 0.25) discard;',
    '  float a = exp(-r2 * 18.0);',
    '  outColor = vec4(vCol * vA * a, a * vA);',
    '}'
  ].join('\n');


  var VS_BELT = [
    '#version 300 es',
    'layout(location=0) in float aOrbit;',
    'layout(location=1) in float aPhase;',
    'layout(location=2) in float aSpeed;',
    'layout(location=3) in float aSize;',
    'layout(location=4) in float aBright;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform float uAlpha;',
    'uniform float uTime;',
    'uniform float uPix;',
    'out float vA;',
    'void main(){',
    '  float ang = aPhase + uTime * aSpeed;',
    '  vec3 p = vec3(cos(ang) * aOrbit, 0.0, sin(ang) * aOrbit);',
    '  gl_Position = uProj * uView * vec4(p, 1.0);',
    '  gl_PointSize = aSize * uPix;',
    '  float front = smoothstep(-0.35, 0.35, sin(ang));',
    '  vA = aBright * uAlpha * mix(0.35, 1.0, front);',
    '}'
  ].join('\n');

  var FS_BELT = [
    '#version 300 es',
    'precision highp float;',
    'in float vA;',
    'out vec4 outColor;',
    'void main(){',
    '  vec2 p = gl_PointCoord - 0.5;',
    '  float r2 = dot(p, p);',
    '  if (r2 > 0.25) discard;',
    '  float a = exp(-r2 * 12.0);',
    '  outColor = vec4(vec3(0.86, 0.81, 0.72) * vA * a, vA * a);',
    '}'
  ].join('\n');

  var VS_FULL = [
    '#version 300 es',
    'layout(location=0) in vec2 aQuad;',
    'out vec2 vUv;',
    'void main(){ vUv = aQuad * 0.5 + 0.5; gl_Position = vec4(aQuad, 0.0, 1.0); }'
  ].join('\n');

  var FS_BRIGHT = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform float uThresh;',
    'out vec4 outColor;',
    'void main(){',
    '  vec3 c = texture(uTex, vUv).rgb;',
    '  float l = max(c.r, max(c.g, c.b));',
    '  float k = max(l - uThresh, 0.0) / max(l, 0.0001);',
    '  outColor = vec4(c * k, 1.0);',
    '}'
  ].join('\n');

  var FS_BLUR = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uDir;',
    'out vec4 outColor;',
    'void main(){',
    '  vec3 s = texture(uTex, vUv).rgb * 0.227027;',
    '  s += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;',
    '  s += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;',
    '  s += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;',
    '  s += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;',
    '  outColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var FS_COMPOSITE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uScene;',
    'uniform sampler2D uBloom;',
    'uniform float uExposure;',
    'uniform float uBloomAmount;',
    'uniform float uTime;',
    'uniform float uStreak;',
    'uniform float uFlash;',
    'uniform vec2 uRes;',
    'out vec4 outColor;',
    'vec3 aces(vec3 x){',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec3 scene;',
    '  if (uStreak > 0.002) {',
    '    vec3 acc = texture(uScene, uv).rgb;',
    '    float wsum = 1.0;',
    '    for (int i = 1; i < 9; i++) {',
    '      float f = float(i) / 8.0;',
    '      vec2 uv2 = 0.5 + (uv - 0.5) * (1.0 - f * uStreak * 0.085);',
    '      float w = 1.0 - f * 0.75;',
    '      acc += texture(uScene, uv2).rgb * w;',
    '      wsum += w;',
    '    }',
    '    scene = acc / wsum;',
    '  } else {',
    '    scene = texture(uScene, uv).rgb;',
    '  }',
    '  vec3 bloom = texture(uBloom, uv).rgb;',
    '  vec3 col = scene + bloom * uBloomAmount;',
    '  col = mix(col, vec3(1.0), uFlash);',
    '  col *= uExposure;',
    '  col = aces(col);',
    '  float vig = smoothstep(0.95, 0.28, length(uv - 0.5));',
    '  col *= mix(0.55, 1.0, vig);',
    '  col = pow(max(col, 0.0), vec3(1.0 / 2.2));',
    '  float g = fract(sin(dot(uv * uRes + uTime, vec2(12.9898, 78.233))) * 43758.5453);',
    '  col += (g - 0.5) * 0.026;',
    '  outColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- utils */
  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      console.error(log, src);
      throw new Error(log);
    }
    return s;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      console.error(log);
      throw new Error(log);
    }
    return p;
  }

  function sphere(seg, rings) {
    var pos = [], nrm = [], idx = [];
    for (var y = 0; y <= rings; y++) {
      var v = y / rings, phi = v * Math.PI;
      for (var x = 0; x <= seg; x++) {
        var u = x / seg, th = u * Math.PI * 2;
        var nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        pos.push(nx, ny, nz); nrm.push(nx, ny, nz);
      }
    }
    for (y = 0; y < rings; y++) {
      for (x = 0; x < seg; x++) {
        var a = y * (seg + 1) + x, b = a + 1, c = a + seg + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
  }

  /* 程序化星云贴图：两层八度值噪声 + 径向衰减 */
  function nebulaTexture(size) {
    var perm = new Uint8Array(512), i;
    var s0 = 12345;
    function rnd() { s0 = (s0 * 16807) % 2147483647; return (s0 - 1) / 2147483646; }
    for (i = 0; i < 256; i++) perm[i] = Math.floor(rnd() * 256);

    function gridValue(n, x, y) {
      var gx = Math.floor(x * n), gy = Math.floor(y * n);
      var fx = x * n - gx, fy = y * n - gy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      function v(ix, iy) {
        return perm[(perm[((ix % n) + n) % n] + (((iy % n) + n) % n)) & 255] / 255;
      }
      var a = v(gx, gy), b = v(gx + 1, gy), c = v(gx, gy + 1), d = v(gx + 1, gy + 1);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }

    var data = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var nx = x / size, ny = y / size;
        var v = 0, amp = 0.5, tot = 0, n = 4;
        for (var o = 0; o < 4; o++) {
          v += gridValue(n, nx, ny) * amp;
          tot += amp;
          n *= 2; amp *= 0.5;
        }
        v /= tot;
        var dx = nx - 0.5, dy = ny - 0.5;
        var r = Math.sqrt(dx * dx + dy * dy) * 2;
        var fall = Math.max(0, 1 - r);
        fall = fall * fall;
        var a = clamp((v - 0.28) * 2.2, 0, 1) * fall;
        var idx = (y * size + x) * 4;
        var tint = clamp(v * 1.4, 0, 1);
        data[idx] = 255 * tint;
        data[idx + 1] = 240;
        data[idx + 2] = 225;
        data[idx + 3] = 255 * a * a;
      }
    }
    return data;
  }

  /* ---------------------------------------------------------------- init */
  NS.init = function () {
    var cv = document.getElementById('cosmos');
    if (!cv) return;

    var gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance' });
    if (!gl) {
      var hero0 = document.getElementById('hero');
      if (hero0) hero0.classList.add('no-webgl');
      return;
    }
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    var params = new URLSearchParams(location.search);
    var frozen = params.has('t') ? Math.max(0, parseFloat(params.get('t')) || 0)
      : (params.has('static') ? 99 : null);
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var progPoints = program(gl, VS_POINTS, FS_POINTS);
    var progNeb = program(gl, VS_NEB, FS_NEB);
    var progLines = program(gl, VS_LINES, FS_LINES);
    var progMesh = program(gl, VS_MESH, FS_MESH);
    var progSprite = program(gl, VS_SPRITE, FS_SPRITE);
    var progBright = program(gl, VS_FULL, FS_BRIGHT);
    var progBlur = program(gl, VS_FULL, FS_BLUR);
    var progComp = program(gl, VS_FULL, FS_COMPOSITE);
    var progTrail = program(gl, VS_TRAIL, FS_TRAIL);
    var progDome = program(gl, VS_DOME, FS_DOME);
    var progBelt = program(gl, VS_BELT, FS_BELT);

    var seed = 20261108;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    var lowPower = (cv.clientWidth || window.innerWidth) < 760;

    /* ---------- 银河点云 ---------- */
    var P = [], C = [], S = [];
    function addStar(x, y, z, r, g, b, s) { P.push(x, y, z); C.push(r, g, b); S.push(s); }

    var armClusters = lowPower ? 60 : 105;
    var perCluster = lowPower ? 40 : 60;

    for (var arm = 0; arm < 4; arm++) {
      var base = arm * Math.PI * 0.5;
      for (var c = 0; c < armClusters; c++) {
        var t = Math.pow(rnd(), 0.75);
        var r0 = 0.06 + t * 0.94;
        var th0 = base + 3.4 * Math.pow(r0, 0.65) + 0.3;
        var n = Math.floor(perCluster * (0.5 + rnd()));
        for (var k = 0; k < n; k++) {
          var dr = (rnd() + rnd() + rnd() - 1.5) * (0.011 + 0.02 * t) * (0.5 + r0);
          var dth = (rnd() + rnd() + rnd() - 1.5) * (0.05 + 0.06 * t);
          var rr = Math.max(0.015, r0 + dr);
          var a = th0 + dth;
          var y = (rnd() + rnd() - 1) * 0.018 * (1.0 - 0.5 * r0);
          var edge = 1 - smooth(0.70, 1.0, r0);
          var bri = (0.18 + rnd() * 0.62) * edge;
          var warm = rnd();
          if (warm > 0.975) addStar(Math.cos(a) * rr, y, Math.sin(a) * rr, 1.0 * bri, 0.45 * bri, 0.55 * bri, 0.005 + rnd() * 0.007);
          else if (warm > 0.80) addStar(Math.cos(a) * rr, y, Math.sin(a) * rr, 1.0 * bri, 0.86 * bri, 0.68 * bri, 0.004 + rnd() * 0.006);
          else addStar(Math.cos(a) * rr, y, Math.sin(a) * rr, 0.72 * bri, 0.82 * bri, 1.0 * bri, 0.0035 + rnd() * 0.005);
        }
      }
    }
    // 盘面弥散星（飞行时从身边掠过的就是这些）
    var diskCount = lowPower ? 14000 : 34000;
    for (var i = 0; i < diskCount; i++) {
      var rad = Math.pow(rnd(), 0.55) * 1.0;
      var ang = rnd() * Math.PI * 2;
      var yy = (rnd() + rnd() - 1) * 0.03 * (1.0 - 0.6 * rad);
      var br = (0.10 + rnd() * 0.34) * (1 - smooth(0.70, 1.0, rad));
      addStar(Math.cos(ang) * rad, yy, Math.sin(ang) * rad, 0.8 * br, 0.85 * br, 1.0 * br, 0.0028 + rnd() * 0.004);
    }
    // 核球
    for (i = 0; i < (lowPower ? 5000 : 12000); i++) {
      var rb = Math.pow(rnd(), 2.2) * 0.24;
      var ab = rnd() * Math.PI * 2;
      var yb = (rnd() + rnd() - 1) * 0.05 * (1 - rb * 2);
      var bb = 0.30 + rnd() * 1.15;
      addStar(Math.cos(ab) * rb, yb, Math.sin(ab) * rb, 1.0 * bb, 0.9 * bb, 0.76 * bb, 0.003 + rnd() * 0.004);
    }

    var galaxyCount = S.length;
    function makeAttr(data, size, arr) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      return b;
    }
    var bufPos = makeAttr(0, 3, P), bufCol = makeAttr(1, 3, C), bufSize = makeAttr(2, 1, S);
    var pointsVAO = gl.createVertexArray();
    gl.bindVertexArray(pointsVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSize); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);


    // 拖尾：每条恒星一条线段（当前帧 ↔ 上一帧）
    var trailVAO = gl.createVertexArray();
    gl.bindVertexArray(trailVAO);
    var bufSide = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSide);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    // 星空穹顶（太阳系背景）
    var domeDir = [], domeCol = [], domeSize = [];
    var DN = lowPower ? 1100 : 2600;
    for (var di = 0; di < DN; di++) {
      var vx, vy, vz;
      if (rnd() < 0.45) {                       // 银河带：沿一个大圆聚集
        var ba = rnd() * Math.PI * 2;
        var lat = (rnd() + rnd() + rnd() - 1.5) * 0.16;
        vx = Math.cos(ba);
        vy = Math.sin(lat);
        vz = Math.sin(ba);
        var n = 0.35 * vx + 0.9 * vy + 0.25 * vz;
        vx -= 0.35 * n; vy -= 0.9 * n; vz -= 0.25 * n;
      } else {
        var u = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
        vx = rr * Math.cos(ph); vy = u; vz = rr * Math.sin(ph);
      }
      var L = Math.hypot(vx, vy, vz) || 1;
      var bright = Math.pow(rnd(), 2.6);
      var warm = rnd();
      domeDir.push(vx / L, vy / L, vz / L);
      if (warm > 0.78) domeCol.push(1.0, 0.86, 0.70);
      else if (warm > 0.5) domeCol.push(0.92, 0.94, 1.0);
      else domeCol.push(0.80, 0.86, 1.0);
      domeSize.push(1.5 + 5.2 * bright);
    }

    // 如果页面另外加载了真实星表（window.REAL_STARS = [[raDeg, decDeg, mag, bv], ...]），就用它替换生成的星空
    var REAL = window.REAL_STARS;
    if (REAL && REAL.length) {
      domeDir.length = 0; domeCol.length = 0; domeSize.length = 0;
      for (var rk = 0; rk < REAL.length; rk++) {
        var ra = REAL[rk][0] * Math.PI / 180, dec = REAL[rk][1] * Math.PI / 180;
        var cd = Math.cos(dec);
        domeDir.push(cd * Math.cos(ra), Math.sin(dec), cd * Math.sin(ra));
        var mag = REAL[rk][2];
        var br = clamp((6.3 - mag) / 5.6, 0.05, 1);
        domeSize.push(1.5 + 5.4 * br * br);
        var bv = REAL[rk][3] == null ? 0.6 : REAL[rk][3];
        var rr2 = clamp(1 - (bv + 0.4) * 0.22, 0.62, 1.0);
        var gg2 = clamp(1 - Math.abs(bv - 0.4) * 0.12, 0.72, 1.0);
        var bb2 = clamp(0.78 + bv * 0.16, 0.7, 1.0);
        domeCol.push(rr2, gg2, bb2);
      }
    }
    var domeCount = domeSize.length;
    var bufDomeDir = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeDir);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(domeDir), gl.STATIC_DRAW);
    var bufDomeCol = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeCol);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(domeCol), gl.STATIC_DRAW);
    var bufDomeSize = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeSize);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(domeSize), gl.STATIC_DRAW);
    var domeVAO = gl.createVertexArray();
    gl.bindVertexArray(domeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeDir);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeCol);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufDomeSize);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);


    // 小行星带（火星与木星之间）
    var beltN = lowPower ? 700 : 1900;
    var bOrbit = [], bPhase = [], bSpeed = [], bSize = [], bBright = [];
    for (var bi = 0; bi < beltN; bi++) {
      var bau = 2.05 + rnd() * 1.15;
      var bR = Math.pow(bau, 0.52) * SYS_SCALE;
      bOrbit.push(bR * (1 + (rnd() - 0.5) * 0.03));
      bPhase.push(rnd() * Math.PI * 2);
      bSpeed.push(0.55 / Math.pow(bau, 1.5));
      bSize.push(2.6 + rnd() * 3.4);
      bBright.push(0.4 + rnd() * 0.8);
    }
    var bufBeltO = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bOrbit), gl.STATIC_DRAW);
    var bufBeltP = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltP);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bPhase), gl.STATIC_DRAW);
    var bufBeltS = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltS);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bSpeed), gl.STATIC_DRAW);
    var bufBeltZ = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltZ);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bSize), gl.STATIC_DRAW);
    var bufBeltB = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bBright), gl.STATIC_DRAW);
    var beltVAO = gl.createVertexArray();
    gl.bindVertexArray(beltVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltO); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltP); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltS); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltZ); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufBeltB); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    /* ---------- 星云实例 ---------- */
    var NEB = [];
    for (arm = 0; arm < 4; arm++) {
      var nb = arm * Math.PI * 0.5;
      for (var nc = 0; nc < 34; nc++) {
        var nt = Math.pow(rnd(), 0.7);
        var nr = 0.10 + nt * 0.88;
        var nth = nb + 3.4 * Math.pow(nr, 0.65) + 0.3 + (rnd() - 0.5) * 0.18;
        var nx = Math.cos(nth) * nr, nz = Math.sin(nth) * nr;
        var ny = (rnd() + rnd() - 1) * 0.02;
        var hii = rnd();
        var col = hii > 0.90 ? [1.0, 0.60, 0.48] : (hii > 0.70 ? [0.55, 0.70, 0.95] : [0.80, 0.78, 0.74]);
        NEB.push(nx, ny, nz, col[0], col[1], col[2],
          0.030 + rnd() * 0.055,            // size
          rnd() * Math.PI * 2,              // rot
          (0.012 + rnd() * 0.04) * (hii > 0.90 ? 1.5 : 1.0), // alpha
          rnd() * 10);
      }
    }
    var nebCount = NEB.length / 10;

    var bufNeb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufNeb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(NEB), gl.STATIC_DRAW);

    var nebVAO = gl.createVertexArray();
    gl.bindVertexArray(nebVAO);
    var bufCorner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCorner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufNeb);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 40, 24); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    var nebTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, nebTex);
    var nsize = 256;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nsize, nsize, 0, gl.RGBA, gl.UNSIGNED_BYTE, nebulaTexture(nsize));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* ---------- 轨道线 ---------- */
    var orbitSegs = 220;
    var orbitData = [];
    for (i = 0; i < orbitSegs; i++) {
      var a0 = (i / orbitSegs) * Math.PI * 2, a1 = ((i + 1) / orbitSegs) * Math.PI * 2;
      orbitData.push(Math.cos(a0), 0, Math.sin(a0), Math.cos(a1), 0, Math.sin(a1));
    }
    var bufOrbit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufOrbit);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(orbitData), gl.STATIC_DRAW);
    var orbitVAO = gl.createVertexArray();
    gl.bindVertexArray(orbitVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufOrbit);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    /* ---------- 球 / 环 / 四边形 ---------- */
    var sph = sphere(32, 20);
    var bufSphPos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufSphPos);
    gl.bufferData(gl.ARRAY_BUFFER, sph.pos, gl.STATIC_DRAW);
    var bufSphNrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufSphNrm);
    gl.bufferData(gl.ARRAY_BUFFER, sph.nrm, gl.STATIC_DRAW);
    var bufSphIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufSphIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sph.idx, gl.STATIC_DRAW);
    var meshVAO = gl.createVertexArray();
    gl.bindVertexArray(meshVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSphPos);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufSphNrm);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufSphIdx);
    gl.bindVertexArray(null);

    var ringPos = [], ringNrm = [], ringIdx = [];
    var rSeg = 96, rIn = 1.35, rOut = 2.15;
    for (var ri = 0; ri <= rSeg; ri++) {
      var ra = ri / rSeg * Math.PI * 2;
      ringPos.push(Math.cos(ra) * rIn, 0, Math.sin(ra) * rIn);
      ringNrm.push(0, 1, 0);
      ringPos.push(Math.cos(ra) * rOut, 0, Math.sin(ra) * rOut);
      ringNrm.push(0, 1, 0);
    }
    for (ri = 0; ri < rSeg; ri++) {
      var q = ri * 2;
      ringIdx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
    var bufRingPos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufRingPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ringPos), gl.STATIC_DRAW);
    var bufRingNrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufRingNrm);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ringNrm), gl.STATIC_DRAW);
    var bufRingIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufRingIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ringIdx), gl.STATIC_DRAW);
    var ringVAO = gl.createVertexArray();
    gl.bindVertexArray(ringVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufRingPos);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufRingNrm);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufRingIdx);
    gl.bindVertexArray(null);

    var quadVAO = gl.createVertexArray();
    var bufQuad = gl.createBuffer();
    gl.bindVertexArray(quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    /* ---------- 帧缓冲 ---------- */
    var W = 2, H = 2, DPR = 1;
    var sceneTex, sceneDepth, sceneFBO, bloomTexA, bloomTexB, bloomFBOA, bloomFBOB;
    var targetFBO = null;
    var postOk = true;

    function makeTex(w, h, internal, format, type) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    function cleanupTargets() {
      if (sceneFBO) { gl.deleteFramebuffer(sceneFBO); sceneFBO = null; }
      if (sceneTex) { gl.deleteTexture(sceneTex); sceneTex = null; }
      if (sceneDepth) { gl.deleteRenderbuffer(sceneDepth); sceneDepth = null; }
      if (bloomFBOA) { gl.deleteFramebuffer(bloomFBOA); bloomFBOA = null; }
      if (bloomFBOB) { gl.deleteFramebuffer(bloomFBOB); bloomFBOB = null; }
      if (bloomTexA) { gl.deleteTexture(bloomTexA); bloomTexA = null; }
      if (bloomTexB) { gl.deleteTexture(bloomTexB); bloomTexB = null; }
    }

    function attemptTargets(internal, type) {
      cleanupTargets();
      var bw = Math.max(1, Math.floor(W / 2)), bh = Math.max(1, Math.floor(H / 2));

      sceneTex = makeTex(W, H, internal, gl.RGBA, type);
      sceneFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      sceneDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;

      bloomTexA = makeTex(bw, bh, internal, gl.RGBA, type);
      bloomFBOA = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOA);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTexA, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;

      bloomTexB = makeTex(bw, bh, internal, gl.RGBA, type);
      bloomFBOB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTexB, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }

    function buildTargets() {
      postOk = attemptTargets(gl.RGBA16F, gl.HALF_FLOAT);
      if (!postOk) postOk = attemptTargets(gl.RGBA8, gl.UNSIGNED_BYTE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      targetFBO = postOk ? sceneFBO : null;
    }

    var view = mat4(), proj = mat4(), model = mat4();
    var camPos = [0, 0, 0];
    var solarShift = 0, solarShiftY = 0;
    var solarFov = 38 * Math.PI / 180;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, lowPower ? 2 : 1.75);
      var w = cv.clientWidth || window.innerWidth;
      var h = cv.clientHeight || window.innerHeight;
      W = Math.max(2, Math.round(w * DPR));
      H = Math.max(2, Math.round(h * DPR));
      cv.width = W;
      cv.height = H;
      buildTargets();
      var aspect = w / h;
      if (aspect >= 1.55) { solarShift = 0.30; solarShiftY = 0; }
      else if (aspect >= 1.15) { solarShift = 0.34; solarShiftY = 0; }
      else { solarShift = 0; solarShiftY = -0.34; }
    }

    /* ---------- 相机 ---------- */
    var DIR = [-0.16, 0.72, 0.62];   // 从斜上方切入星盘

    function galaxyCam(t) {
      var u = clamp((t - 2.6) / 2.0, 0, 1);
      var k = u * u * (3 - 2 * u);
      var d = 3.55 - 0.35 * smooth(0.9, 2.6, t);
      d = d - (d - 0.085) * k;

      // 开场看银心，俯冲时视线逐渐锁到目标恒星
      var look = smooth(2.7, 4.1, t);
      var drift = smooth(0.6, 2.6, t);
      var side = Math.sin(drift * 2.0) * 0.09 * (1 - k);

      return {
        eye: [
          TARGET[0] + DIR[0] * d + side * 0.4,
          TARGET[1] + DIR[1] * d,
          TARGET[2] + DIR[2] * d
        ],
        target: [TARGET[0] * look, TARGET[1] * look, TARGET[2] * look],
        fov: 50 * Math.PI / 180,
        shiftX: 0.30 * smooth(4.15, 4.6, t)
      };
    }

    function solarCam(t) {
      var pull = smooth(4.8, 6.6, t);
      var aspect = W / H;
      // 按「外圈轨道在横向上占屏幕多宽」(NDC) 反推相机距离，任何比例都能自适应
      var fracX = aspect >= 1.7 ? 0.50 : (aspect >= 1.55 ? 0.56 : (aspect >= 1.15 ? 0.45 : 0.78));
      var f = 1 / Math.tan(solarFov / 2);
      var R = Math.pow(30.07, 0.52) * SYS_SCALE;
      var d = (f / aspect) * R / fracX;
      d *= (1 - 0.05 * pull) * (1 + 0.012 * Math.sin(t * 0.28));
      var elev = 0.40;
      return {
        eye: [0, Math.sin(elev) * d, Math.cos(elev) * d],
        target: [0, 0, 0],
        fov: solarFov
      };
    }

    /* ---------- 绘制 ---------- */
    function setModel(m, x, y, z, s) {
      m[0] = s; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = s; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = s; m[11] = 0;
      m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    }
    function scaleModel(m, sx, sy, sz) {
      m[0] = sx; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = sz; m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    }

    function u3(p, name, a, b, c) { gl.uniform3f(gl.getUniformLocation(p, name), a, b, c); }
    function u1(p, name, v) { gl.uniform1f(gl.getUniformLocation(p, name), v); }
    function um(p, name, m) { gl.uniformMatrix4fv(gl.getUniformLocation(p, name), false, m); }

    var vpNow = mat4(), vpPrev = mat4(), tmpView = mat4(), tmpProj = mat4();

    function drawGalaxy(t, alpha) {
      if (alpha <= 0.003) return;
      var cam = galaxyCam(t);
      lookAt(view, cam.eye, cam.target, [0, 0.6, 1]);
      perspective(proj, cam.fov, W / H, 0.004, 100, cam.shiftX, 0);
      camPos = cam.eye;

      var pixelScale = (H * 0.5) / Math.tan(cam.fov / 2);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);

      // 星云
      gl.useProgram(progNeb);
      um(progNeb, 'uView', view); um(progNeb, 'uProj', proj);
      u1(progNeb, 'uAlpha', alpha);
      u3(progNeb, 'uCam', cam.eye[0], cam.eye[1], cam.eye[2]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, nebTex);
      gl.uniform1i(gl.getUniformLocation(progNeb, 'uTex'), 0);
      gl.bindVertexArray(nebVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nebCount);
      gl.bindVertexArray(null);

      // 恒星
      gl.useProgram(progPoints);
      um(progPoints, 'uView', view); um(progPoints, 'uProj', proj);
      u1(progPoints, 'uAlpha', alpha);
      u1(progPoints, 'uPixelScale', pixelScale);
      gl.bindVertexArray(pointsVAO);
      gl.drawArrays(gl.POINTS, 0, galaxyCount);
      gl.bindVertexArray(null);

      // 银心辉光
      gl.useProgram(progSprite);
      um(progSprite, 'uView', view); um(progSprite, 'uProj', proj);
      gl.uniform2f(gl.getUniformLocation(progSprite, 'uSquash'), 1, 1);
      u3(progSprite, 'uCenter', 0, 0, 0);
      u1(progSprite, 'uSize', 0.17);
      u1(progSprite, 'uAlpha', alpha);
      u1(progSprite, 'uPower', 3.2);
      u1(progSprite, 'uCore', 1.2);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 核球外晕
      u1(progSprite, 'uSize', 0.5);
      u1(progSprite, 'uAlpha', alpha * 0.3);
      u1(progSprite, 'uPower', 2.2);
      u1(progSprite, 'uCore', 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 抵达的目标恒星：越接近越大
      var near = smooth(3.3, 4.55, t);
      if (near > 0.01) {
        u3(progSprite, 'uCenter', TARGET[0], TARGET[1], TARGET[2]);
        u1(progSprite, 'uSize', 0.0035);
        u1(progSprite, 'uAlpha', alpha);
        u1(progSprite, 'uPower', 2.4);
        u1(progSprite, 'uCore', 0.8 * near);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindVertexArray(null);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    function drawSolar(t, alpha) {
      if (alpha <= 0.003) return;
      var cam = solarCam(t);
      lookAt(view, cam.eye, cam.target, [0, 1, 0]);
      perspective(proj, cam.fov, W / H, 0.01, 100, solarShift, solarShiftY);
      camPos = cam.eye;

      // 星空背景
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(progDome);
      um(progDome, 'uView', view);
      um(progDome, 'uProj', proj);
      u3(progDome, 'uCam', cam.eye[0], cam.eye[1], cam.eye[2]);
      u1(progDome, 'uAlpha', alpha);
      gl.bindVertexArray(domeVAO);
      gl.drawArrays(gl.POINTS, 0, domeCount);
      gl.bindVertexArray(null);
      gl.depthMask(true);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(progLines);
      um(progLines, 'uView', view); um(progLines, 'uProj', proj);
      u3(progLines, 'uColor', 0.86, 0.83, 0.77);
      gl.bindVertexArray(orbitVAO);
      for (var i = 0; i < PLANETS.length; i++) {
        var R = orbitRadius(PLANETS[i].a);
        scaleModel(model, R, 1, R);
        um(progLines, 'uModel', model);
        u1(progLines, 'uAlpha', alpha * (0.40 - i * 0.028));
        gl.drawArrays(gl.LINES, 0, orbitSegs * 2);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      gl.useProgram(progMesh);
      um(progMesh, 'uView', view); um(progMesh, 'uProj', proj);
      u3(progMesh, 'uCam', camPos[0], camPos[1], camPos[2]);
      u1(progMesh, 'uEmissive', 0);
      gl.bindVertexArray(meshVAO);

      for (i = 0; i < PLANETS.length; i++) {
        var p = PLANETS[i];
        var lam = (p.L0 + p.n * (DAYS0 + t * DAYS_PER_SEC)) * Math.PI / 180;
        var rr = orbitRadius(p.a);
        var pr = planetRadius(p.r);
        setModel(model, Math.cos(lam) * rr, 0, Math.sin(lam) * rr, pr);
        um(progMesh, 'uModel', model);
        u3(progMesh, 'uColor', p.c[0], p.c[1], p.c[2]);
        u1(progMesh, 'uAlpha', alpha);
        gl.uniform1i(gl.getUniformLocation(progMesh, 'uType'), p.t);
        gl.drawElements(gl.TRIANGLES, sph.idx.length, gl.UNSIGNED_SHORT, 0);

        if (p.r > 9 && p.r < 10) {
          gl.bindVertexArray(ringVAO);
          setModel(model, Math.cos(lam) * rr, 0, Math.sin(lam) * rr, pr);
          um(progMesh, 'uModel', model);
          u3(progMesh, 'uColor', 0.86, 0.79, 0.62);
          u1(progMesh, 'uAlpha', alpha * 0.5);
          u1(progMesh, 'uEmissive', 0.22);
          gl.uniform1i(gl.getUniformLocation(progMesh, 'uType'), 0);
          gl.drawElements(gl.TRIANGLES, rSeg * 6, gl.UNSIGNED_SHORT, 0);
          u1(progMesh, 'uEmissive', 0);
          gl.bindVertexArray(meshVAO);
        }
      }

      gl.uniform1i(gl.getUniformLocation(progMesh, 'uType'), 0);
      gl.uniform1f(gl.getUniformLocation(progMesh, 'uEmissive'), 1.0);
      setModel(model, 0, 0, 0, 0.062);
      um(progMesh, 'uModel', model);
      u3(progMesh, 'uColor', 1.0, 0.96, 0.88);
      u1(progMesh, 'uAlpha', alpha);
      gl.drawElements(gl.TRIANGLES, sph.idx.length, gl.UNSIGNED_SHORT, 0);
      gl.uniform1f(gl.getUniformLocation(progMesh, 'uEmissive'), 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);

      // 太阳辉光
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progSprite);
      um(progSprite, 'uView', view); um(progSprite, 'uProj', proj);
      u3(progSprite, 'uCenter', 0, 0, 0);
      gl.uniform2f(gl.getUniformLocation(progSprite, 'uSquash'), 1, 1);
      u1(progSprite, 'uSize', 0.115);
      u1(progSprite, 'uAlpha', alpha * 0.32);
      u1(progSprite, 'uPower', 2.7);
      u1(progSprite, 'uCore', 0.30);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 横向镜头光斑
      gl.uniform2f(gl.getUniformLocation(progSprite, 'uSquash'), 4.5, 0.05);
      u1(progSprite, 'uSize', 0.30);
      u1(progSprite, 'uAlpha', alpha * 0.13);
      u1(progSprite, 'uPower', 2.4);
      u1(progSprite, 'uCore', 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform2f(gl.getUniformLocation(progSprite, 'uSquash'), 1, 1);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    function render(t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);

      var galA = smooth(0.5, 1.6, t) * (1 - smooth(4.55, 5.15, t));
      var solA = smooth(4.75, 6.15, t);
      var streak = smooth(2.85, 3.35, t) * (1 - smooth(4.35, 4.8, t));
      var flash = 0, flashMid = 0;

      drawGalaxy(t, galA);
      drawSolar(t, solA);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (postOk) post(t, flash * flash, streak, flashMid);
      setText(t > 4.95);
    }

    function fullscreen() {
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    function post(t, flash, streak, flashMid) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOA);
      gl.viewport(0, 0, Math.max(1, W >> 1), Math.max(1, H >> 1));
      gl.useProgram(progBright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(gl.getUniformLocation(progBright, 'uTex'), 0);
      u1(progBright, 'uThresh', 1.0);
      fullscreen();

      gl.useProgram(progBlur);
      for (var i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOB);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexA);
        gl.uniform1i(gl.getUniformLocation(progBlur, 'uTex'), 0);
        gl.uniform2f(gl.getUniformLocation(progBlur, 'uDir'), 1.0 / Math.max(1, W >> 1), 0);
        fullscreen();

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOA);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexB);
        gl.uniform2f(gl.getUniformLocation(progBlur, 'uDir'), 0, 1.0 / Math.max(1, H >> 1));
        fullscreen();
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progComp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(gl.getUniformLocation(progComp, 'uScene'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTexA);
      gl.uniform1i(gl.getUniformLocation(progComp, 'uBloom'), 1);
      u1(progComp, 'uExposure', 0.95 + flash * 1.1);
      u1(progComp, 'uBloomAmount', 0.85);
      u1(progComp, 'uTime', t);
      u1(progComp, 'uStreak', streak * 0.42);
      u1(progComp, 'uFlash', flashMid);
      gl.uniform2f(gl.getUniformLocation(progComp, 'uRes'), W, H);
      fullscreen();
    }

    /* ---------- 进度控制 ---------- */
    var TEND = 6.4;          // 时间轴总长（秒）
    var DURATION = 7.8;      // 自动播放走完用多久
    var prog = 0;            // 0..1
    var auto = true;
    var running = true, readyDone = false;
    var lastTs = 0;
    var simT = 0;

    var heroEl = document.getElementById('hero');
    var textOn = false;
    var delaysSet = false;

    function setText(on) {
      if (textOn === on || !heroEl) return;
      textOn = on;
      if (on && !delaysSet && heroEl) {
        delaysSet = true;
        var kids = heroEl.querySelectorAll('.hero__copy > *');
        for (var i = 0; i < kids.length; i++) kids[i].style.transitionDelay = (i * 0.09) + 's';
      }
      heroEl.classList.toggle('is-ready', on);
    }

    var idleTimer = null;
    function scrub(d, absolute) {
      auto = false;
      prog = absolute != null ? d : clamp(prog + d, 0, 1);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (prog < 0.998) auto = true;   // 停手一会儿就自动接着放
      }, 2400);
    }

    function loop(now) {
      if (!running) return;
      var dt = lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0.016;
      lastTs = now;
      if (auto && prog < 1) prog = Math.min(1, prog + dt / DURATION);
      if (prog >= 1) simT += dt; else simT = 0;
      render(prog * TEND + simT);
      requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener('resize', function () {
      clearTimeout(resize.__t);
      resize.__t = setTimeout(function () {
        resize();
        if (frozen !== null) render(frozen);
      }, 180);
    }, { passive: true });

    if (frozen !== null) {
      prog = clamp(frozen / TEND, 0, 1);
      auto = false;
      render(frozen);
      return;
    }
    if (reduced) { render(99); setText(true); return; }

    /* ---------- 手动接管：滚轮 / 拖动 / 键盘 ---------- */
    window.addEventListener('wheel', function (e) {
      if (window.pageYOffset > 6) return;
      if (prog >= 0.999 && e.deltaY > 0) return;
      e.preventDefault();
      scrub(e.deltaY * 0.00085);
    }, { passive: false });

    var drag = null;
    cv.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return;
      drag = { y: e.clientY, p: prog };
      auto = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      prog = clamp(drag.p - (e.clientY - drag.y) * 0.0016, 0, 1);
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { if (prog < 0.998) auto = true; }, 2400);
    });
    window.addEventListener('pointercancel', function () { drag = null; });

    window.addEventListener('keydown', function (e) {
      if (window.pageYOffset > 6) return;
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
        if (prog >= 0.999) return;
        scrub(0.06); e.preventDefault();
      } else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') {
        scrub(-0.06); e.preventDefault();
      } else if (k === 'Home') {
        scrub(0, true);
      } else if (k === 'End') {
        scrub(1, true);
      }
    });

    requestAnimationFrame(loop);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) running = false;
          else if (!running) { running = true; lastTs = 0; requestAnimationFrame(loop); }
        });
      }, { threshold: 0 }).observe(cv);
    }

    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running && frozen === null) { lastTs = 0; requestAnimationFrame(loop); }
    });

    setTimeout(function () { if (!textOn) setText(true); }, 7000);
  };

  // 出错时把信息贴到页面上
  var _init = NS.init;
  NS.init = function () {
    try {
      _init();
    } catch (e) {
      var d = document.createElement('pre');
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;max-width:100vw;margin:0;padding:14px;background:#3a0d08;color:#ffb4a2;font:12px/1.5 monospace;white-space:pre-wrap';
      d.textContent = 'WebGL 渲染出错：' + (e && e.message ? e.message : e);
      document.body.appendChild(d);
      console.error(e);
    }
  };
})();
