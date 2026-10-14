/* =====================================================================
   CPX 가상환자 눈 엔진 (EyeEngine)
   - 같은 환자의 눈을 코드로 그려서, 소견 파라미터만 바꿔 정상/이상 상태를 만든다.
   - 화면 기준 좌표: 환자 우안(OD, 'R') = 화면 왼쪽, 좌안(OS, 'L') = 화면 오른쪽.
   - 시간은 advance(dt)로만 흐르므로, 일괄 생성 시 프레임 단위로 정확히 재현된다.
   ===================================================================== */
(function (global) {
  'use strict';

  const W = 1200, H = 600;
  const MM = 11.8;                 // 1 mm = 11.8 px (눈틈 폭 28 mm ≈ 330 px)
  const RI = 68;                   // 홍채 반지름(px) ≈ 11.5 mm 지름
  const EYE = { R: { cx: 340, cy: 330, dir: 1 }, L: { cx: 860, cy: 330, dir: -1 } }; // dir: 코 쪽 방향(x)
  const FW = 330;                  // 눈틈 폭

  // ---------------------------------------------------------- 유틸
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  const rgb = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function bez(p0, p1, p2, p3, t) { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }

  // ---------------------------------------------------------- 정적 텍스처 (한 번만 생성)
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function shade(hex, t) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255]; return rgb(t >= 0 ? mix(c, [200, 150, 95], t) : mix(c, [8, 4, 2], -t)); }
  function makeIris(seed, tint) {
    tint = tint || 0;
    const S = RI * 2 + 8, c = makeCanvas(S * 2, S * 2), g = c.getContext('2d'), r = rng(seed);
    g.scale(2, 2); g.translate(S / 2, S / 2);
    // 바탕: 짙은 갈색 홍채(동아시아 환자)
    let gr = g.createRadialGradient(0, 0, 4, 0, 0, RI);
    gr.addColorStop(0, shade('#5a3a1e', tint)); gr.addColorStop(0.35, shade('#6e4624', tint)); gr.addColorStop(0.62, shade('#4a2d17', tint)); gr.addColorStop(0.92, shade('#2c1a0e', tint * 0.6)); gr.addColorStop(1, '#140b06');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, RI, 0, 7); g.fill();
    // 방사상 섬유
    for (let i = 0; i < 420; i++) {
      const a = r() * Math.PI * 2, r0 = RI * (0.18 + r() * 0.2), r1 = RI * (0.55 + r() * 0.42);
      const l = 25 + r() * 35, wob = (r() - 0.5) * 0.12;
      g.strokeStyle = `hsla(${24 + r() * 12},${40 + r() * 25}%,${l + tint * 30}%,${0.18 + r() * 0.25})`;
      g.lineWidth = 0.4 + r() * 1.1;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.quadraticCurveTo(Math.cos(a + wob) * (r0 + r1) / 2, Math.sin(a + wob) * (r0 + r1) / 2, Math.cos(a + wob * 2) * r1, Math.sin(a + wob * 2) * r1);
      g.stroke();
    }
    // 소와(crypts)
    for (let i = 0; i < 26; i++) {
      const a = r() * 7, rr = RI * (0.42 + r() * 0.4);
      g.fillStyle = `rgba(20,10,4,${0.25 + r() * 0.3})`;
      g.beginPath(); g.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, 2 + r() * 4, 1 + r() * 2, a, 0, 7); g.fill();
    }
    // 동공 주위 고리(collarette)
    g.strokeStyle = 'rgba(150,100,55,0.35)'; g.lineWidth = 3;
    g.beginPath(); for (let i = 0; i <= 64; i++) { const a = i / 64 * 7, rr = RI * 0.42 + Math.sin(a * 9 + seed) * 2.5; i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke();
    // 윤부 고리
    gr = g.createRadialGradient(0, 0, RI * 0.82, 0, 0, RI);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(8,4,2,0.85)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, RI, 0, 7); g.fill();
    return c;
  }

  function makeSkinNoise() {
    const c = makeCanvas(300, 300), g = c.getContext('2d'), r = rng(7), id = g.createImageData(300, 300);
    for (let i = 0; i < id.data.length; i += 4) { const v = r(); id.data[i] = id.data[i + 1] = id.data[i + 2] = v > 0.5 ? 255 : 0; id.data[i + 3] = Math.abs(v - 0.5) * 34; }
    g.putImageData(id, 0, 0); return c;
  }

  function makeVessels(seed) {
    // 공막 혈관: 눈 가장자리(원개부)에서 각막윤부 쪽으로 자라는 가지
    const r = rng(seed), list = [];
    for (let i = 0; i < 72; i++) {
      // 시작점: 눈틈 경계 근처(극좌표, 눈 중심 기준)
      const side = r() < 0.5 ? -1 : 1;
      const a = (side < 0 ? Math.PI : 0) + (r() - 0.5) * 1.9;
      let x = Math.cos(a) * (FW * 0.5 - 6), y = Math.sin(a) * 60;
      const pts = [[x, y]]; let ang = Math.atan2(-y, -x) + (r() - 0.5) * 0.9;
      const n = 8 + (r() * 10 | 0), step = 7 + r() * 5;
      for (let k = 0; k < n; k++) { ang += (r() - 0.5) * 0.7; x += Math.cos(ang) * step; y += Math.sin(ang) * step * 0.7; pts.push([x, y]); if (Math.hypot(x, y) < RI + 4) break; }
      list.push({ pts, w: 0.35 + r() * 0.95, deep: r() < 0.25 });
      if (r() < 0.6 && pts.length > 4) { // 곁가지
        const s = pts[2 + (r() * (pts.length - 3) | 0)]; let bx = s[0], by = s[1], ba = ang + (r() < 0.5 ? 1 : -1) * (0.6 + r());
        const bp = [[bx, by]]; for (let k = 0; k < 5; k++) { ba += (r() - 0.5) * 0.8; bx += Math.cos(ba) * 7; by += Math.sin(ba) * 5; bp.push([bx, by]); }
        list.push({ pts: bp, w: 0.4 + r() * 0.7, deep: false });
      }
    }
    // 각막윤부 주위 방사상 미세혈관(모양체 충혈 표현용)
    const peri = [];
    for (let i = 0; i < 90; i++) { const a = r() * 7, r0 = RI + 2 + r() * 4, r1 = RI + 14 + r() * 26; peri.push([a, r0, r1, 0.4 + r() * 0.8]); }
    return { list, peri };
  }

  function makeLashes(seed) {
    const r = rng(seed), up = [], low = [];
    for (let i = 0; i < 78; i++) up.push({ t: 0.12 + 0.86 * (i / 78) + (r() - 0.5) * 0.01, len: 0.75 + r() * 0.5, curl: 0.7 + r() * 0.6, w: 0.9 + r() * 0.8, jit: (r() - 0.5) * 0.25 });
    for (let i = 0; i < 34; i++) low.push({ t: 0.25 + 0.72 * (i / 34) + (r() - 0.5) * 0.02, len: 0.6 + r() * 0.6, w: 0.6 + r() * 0.5, jit: (r() - 0.5) * 0.3 });
    return { up, low };
  }

  function makeBrow(seed) { const r = rng(seed), h = []; for (let i = 0; i < 620; i++) { const t = Math.pow(r(), 0.9); h.push({ t: t, o: (r() - 0.5) * 2, len: 9 + r() * 12, a: (r() - 0.5) * 0.5, w: 0.7 + r() * 0.9, sh: 0.5 + r() * 0.5 }); } return h; }

  function makeFundus(seed) {
    // 망막 혈관 아케이드: 시신경유두에서 4방향, 동맥/정맥 쌍
    const r = rng(seed), arcs = [];
    function grow(x, y, ang, width, depth, kind, bend, out) {
      const pts = [[x, y, width]]; let a = ang;
      const n = 16 + (r() * 10 | 0);
      for (let i = 0; i < n; i++) {
        a += bend + (r() - 0.5) * 0.18; x += Math.cos(a) * 11; y += Math.sin(a) * 11; width *= 0.965; pts.push([x, y, width]);
        if (depth < 3 && r() < 0.11 && i > 3) grow(x, y, a + (r() < 0.5 ? 0.7 : -0.7), width * 0.75, depth + 1, kind, bend * 0.4, out);
        if (Math.hypot(x, y) > 250) break;
      }
      out.push({ pts, kind });
    }
    const v = [], a = [];
    // 화면 기준 유두가 원점, 황반은 -x 방향(이측)
    const plans = [[-2.35, 0.055], [2.35, -0.055], [-0.85, -0.02], [0.85, 0.02], [-1.6, 0.01], [1.6, -0.01]];
    for (const [ang, bend] of plans) {
      grow(0, 0, ang + 0.06, 6.2, 0, 'v', bend, v);
      grow(0, 0, ang - 0.06, 4.4, 0, 'a', bend, a);
    }
    const lesions = []; for (let i = 0; i < 400; i++) lesions.push([r(), r(), r(), r()]);
    return { v, a, lesions };
  }

  // ---------------------------------------------------------- 환자 외형(연령·성별)
  // 연령대 6 × 성별 2. iseed/itint = 사람마다 다른 홍채 무늬·색조
  const AVATARS = {
    c_m: { name: '소아 남아 (8세)',   skin: [238, 201, 173], browDark: 0.5,  browDensity: 0.5,  browGray: 0,    browArch: 6,  browThick: 0.65, lash: 1.15, wrinkle: 0,    bags: 0,    iris: 1.1,  open: 1.08, arcus: 0,    iseed: 101, itint: 0.05 },
    c_f: { name: '소아 여아 (8세)',   skin: [241, 205, 179], browDark: 0.5,  browDensity: 0.5,  browGray: 0,    browArch: 10, browThick: 0.6,  lash: 1.25, wrinkle: 0,    bags: 0,    iris: 1.1,  open: 1.1,  arcus: 0,    iseed: 102, itint: 0.1 },
    t_m: { name: '청소년 남 (16세)',  skin: [232, 189, 159], browDark: 0.9,  browDensity: 0.9,  browGray: 0,    browArch: 2,  browThick: 0.9,  lash: 1.0,  wrinkle: 0,    bags: 0,    iris: 1.04, open: 1.04, arcus: 0,    iseed: 103, itint: -0.05 },
    t_f: { name: '청소년 여 (16세)',  skin: [237, 196, 168], browDark: 0.75, browDensity: 0.7,  browGray: 0,    browArch: 12, browThick: 0.7,  lash: 1.2,  wrinkle: 0,    bags: 0,    iris: 1.04, open: 1.06, arcus: 0,    iseed: 104, itint: 0.08 },
    y_m: { name: '20~30대 남성',      skin: [226, 181, 151], browDark: 1,    browDensity: 1,    browGray: 0,    browArch: 0,  browThick: 1,    lash: 1.0,  wrinkle: 0,    bags: 0.1,  iris: 1,    open: 1,    arcus: 0,    iseed: 105, itint: 0 },
    y_f: { name: '20~30대 여성',      skin: [234, 193, 166], browDark: 0.8,  browDensity: 0.7,  browGray: 0,    browArch: 12, browThick: 0.7,  lash: 1.25, wrinkle: 0,    bags: 0.05, iris: 1,    open: 1.04, arcus: 0,    iseed: 106, itint: 0.12 },
    m_m: { name: '40~50대 남성',      skin: [222, 176, 146], browDark: 0.95, browDensity: 0.95, browGray: 0.12, browArch: 1,  browThick: 1,    lash: 0.9,  wrinkle: 0.35, bags: 0.35, iris: 1,    open: 0.99, arcus: 0.1,  iseed: 11,  itint: -0.08 },
    m_f: { name: '40~50대 여성',      skin: [230, 188, 160], browDark: 0.75, browDensity: 0.65, browGray: 0.08, browArch: 10, browThick: 0.7,  lash: 1.05, wrinkle: 0.35, bags: 0.3,  iris: 1,    open: 1.01, arcus: 0.08, iseed: 108, itint: 0.04 },
    s_m: { name: '60대 남성',         skin: [220, 174, 144], browDark: 0.85, browDensity: 0.8,  browGray: 0.4,  browArch: 2,  browThick: 0.95, lash: 0.8,  wrinkle: 0.7,  bags: 0.7,  iris: 1,    open: 0.97, arcus: 0.35, iseed: 109, itint: -0.12 },
    s_f: { name: '60대 여성',         skin: [228, 184, 156], browDark: 0.7,  browDensity: 0.6,  browGray: 0.35, browArch: 8,  browThick: 0.7,  lash: 0.9,  wrinkle: 0.7,  bags: 0.6,  iris: 1,    open: 0.98, arcus: 0.3,  iseed: 110, itint: 0 },
    e_m: { name: '80대 남성',         skin: [216, 173, 146], browDark: 0.75, browDensity: 0.6,  browGray: 0.75, browArch: 2,  browThick: 0.9,  lash: 0.65, wrinkle: 1,    bags: 1,    iris: 1,    open: 0.93, arcus: 0.6,  iseed: 111, itint: -0.04 },
    e_f: { name: '80대 여성',         skin: [222, 180, 155], browDark: 0.65, browDensity: 0.5,  browGray: 0.7,  browArch: 6,  browThick: 0.7,  lash: 0.7,  wrinkle: 1,    bags: 0.9,  iris: 1,    open: 0.94, arcus: 0.55, iseed: 112, itint: 0.06 }
  };
  const AVATAR_ALIAS = { adult_m: 'm_m', adult_f: 'y_f', older: 'e_m', child: 'c_m' };

  // ---------------------------------------------------------- 엔진
  function EyeEngine(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.tex = {
      iris: { R: makeIris(11), L: makeIris(23) }, skin: makeSkinNoise(),
      ves: { R: makeVessels(101), L: makeVessels(202) }, lash: { R: makeLashes(5), L: makeLashes(9) },
      brow: { R: makeBrow(3), L: makeBrow(4) }, fundus: { R: makeFundus(31), L: makeFundus(47) }
    };
    this.t = 0;
    this.avatarId = 'm_m'; this.avatar = AVATARS.m_m; this.irisCache = {};
    this.setState(null);
    this.resize();
  }

  EyeEngine.prototype.setAvatar = function (id) {
    id = AVATAR_ALIAS[id] || id; if (!AVATARS[id]) id = 'm_m';
    this.avatarId = id; this.avatar = AVATARS[id];
    if (!this.irisCache[id]) { const a = AVATARS[id]; this.irisCache[id] = { R: makeIris(a.iseed, a.itint), L: makeIris(a.iseed + 7, a.itint) }; }
    this.tex.iris = this.irisCache[id];
  };
  EyeEngine.AVATAR_ALIAS = AVATAR_ALIAS;
  EyeEngine.AVATARS = AVATARS;

  EyeEngine.prototype.resize = function () {
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    this.dpr = dpr; this.c.width = W * dpr; this.c.height = H * dpr;
  };

  EyeEngine.prototype.setState = function (st) {
    const def = { pupil: 3.5, react: 1, afferent: 1, shape: 'round', near: 1, icterus: 0, injection: 0, inj: 'conj', violaceous: 0, pallor: 0, petechiae: 0, discharge: 0, tearing: 0, haze: 0, infiltrate: 0, hypopyon: 0, cataract: 0, limbalIschemia: 0, arcus: 0, ptosis: 0, retraction: 0, lidEdema: 0, lidRed: 0, bleph: 0, stye: null, xanth: 0, proptosis: 0, dev: [0, 0], lim: { abd: 1, add: 1, up: 1, down: 1 }, photophobia: 0, fatigable: 0 };
    st = st || { R: def, L: def, fundusR: {}, fundusL: {}, field: { R: 'normal', L: 'normal' }, glob: { conjGaze: 0, conscious: 'alert', nys: { rest: null, gaze: 0, dix: null } } };
    this.S = JSON.parse(JSON.stringify(st));
    for (const s of ['R', 'L']) this.S[s] = Object.assign({}, def, this.S[s]);
    this.S.glob = Object.assign({ conjGaze: 0, conjLimit: null, conscious: 'alert', nys: { rest: null, gaze: 0, dix: null } }, this.S.glob || {});
    this.S.glob.nys = Object.assign({ rest: null, gaze: 0, dix: null }, this.S.glob.nys || {});
    // 동적 상태
    this.dyn = {
      pupil: { R: this.S.R.pupil, L: this.S.L.pupil }, hist: [],
      gaze: [0, 0], gazeT: [0, 0], open: { R: 1, L: 1 }, blink: 0, nextBlink: 2.5,
      evert: 0, evertT: 0, room: 1, roomT: 1, light: null, lightPos: 0, near: 0, nearT: 0,
      fatigue: 0, squint: { R: 0, L: 0 }, holdLids: 0, dix: null, nysPhase: 0, torsion: 0,
      mode: 'eyes', zoom: { s: 1, x: 600, y: 330 }, zoomT: { s: 1, x: 600, y: 330 },
      target: null, gauge: false, field: null, hud: '', modeFade: 1
    };
  };

  // ---------- 조작 API
  EyeEngine.prototype.look = function (x, y) { this.dyn.gazeT = [clamp(x, -1, 1), clamp(y, -1, 1)]; };
  EyeEngine.prototype.setRoom = function (on) { this.dyn.roomT = on ? 1 : 0; };
  EyeEngine.prototype.setLight = function (side) { this.dyn.light = side; };
  EyeEngine.prototype.setEvert = function (v) { this.dyn.evertT = v ? 1 : 0; };
  EyeEngine.prototype.setNear = function (v) { this.dyn.nearT = v ? 1 : 0; };
  EyeEngine.prototype.blinkNow = function () { this.dyn.blink = 0.001; };
  EyeEngine.prototype.setMode = function (m) { if (this.dyn.mode !== m) { this.dyn.mode = m; this.dyn.modeFade = 0; } };
  EyeEngine.prototype.setZoom = function (s, x, y) { this.dyn.zoomT = { s: s, x: x === undefined ? 600 : x, y: y === undefined ? 330 : y }; };
  EyeEngine.prototype.setTarget = function (p) { this.dyn.target = p; };
  EyeEngine.prototype.setGauge = function (v) { this.dyn.gauge = v; };
  // 안저 실사 사진(우안 방향): { abn: 이 프리셋 사진, normal: 정상 사진 }. 이상 소견이 있는 쪽 눈엔 abn, 없는 쪽엔 normal.
  // 좌안은 좌우를 뒤집어 그림(시신경유두가 코 쪽). null 이면 코드 그림
  const FIMG = {};
  EyeEngine.prototype.setFundusPhotos = function (p) {
    this.fundusPhotos = p || null;
    for (const src of Object.values(p || {})) if (src && !FIMG[src]) { FIMG[src] = new Image(); FIMG[src].src = src; }
  };
  EyeEngine.prototype.fundusPhoto = function (s) {
    const p = this.fundusPhotos; if (!p) return null;
    const F = this.S['fundus' + s] || {}, abn = Object.values(F).some(v => v > 0);
    const im = FIMG[abn ? p.abn : p.normal];
    return im && im.complete && im.naturalWidth ? im : null;
  };
  EyeEngine.prototype.setHoldLids = function (v) { this.dyn.holdLids = v ? 1 : 0; };
  EyeEngine.prototype.setHud = function (s) { this.dyn.hud = s || ''; };
  EyeEngine.prototype.startDix = function (side) { this.dyn.dix = { side: side, t: 0 }; };
  EyeEngine.prototype.stopDix = function () { this.dyn.dix = null; };
  EyeEngine.prototype.setField = function (f) { this.dyn.field = f; };

  // ---------- 계산: 각 눈의 실제 시선
  EyeEngine.prototype.eyeGaze = function (side) {
    const e = this.S[side], G = this.S.glob, d = this.dyn;
    let tx = d.gaze[0], ty = d.gaze[1];
    if (G.conjGaze) { // 공동 편위(뇌졸중): 병변 쪽으로 쏠리고 반대쪽으로 못 감
      const c = G.conjGaze; tx = c + tx * (1 - Math.abs(c)); if (c > 0) tx = Math.max(tx, c * 0.6); else tx = Math.min(tx, c * 0.6);
    }
    const abdSign = side === 'R' ? -1 : 1;
    let x = tx * ((tx * abdSign > 0) ? e.lim.abd : e.lim.add);
    let y = ty * (ty < 0 ? e.lim.up : e.lim.down);
    x += e.dev[0]; y += e.dev[1];
    // 안진
    const ny = this.nystagmus(side, tx, ty);
    return { x: clamp(x + ny.x, -1.08, 1.08), y: clamp(y + ny.y, -1.05, 1.05), tor: ny.t };
  };

  EyeEngine.prototype.nystagmus = function (side, gx, gy) {
    const N = this.S.glob.nys, d = this.dyn, t = this.t; let x = 0, y = 0, tor = 0;
    const saw = (f, ph) => { const p = (t * f + ph) % 1; return p < 0.82 ? 0.5 - p / 0.82 : -0.5 + (p - 0.82) / 0.18; }; // 느린 성분 → 빠른 복귀
    if (N.rest) {
      const R = N.rest; let A = R.amp || 0.04; const f = R.freq || 2;
      if (R.type === 'h') { const s = R.dir === 'L' ? 1 : -1; A *= 1 + 1.1 * Math.max(0, gx * s) - 0.6 * Math.max(0, -gx * s); x += saw(f, 0) * A * s * -1 * -1; }
      else if (R.type === 'v') { const s = R.dir === 'down' ? 1 : -1; A *= 1 + 0.6 * Math.max(0, Math.abs(gx) - 0.4); y += saw(f, 0) * A * s * -1 * -1; }
    }
    if (N.gaze && Math.abs(gx) > 0.45) {
      const k = (Math.abs(gx) - 0.45) / 0.55, s = gx > 0 ? 1 : -1; x += saw(2.4, 0.3) * N.gaze * (0.6 + k * 1.6) * s;
    }
    if (d.dix && N.dix && N.dix.side === d.dix.side) {
      const tt = d.dix.t, lat = 2.5; // 잠복기 후 상승·감쇠
      if (tt > lat) { const env = Math.min(1, (tt - lat) / 1.5) * Math.exp(-(tt - lat) / 9); tor = saw(2.6, 0) * 9 * env * (N.dix.side === 'R' ? -1 : 1); y += saw(2.6, 0) * 0.05 * env * -1; }
    }
    return { x: x, y: y, t: tor };
  };

  // ---------- 동공 역학 (지연 + 비대칭 시상수)
  EyeEngine.prototype.pupilStep = function (dt) {
    const d = this.dyn, S = this.S;
    const roomStim = 0.08 + 0.37 * d.room;
    let D = 0;
    for (const s of ['R', 'L']) { const lit = d.light === s || d.light === 'both' ? 1 : 0; D += (roomStim + lit * d.lightPos) * S[s].afferent; }
    d.hist.push([this.t, D]); while (d.hist.length > 2 && d.hist[1][0] < this.t - 0.24) d.hist.shift();
    const Dd = d.hist[0][1];
    for (const s of ['R', 'L']) {
      const e = S[s];
      let target = e.react > 0 ? e.pupil * Math.exp(-0.55 * e.react * (Dd - 0.9)) : e.pupil;
      target *= Math.exp(-0.45 * d.near * (e.near || 0));
      target = clamp(target, 0.9, 8.6);
      const tau = target < d.pupil[s] ? 0.22 : 0.85;
      d.pupil[s] += (target - d.pupil[s]) * (1 - Math.exp(-dt / tau));
    }
  };

  EyeEngine.prototype.advance = function (dt) {
    dt = Math.min(dt, 0.1); this.t += dt; const d = this.dyn, S = this.S;
    const k = (tau) => 1 - Math.exp(-dt / tau);
    d.gaze[0] += (d.gazeT[0] - d.gaze[0]) * k(0.09); d.gaze[1] += (d.gazeT[1] - d.gaze[1]) * k(0.09);
    if (d.target) { d.gazeT = [d.target[0], d.target[1]]; }
    d.room += (d.roomT - d.room) * k(0.35);
    d.lightPos += ((d.light ? 1 : 0) - d.lightPos) * k(0.06);
    d.evert += (d.evertT - d.evert) * k(0.18);
    d.near += (d.nearT - d.near) * k(0.3);
    d.modeFade = Math.min(1, d.modeFade + dt * 3);
    for (const key of ['s', 'x', 'y']) d.zoom[key] += (d.zoomT[key] - d.zoom[key]) * k(0.25);
    if (d.dix) d.dix.t += dt;
    // 피로성 안검하수
    if (d.gaze[1] < -0.45) d.fatigue = Math.min(1, d.fatigue + dt * 0.12); else d.fatigue = Math.max(0, d.fatigue - dt * 0.05);
    // 눈부심(광선공포증) 찡그림
    for (const s of ['R', 'L']) {
      const lit = (d.light === s || d.light === 'both') ? d.lightPos : 0;
      const other = s === 'R' ? 'L' : 'R';
      const want = Math.max(lit * S[s].photophobia, ((d.light === other) ? d.lightPos : 0) * S[s].photophobia * 0.6, lit * 0.12);
      d.squint[s] += (want - d.squint[s]) * k(0.12);
    }
    // 깜빡임
    if (d.blink > 0) { d.blink += dt / 0.16; if (d.blink >= 1) d.blink = 0; }
    else if (this.t > d.nextBlink && d.evertT < 0.5 && !d.target) { d.blink = 0.001; d.nextBlink = this.t + 2.5 + Math.abs(Math.sin(this.t * 7.3)) * 4; }
    this.pupilStep(dt);
  };

  // ---------- 눈꺼풀 형상
  EyeEngine.prototype.lidGeom = function (side) {
    const E = EYE[side], e = this.S[side], d = this.dyn, G = this.S.glob, gz = this.eyeGaze(side);
    const med = [E.cx + E.dir * FW / 2, E.cy + 4], lat = [E.cx - E.dir * FW / 2, E.cy - 10];
    let open = 1;
    open *= 1 - 0.78 * clamp(e.ptosis + (e.fatigable ? d.fatigue * 0.45 : 0), 0, 1);
    open *= 1 + 0.32 * e.retraction + 0.12 * e.proptosis;
    open *= this.avatar.open;
    open *= 1 - 0.62 * e.lidEdema;
    open *= 1 - 0.5 * d.squint[side];
    if (G.conscious === 'drowsy') open *= 0.62; else if (G.conscious === 'coma') open *= 0.05;
    if (d.holdLids) open = Math.max(open, 0.92);
    const bl = d.blink > 0 ? Math.sin(d.blink * Math.PI) : 0;
    open *= 1 - bl * 0.97;
    // 시선에 따라 위눈꺼풀이 따라감(갑상선 눈병증은 하방에서 지체: lid lag)
    const follow = gz.y > 0 ? (1 - 0.85 * e.retraction) : 1;
    const upShift = gz.y * 26 * follow, lowShift = gz.y * 9 + 10 * e.proptosis + 6 * e.retraction;
    const evert = d.evert * 44;
    const U = 66, L = 70;
    const upO = [[E.cx + E.dir * FW * 0.2, E.cy - U * 1.28 + upShift], [E.cx - E.dir * FW * 0.27, E.cy - U * 1.22 + upShift]];
    const closedY = E.cy + 26;
    const up = [med, [upO[0][0], lerp(closedY, upO[0][1], open)], [upO[1][0], lerp(closedY - 6, upO[1][1], open)], lat];
    const lowBase = [med, [E.cx + E.dir * FW * 0.2, E.cy + L * 1.12 + lowShift], [E.cx - E.dir * FW * 0.26, E.cy + L * 1.08 + lowShift], lat];
    const low = [med, [lowBase[1][0], lowBase[1][1] + evert], [lowBase[2][0], lowBase[2][1] + evert * 0.9], lat];
    return { med, lat, up, low, lowBase, open, gz };
  };

  function pathCurve(g, c, move) { if (move) g.moveTo(c[0][0], c[0][1]); g.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]); }
  function revCurve(c) { return [c[3], c[2], c[1], c[0]]; }

  // ---------------------------------------------------------- 그리기: 얼굴(피부·눈썹·코)
  function soft(g, x, y, rx, ry, stops) { // 가장자리가 보이지 않는 타원형 그라데이션
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const st of stops) gr.addColorStop(st[0], st[1]);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore();
  }

  EyeEngine.prototype.drawSkin = function (g) {
    const S = this.S;
    let gr = g.createLinearGradient(0, 0, 0, H);
    const sk = this.avatar.skin; gr.addColorStop(0, rgb(mix(sk, [150, 95, 70], 0.12))); gr.addColorStop(0.45, rgb(sk)); gr.addColorStop(1, rgb(mix(sk, [150, 95, 70], 0.15)));
    g.fillStyle = gr; g.fillRect(-200, -200, W + 400, H + 400);
    // 콧대: 가운데 하이라이트 + 양옆 그늘 (경계선 없음)
    soft(g, 600, 420, 70, 300, [[0, 'rgba(255,232,212,0.30)'], [0.6, 'rgba(255,232,212,0.12)']]);
    soft(g, 548, 400, 46, 260, [[0, 'rgba(125,72,48,0.16)']]);
    soft(g, 652, 400, 46, 260, [[0, 'rgba(125,72,48,0.16)']]);
    for (const s of ['R', 'L']) {
      const E = EYE[s], e = S[s];
      // 눈확 그늘·눈썹뼈 하이라이트·눈 밑 그늘
      soft(g, E.cx + E.dir * 25, E.cy - 18, 270, 175, [[0, 'rgba(105,58,38,0.20)'], [0.55, 'rgba(105,58,38,0.10)']]);
      soft(g, E.cx - E.dir * 30, E.cy - 112, 175, 42, [[0, 'rgba(255,232,214,0.20)']]);
      soft(g, E.cx, E.cy - 52, 175, 52, [[0, 'rgba(150,82,62,0.12)']]);
      soft(g, E.cx + E.dir * 20, E.cy + 92, 165, 34, [[0, 'rgba(118,62,42,0.13)']]);
      soft(g, E.cx, E.cy + 66, 150, 18, [[0, 'rgba(255,226,206,0.22)']]);
      soft(g, E.cx - E.dir * 40, E.cy + 170, 210, 110, [[0, 'rgba(255,230,210,0.20)']]);
      // 눈꺼풀 발적/부종
      if (e.lidRed > 0) soft(g, E.cx, E.cy - 10, 235, 165, [[0, `rgba(205,70,60,${0.5 * e.lidRed})`], [0.6, `rgba(205,70,60,${0.25 * e.lidRed})`]]);
      if (e.lidEdema > 0) {
        soft(g, E.cx, E.cy - 64, 195, 75 + 30 * e.lidEdema, [[0, `rgba(255,220,205,${0.38 * e.lidEdema})`]]);
        soft(g, E.cx, E.cy + 88, 175, 55, [[0, `rgba(255,215,200,${0.3 * e.lidEdema})`]]);
      }
      const A = this.avatar;
      if (A.bags) { soft(g, E.cx + E.dir * 10, E.cy + 98, 140, 30, [[0, `rgba(110,60,45,${0.22 * A.bags})`]]); soft(g, E.cx + E.dir * 10, E.cy + 80, 130, 16, [[0, `rgba(255,222,200,${0.2 * A.bags})`]]); }
      if (A.wrinkle) {
        g.save(); g.lineCap = 'round';
        const lx = E.cx - E.dir * 178, ly = E.cy - 6;
        for (let k = 0; k < 4; k++) { g.strokeStyle = `rgba(120,70,50,${0.22 * A.wrinkle})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(lx - E.dir * 8, ly - 30 + k * 20); g.quadraticCurveTo(lx - E.dir * 40, ly - 24 + k * 22, lx - E.dir * 70, ly - 34 + k * 30); g.stroke(); }
        for (let k = 0; k < 2; k++) { g.strokeStyle = `rgba(120,70,50,${0.18 * A.wrinkle})`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(E.cx + E.dir * 100, E.cy + 92 + k * 16); g.quadraticCurveTo(E.cx, E.cy + 112 + k * 18, E.cx - E.dir * 120, E.cy + 86 + k * 18); g.stroke(); }
        // 위눈꺼풀 피부 처짐(바깥쪽)
        g.restore();
      }
      this.drawBrow(g, s);
    }
    g.globalAlpha = 0.5; g.fillStyle = g.createPattern(this.tex.skin, 'repeat'); g.fillRect(-200, -200, W + 400, H + 400); g.globalAlpha = 1;
  };

  EyeEngine.prototype.drawBrow = function (g, s) {
    const E = EYE[s], hairs = this.tex.brow[s], d = this.dyn;
    const lower = d.squint[s] * 10;
    const A = this.avatar, ar = A.browArch;
    const p0 = [E.cx + E.dir * 150, E.cy - 118 + lower], p1 = [E.cx + E.dir * 50, E.cy - 156 - ar + lower], p2 = [E.cx - E.dir * 80, E.cy - 160 - ar * 1.4 + lower], p3 = [E.cx - E.dir * 172, E.cy - 128 + lower * 0.5];
    // 눈썹 바탕 그늘
    g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(70,42,28,0.16)';
    for (let k = 0; k < 3; k++) { g.lineWidth = 22 - k * 6; g.beginPath(); g.moveTo(p0[0], p0[1]); g.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); g.stroke(); }
    g.restore();
    g.lineCap = 'round';
    const hc = mix([30, 19, 13], [150, 145, 140], A.browGray);
    for (let hi = 0; hi < hairs.length * A.browDensity; hi++) {
      const h = hairs[hi];
      const p = bez(p0, p1, p2, p3, h.t);
      const thick = h.t < 0.35 ? 1 : 1 - (h.t - 0.35) * 1.1;     // 머리(안쪽)는 두껍고 꼬리는 가늘게
      const spread = 10 * Math.max(0.3, thick) * A.browThick;
      const ox = p[0], oy = p[1] + h.o * spread;
      // 안쪽 털은 위로, 나머지는 바깥쪽 위로 비스듬히
      const lateral = -E.dir;
      const ang = h.t < 0.12 ? -Math.PI / 2 + lateral * 0.35 : Math.atan2(-0.32 - 0.25 * (1 - h.t), lateral) + h.a * 0.4;
      g.strokeStyle = rgb(hc, (0.3 + 0.45 * h.sh) * Math.max(0.35, thick) * A.browDark); g.lineWidth = h.w;
      g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo(ox + Math.cos(ang) * h.len * 0.6, oy + Math.sin(ang) * h.len * 0.6, ox + Math.cos(ang + lateral * 0.15) * h.len, oy + Math.sin(ang + lateral * 0.15) * h.len + 2); g.stroke();
    }
  };

  // ---------------------------------------------------------- 그리기: 한쪽 눈
  EyeEngine.prototype.drawEye = function (g, side) {
    const E = EYE[side], e = this.S[side], d = this.dyn, geo = this.lidGeom(side), gz = geo.gz;
    const ix = E.cx + gz.x * 96, iy = E.cy - 6 + gz.y * 40;
    const prop = 1 + 0.05 * e.proptosis;

    // 위눈꺼풀 주름(쌍꺼풀 선)
    g.save();
    const crease = geo.up.map((p, i) => [p[0], (i === 0 || i === 3) ? p[1] - 6 : Math.min(p[1], E.cy - 60) - 26 - 8 * e.lidEdema]);
    g.lineCap = 'round';
    for (let k = 0; k < 18; k++) { const t0 = 0.18 + k * 0.035, a = 0.2 * Math.sin(Math.PI * (k + 0.5) / 18); const p1 = bez(...crease, t0), p2 = bez(...crease, t0 + 0.035); g.strokeStyle = `rgba(105,58,40,${a})`; g.lineWidth = 2; g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke(); }
    g.restore();

    // ---- 눈틈 클립
    g.save();
    g.beginPath(); pathCurve(g, geo.up, true); g.lineTo(geo.low[3][0], geo.low[3][1]); pathCurve(g, revCurve(geo.low), false); g.closePath();
    g.clip();

    // 아래눈꺼풀을 당긴 경우: 검결막 띠
    if (d.evert > 0.02) {
      const pc = mix([206, 72, 80], [236, 205, 196], e.pallor);
      g.fillStyle = rgb(pc);
      g.beginPath(); pathCurve(g, geo.lowBase, true); g.lineTo(geo.low[3][0], geo.low[3][1]); pathCurve(g, revCurve(geo.low), false); g.closePath(); g.fill();
      // 검결막 혈관결
      const r = rng(side === 'R' ? 77 : 88); g.strokeStyle = rgb(mix(pc, [150, 30, 40], 0.4), 0.5); g.lineWidth = 0.8;
      for (let i = 0; i < 26; i++) { const t = 0.15 + r() * 0.7, p = bez(...geo.low, t), q = bez(...geo.lowBase, t); g.beginPath(); g.moveTo(lerp(p[0], q[0], 0.15), lerp(p[1], q[1], 0.15)); g.lineTo(lerp(p[0], q[0], 0.85) + (r() - 0.5) * 10, lerp(p[1], q[1], 0.85)); g.stroke(); }
      if (e.petechiae) { g.fillStyle = 'rgba(150,10,20,0.9)'; for (let i = 0; i < 18 * e.petechiae; i++) { const t = 0.15 + r() * 0.7, p = bez(...geo.low, t), q = bez(...geo.lowBase, t), m = 0.2 + r() * 0.6; g.beginPath(); g.arc(lerp(p[0], q[0], m), lerp(p[1], q[1], m), 1.2 + r() * 1.6, 0, 7); g.fill(); } }
      // 원개부 그늘
      g.globalAlpha = d.evert * 0.5; g.strokeStyle = 'rgba(90,20,30,0.6)'; g.lineWidth = 6; g.beginPath(); pathCurve(g, geo.lowBase, true); g.stroke(); g.globalAlpha = 1;
      // 공막 영역 재클립
      g.beginPath(); pathCurve(g, geo.up, true); g.lineTo(geo.lowBase[3][0], geo.lowBase[3][1]); pathCurve(g, revCurve(geo.lowBase), false); g.closePath(); g.clip();
    }

    // ---- 공막
    const scl = mix([246, 241, 234], [226, 192, 88], e.icterus * 0.72);
    let gr = g.createRadialGradient(ix, iy, RI * 0.8, E.cx, E.cy, FW * 0.62);
    gr.addColorStop(0, rgb(scl)); gr.addColorStop(0.55, rgb(mix(scl, [214, 196, 182], 0.35))); gr.addColorStop(1, rgb(mix(scl, [160, 128, 112], 0.65)));
    g.fillStyle = gr; g.fillRect(E.cx - FW, E.cy - 160, FW * 2, 320);
    // 황달은 가장자리(원개부)에서 더 진하게
    if (e.icterus) { gr = g.createRadialGradient(ix, iy, RI * 1.1, ix, iy, FW * 0.6); gr.addColorStop(0, 'rgba(225,180,40,0)'); gr.addColorStop(1, `rgba(205,160,40,${0.4 * e.icterus})`); g.fillStyle = gr; g.fillRect(E.cx - FW, E.cy - 160, FW * 2, 320); }
    // 다혈·미만성 붉은 기
    const inj = e.injection;
    if (inj > 0) {
      const col = e.violaceous ? [125, 40, 95] : [196, 48, 52];
      if (e.inj === 'conj' || e.inj === 'diffuse' || e.inj === 'plethora' || e.inj === 'bulbar') {
        gr = g.createRadialGradient(ix, iy, RI * (e.inj === 'bulbar' ? 1.35 : 1.0), ix, iy, FW * 0.62);
        gr.addColorStop(0, rgb(col, e.inj === 'diffuse' || e.inj === 'plethora' ? 0.28 * inj : 0)); gr.addColorStop(0.6, rgb(col, 0.3 * inj)); gr.addColorStop(1, rgb(col, 0.55 * inj));
        g.fillStyle = gr; g.fillRect(E.cx - FW, E.cy - 160, FW * 2, 320);
      }
      if (e.inj === 'ciliary') {
        gr = g.createRadialGradient(ix, iy, RI, ix, iy, RI * 1.85);
        gr.addColorStop(0, rgb([150, 32, 70], 0.75 * inj)); gr.addColorStop(0.5, rgb([170, 40, 60], 0.35 * inj)); gr.addColorStop(1, 'rgba(170,40,60,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(ix, iy, RI * 1.9, 0, 7); g.fill();
      }
      if (e.inj === 'sector') {
        const sx = ix - E.dir * RI * 1.75, sy = iy;
        gr = g.createRadialGradient(sx, sy, 6, sx, sy, 78);
        gr.addColorStop(0, rgb(col, 0.8 * inj)); gr.addColorStop(0.6, rgb(col, 0.45 * inj)); gr.addColorStop(1, rgb(col, 0));
        g.fillStyle = gr; g.beginPath(); g.ellipse(sx, sy, 80, 64, 0, 0, 7); g.fill();
      }
    }
    // 혈관
    const V = this.tex.ves[side];
    const vx = gz.x * 86, vy = gz.y * 34;
    for (const v of V.list) {
      let a = 0.07;
      const p = v.pts[(v.pts.length / 2) | 0], dist = Math.hypot(p[0], p[1]);
      if (inj > 0) {
        let wgt = 0;
        if (e.inj === 'conj') wgt = clamp((dist - RI) / (FW * 0.35), 0.15, 1);
        else if (e.inj === 'bulbar') wgt = dist < RI * 1.3 ? 0 : clamp((dist - RI * 1.3) / 60, 0, 1);
        else if (e.inj === 'ciliary') wgt = clamp(1.2 - (dist - RI) / 80, 0.15, 1);
        else if (e.inj === 'sector') wgt = (p[0] * -E.dir > RI * 0.6) ? 1 : 0.1;
        else wgt = 0.85;
        a += inj * wgt * 0.7;
      }
      const col = (e.violaceous && v.deep) ? 'rgba(110,30,90,' : 'rgba(178,34,42,';
      g.strokeStyle = col + clamp(a, 0, 0.95) + ')'; g.lineWidth = v.w * (1 + inj * 0.5);
      g.beginPath(); v.pts.forEach((q, i) => { const X = E.cx + q[0] + vx * 0.92, Y = E.cy + q[1] + vy * 0.92; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
    }
    if (inj > 0 && (e.inj === 'ciliary' || e.inj === 'diffuse')) {
      g.strokeStyle = `rgba(150,28,60,${0.55 * inj})`;
      for (const p of V.peri) { g.lineWidth = p[3]; g.beginPath(); g.moveTo(ix + Math.cos(p[0]) * p[1], iy + Math.sin(p[0]) * p[1]); g.lineTo(ix + Math.cos(p[0]) * p[2], iy + Math.sin(p[0]) * p[2]); g.stroke(); }
    }
    // 눈물언덕
    const cx2 = geo.med[0] - E.dir * 18, cy2 = geo.med[1] - 2;
    gr = g.createRadialGradient(cx2, cy2, 2, cx2, cy2, 26);
    gr.addColorStop(0, `rgba(${200 + 20 * inj | 0},120,120,0.95)`); gr.addColorStop(0.7, 'rgba(190,110,110,0.55)'); gr.addColorStop(1, 'rgba(190,110,110,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx2, cy2, 26, 20, 0, 0, 7); g.fill();

    // ---- 홍채·동공·각막
    g.save();
    g.translate(ix, iy);
    g.scale((1 - 0.17 * Math.abs(gz.x)) * prop * this.avatar.iris, (1 - 0.13 * Math.abs(gz.y)) * prop * this.avatar.iris);
    // 윤부 허혈(하얗게 창백한 윤부)
    if (e.limbalIschemia) { g.strokeStyle = `rgba(250,250,245,${0.85 * e.limbalIschemia})`; g.lineWidth = 12; g.beginPath(); g.arc(0, 0, RI + 5, -2.4, -0.6); g.stroke(); }
    g.save(); g.rotate((gz.tor || 0) * Math.PI / 180);
    g.drawImage(this.tex.iris[side], -RI - 4, -RI - 4, RI * 2 + 8, RI * 2 + 8);
    g.restore();
    // 동공
    const pr = d.pupil[side] * MM / 2;
    g.fillStyle = '#050403';
    g.beginPath();
    if (e.shape === 'round') g.arc(0, 0, pr, 0, 7);
    else if (e.shape === 'oval') g.ellipse(0, 0, pr * 0.84, pr * 1.12, 0, 0, 7);
    else { for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2, rr = pr * (1 + 0.16 * Math.sin(a * 3 + 1) + 0.09 * Math.sin(a * 5 + 2)); i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }
    g.fill();
    // 동공 가장자리 부드럽게
    gr = g.createRadialGradient(0, 0, pr * 0.85, 0, 0, pr * 1.25); gr.addColorStop(0, 'rgba(5,4,3,0)'); gr.addColorStop(0.5, 'rgba(5,4,3,0.35)'); gr.addColorStop(1, 'rgba(5,4,3,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, pr * 1.3, 0, 7); g.fill();
    // 백내장
    if (e.cataract) {
      gr = g.createRadialGradient(-pr * 0.2, -pr * 0.2, 1, 0, 0, pr);
      gr.addColorStop(0, `rgba(235,235,225,${0.85 * e.cataract})`); gr.addColorStop(0.7, `rgba(200,200,190,${0.7 * e.cataract})`); gr.addColorStop(1, `rgba(160,160,150,${0.5 * e.cataract})`);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, pr * 0.98, 0, 7); g.fill();
      g.strokeStyle = `rgba(255,255,250,${0.35 * e.cataract})`; g.lineWidth = 1.2;
      for (let i = 0; i < 10; i++) { const a = i / 10 * 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * pr * 0.9, Math.sin(a) * pr * 0.9); g.stroke(); }
    }
    // 각막환
    const arc = Math.max(e.arcus, this.avatar.arcus);
    if (arc) { g.strokeStyle = `rgba(236,236,228,${0.85 * arc})`; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, RI - 4, 0, 7); g.stroke(); }
    // 각막 부종(혼탁)
    if (e.haze) { gr = g.createRadialGradient(0, 0, 0, 0, 0, RI); gr.addColorStop(0, `rgba(205,215,220,${0.55 * e.haze})`); gr.addColorStop(1, `rgba(200,212,220,${0.4 * e.haze})`); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, RI, 0, 7); g.fill(); }
    // 각막 침윤
    if (e.infiltrate) { gr = g.createRadialGradient(-6, -8, 1, -6, -8, 24); gr.addColorStop(0, `rgba(250,250,240,${0.95 * e.infiltrate})`); gr.addColorStop(0.6, `rgba(240,240,230,${0.6 * e.infiltrate})`); gr.addColorStop(1, 'rgba(240,240,230,0)'); g.fillStyle = gr; g.beginPath(); g.arc(-6, -8, 26, 0, 7); g.fill(); }
    // 전방축농
    if (e.hypopyon) { g.save(); g.beginPath(); g.arc(0, 0, RI - 3, 0, 7); g.clip(); g.fillStyle = 'rgba(245,240,225,0.95)'; const lvl = RI - 3 - e.hypopyon * 40; g.beginPath(); g.rect(-RI, lvl, RI * 2, RI); g.fill(); g.restore(); }
    // 반사광(창문 + 펜라이트)
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-RI * 0.38, -RI * 0.42, 11, 7, -0.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.ellipse(-RI * 0.3, -RI * 0.32, 26, 15, -0.5, 0, 7); g.fill();
    const lit = (d.light === side || d.light === 'both') ? d.lightPos : 0;
    if (lit > 0.05) { gr = g.createRadialGradient(RI * 0.12, RI * 0.08, 0, RI * 0.12, RI * 0.08, 16); gr.addColorStop(0, `rgba(255,255,255,${lit})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(RI * 0.12, RI * 0.08, 16, 0, 7); g.fill(); }
    g.restore();

    // 위눈꺼풀 그림자
    g.save();
    g.shadowColor = 'rgba(55,25,12,0.55)'; g.shadowBlur = 16; g.shadowOffsetY = 9;
    g.fillStyle = '#000';
    g.beginPath(); g.moveTo(geo.up[0][0], geo.up[0][1] - 300); pathCurve(g, geo.up, false); g.lineTo(geo.up[3][0], geo.up[3][1] - 300); g.closePath();
    g.beginPath(); g.moveTo(geo.up[0][0], geo.up[0][1]); g.lineTo(geo.up[0][0], geo.up[0][1] - 300); g.lineTo(geo.up[3][0], geo.up[3][1] - 300); g.lineTo(geo.up[3][0], geo.up[3][1]); pathCurve(g, revCurve(geo.up), false); g.fill();
    g.restore();
    // 아래 눈물띠
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 2.2; g.beginPath(); pathCurve(g, (d.evert > 0.02 ? geo.low : geo.low).map((p, i) => i === 0 || i === 3 ? p : [p[0], p[1] - 3]), true); g.stroke();
    g.restore(); // clip 해제

    // ---- 눈꺼풀 가장자리
    g.lineCap = 'round';
    const bleph = e.bleph;
    g.strokeStyle = rgb(mix([120, 66, 50], [196, 66, 60], bleph)); g.lineWidth = 4 + bleph * 3;
    g.beginPath(); pathCurve(g, geo.up, true); g.stroke();
    g.strokeStyle = rgb(mix([186, 112, 98], [205, 80, 72], bleph)); g.lineWidth = 3 + bleph * 2;
    g.beginPath(); pathCurve(g, geo.low, true); g.stroke();
    // 속눈썹
    const LS = this.tex.lash[side];
    g.strokeStyle = 'rgba(22,14,10,0.92)';
    for (const l of LS.up) {
      const p = bez(...geo.up, l.t), p2 = bez(...geo.up, Math.min(1, l.t + 0.01));
      const nx = -(p2[1] - p[1]), ny = p2[0] - p[0], nl = Math.hypot(nx, ny) || 1;
      let ux = nx / nl, uy = ny / nl; if (uy > 0) { ux = -ux; uy = -uy; }
      const len = (14 + 16 * l.t) * l.len * (0.4 + 0.6 * geo.open) * this.avatar.lash;
      const lx = -E.dir * (0.25 + 0.6 * l.t);
      g.lineWidth = l.w;
      g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0] + (ux + lx * 0.3) * len * 0.6, p[1] + uy * len * 0.7, p[0] + (ux * 0.6 + lx + l.jit) * len, p[1] + uy * len * 0.75 - l.curl * 3); g.stroke();
    }
    g.strokeStyle = 'rgba(30,20,14,0.7)';
    for (const l of LS.low) {
      const p = bez(...geo.low, l.t), len = 7 * l.len;
      g.lineWidth = l.w; g.beginPath(); g.moveTo(p[0], p[1] + 1); g.lineTo(p[0] - E.dir * (2 + l.t * 4) + l.jit * 4, p[1] + len); g.stroke();
    }
    // 안검염 딱지
    if (bleph) { const r = rng(side === 'R' ? 3 : 4); g.fillStyle = `rgba(232,214,160,${0.85 * bleph})`; for (let i = 0; i < 40; i++) { const p = bez(...(r() < 0.65 ? geo.up : geo.low), 0.15 + r() * 0.8); g.beginPath(); g.ellipse(p[0] + (r() - 0.5) * 4, p[1] + (r() - 0.5) * 4, 1.5 + r() * 2.5, 1 + r() * 1.5, r() * 3, 0, 7); g.fill(); } }
    // 분비물
    if (e.discharge) {
      g.fillStyle = `rgba(226,200,96,${0.9 * e.discharge})`; const r = rng(side === 'R' ? 13 : 14);
      const m = geo.med; g.beginPath(); g.ellipse(m[0] - E.dir * 14, m[1] + 4, 12 * e.discharge + 4, 7, 0.3, 0, 7); g.fill();
      for (let i = 0; i < 9; i++) { const p = bez(...geo.low, 0.1 + r() * 0.8); g.beginPath(); g.ellipse(p[0], p[1] + 2, 3 + r() * 5, 2 + r() * 2, 0, 0, 7); g.fill(); }
      for (let i = 0; i < 6; i++) { const p = bez(...geo.up, 0.2 + r() * 0.7); g.beginPath(); g.ellipse(p[0], p[1] - 2, 2 + r() * 4, 1.5 + r() * 2, 0, 0, 7); g.fill(); }
    }
    // 눈물
    if (e.tearing) { const p = bez(...geo.low, 0.35); gr = g.createRadialGradient(p[0], p[1] + 10, 1, p[0], p[1] + 10, 9); gr.addColorStop(0, `rgba(255,255,255,${0.7 * e.tearing})`); gr.addColorStop(1, 'rgba(220,235,245,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(p[0], p[1] + 12, 6, 9, 0, 0, 7); g.fill(); }
    // 다래끼/산립종
    if (e.stye) {
      const st = e.stye, curve = st.lid === 'upper' ? geo.up : geo.low, t = st.pos;
      const p = bez(...curve, t);
      if (st.type === 'hordeolum') {
        soft(g, p[0], p[1] - 6, 70, 46, [[0, 'rgba(214,74,62,0.55)'], [0.6, 'rgba(214,90,75,0.25)']]);
        gr = g.createRadialGradient(p[0] - 6, p[1] - 16, 2, p[0], p[1] - 8, 30); gr.addColorStop(0, 'rgba(240,120,100,0.98)'); gr.addColorStop(0.6, 'rgba(206,64,54,0.9)'); gr.addColorStop(1, 'rgba(190,60,50,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(p[0], p[1] - 8, 32, 22, 0, 0, 7); g.fill();
        gr = g.createRadialGradient(p[0], p[1] - 3, 0, p[0], p[1] - 3, 7); gr.addColorStop(0, 'rgba(252,236,160,1)'); gr.addColorStop(1, 'rgba(240,200,110,0.2)');
        g.fillStyle = gr; g.beginPath(); g.arc(p[0], p[1] - 3, 7, 0, 7); g.fill();
      } else {
        const py = p[1] - 34;
        soft(g, p[0] + 4, py + 12, 46, 20, [[0, 'rgba(120,60,40,0.28)']]);
        gr = g.createRadialGradient(p[0] - 9, py - 9, 2, p[0], py, 32); gr.addColorStop(0, 'rgba(255,232,214,0.98)'); gr.addColorStop(0.55, 'rgba(232,170,145,0.85)'); gr.addColorStop(1, 'rgba(206,140,118,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(p[0], py, 34, 26, 0, 0, 7); g.fill();
        soft(g, p[0], py, 30, 22, [[0, 'rgba(214,110,100,0.18)']]);
      }
    }
    // 황색판종
    if (e.xanth) {
      const p = bez(...geo.up, 0.12); const r = rng(side === 'R' ? 21 : 22);
      for (let i = 0; i < 7; i++) { const x = p[0] - E.dir * (2 + r() * 34), y = p[1] - 22 - r() * 22, rx = 12 + r() * 12; soft(g, x, y, rx, rx * (0.55 + r() * 0.25), [[0, `rgba(238,206,120,${0.75 * e.xanth})`], [0.6, `rgba(232,196,115,${0.5 * e.xanth})`]]); }
    }
    return { ix, iy };
  };

  // ---------------------------------------------------------- 펜라이트·대상물
  EyeEngine.prototype.drawPenlight = function (g) {
    const d = this.dyn; if (!d.light || d.light === 'both' || d.lightPos < 0.02) return;
    const E = EYE[d.light], ang = E.dir > 0 ? -2.45 : -0.69; // 아래 바깥쪽에서 비춤
    const tipX = E.cx - E.dir * 120, tipY = E.cy + 150, k = d.lightPos;
    // 빛 번짐
    g.save(); g.globalCompositeOperation = 'lighter';
    let gr = g.createRadialGradient(E.cx, E.cy, 10, E.cx, E.cy, 210);
    gr.addColorStop(0, `rgba(255,248,225,${0.2 * k})`); gr.addColorStop(0.5, `rgba(255,240,210,${0.1 * k})`); gr.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(E.cx, E.cy, 210, 0, 7); g.fill();
    g.restore();
    // 펜라이트 본체
    g.save(); g.translate(tipX, tipY); g.rotate(ang + Math.PI);
    gr = g.createLinearGradient(0, -9, 0, 9); gr.addColorStop(0, '#d9dde2'); gr.addColorStop(0.5, '#8d949c'); gr.addColorStop(1, '#4b5157');
    g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(0, -9, 210, 18, 8) : g.rect(0, -9, 210, 18); g.fill();
    g.fillStyle = '#2b2f33'; g.fillRect(150, -9.5, 30, 19);
    g.fillStyle = `rgba(255,252,235,${0.6 + 0.4 * k})`; g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill();
    g.restore();
  };

  EyeEngine.prototype.drawTarget = function (g) {
    const d = this.dyn; if (!d.target) return;
    const x = 600 + d.target[0] * 520, y = 330 + d.target[1] * 250;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 6, y + 10, 16, 8, 0, 0, 7); g.fill();
    let gr = g.createLinearGradient(x - 8, 0, x + 8, 0); gr.addColorStop(0, '#1f3e8c'); gr.addColorStop(0.5, '#4f7be0'); gr.addColorStop(1, '#1a3170');
    g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(x - 7, y + 4, 14, 70, 6) : g.rect(x - 7, y + 4, 14, 70); g.fill();
    gr = g.createRadialGradient(x - 3, y - 4, 1, x, y, 12); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b8c4d6');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill();
    g.restore();
  };

  EyeEngine.prototype.drawGauge = function (g) {
    const d = this.dyn; if (!d.gauge) return;
    g.save();
    const y0 = 520; g.fillStyle = 'rgba(250,250,247,0.92)'; g.beginPath(); g.roundRect ? g.roundRect(330, y0 - 34, 540, 70, 10) : g.rect(330, y0 - 34, 540, 70); g.fill();
    g.fillStyle = '#111'; g.font = '600 13px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    for (let mm = 2; mm <= 9; mm++) { const x = 370 + (mm - 2) * 66; g.beginPath(); g.arc(x, y0 - 6, mm * MM / 2 * 0.55, 0, 7); g.fill(); g.fillText(mm + '', x, y0 + 26); }
    g.restore();
    for (const s of ['R', 'L']) {
      const E = EYE[s], v = Math.round(d.pupil[s] * 2) / 2;
      g.fillStyle = 'rgba(15,18,20,0.78)'; g.beginPath(); g.roundRect ? g.roundRect(E.cx - 62, 186, 124, 32, 8) : g.rect(E.cx - 62, 186, 124, 32); g.fill();
      g.fillStyle = '#f2f4f5'; g.font = '600 15px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillText((s === 'R' ? 'OD ' : 'OS ') + v.toFixed(1) + ' mm', E.cx, 208);
    }
  };

  // ---------------------------------------------------------- 안저
  EyeEngine.prototype.drawFundus = function (g) {
    g.fillStyle = '#0b0d0e'; g.fillRect(-200, -200, W + 400, H + 400);
    for (const s of ['R', 'L']) {
      const cx = s === 'R' ? 320 : 880, cy = 300, R = 262, F = Object.assign({ papilledema: 0, flame: 0, dotblot: 0, microan: 0, exudates: 0, cws: 0, drusen: 0, rd: 0, crvo: 0, roth: 0, avnick: 0, venous: 0, pallorDisc: 0 }, this.S['fundus' + s] || {});
      const T = this.tex.fundus[s], r = rng(s === 'R' ? 501 : 502);
      // 유두는 코 쪽: 우안 사진에서는 오른쪽, 좌안은 왼쪽
      const dx = s === 'R' ? 1 : -1, disc = [cx + dx * 105, cy - 6], mac = [cx - dx * 40, cy + 6];
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
      const ph = this.fundusPhoto(s);
      if (ph) {                    // 실사 사진: 사진 속 원형 시야가 검안경 원을 채우도록 조금 크게
        g.save(); g.translate(cx, cy); if (s === 'L') g.scale(-1, 1);
        const k = R * 2.24 / Math.min(ph.naturalWidth, ph.naturalHeight);   // 짧은 변 = 원형 시야 지름 (세로로 긴 사진도 찌그러지지 않게)
        g.drawImage(ph, -ph.naturalWidth * k / 2, -ph.naturalHeight * k / 2, ph.naturalWidth * k, ph.naturalHeight * k); g.restore();
        const cat = this.S[s].cataract || 0;
        if (cat) { g.fillStyle = `rgba(225,215,205,${0.75 * cat})`; g.fillRect(cx - R, cy - R, R * 2, R * 2); }
        const vg = g.createRadialGradient(cx, cy, R * 0.75, cx, cy, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = vg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
        g.restore();
        g.fillStyle = '#c9d0d4'; g.font = '600 15px "IBM Plex Mono", monospace'; g.textAlign = 'center';
        g.fillText((s === 'R' ? '우안 OD' : '좌안 OS') + ' · AI 생성 이미지', cx, cy + R + 28);
        continue;
      }
      let gr = g.createRadialGradient(mac[0], mac[1], 10, cx, cy, R);
      gr.addColorStop(0, '#b4421c'); gr.addColorStop(0.45, '#c9582a'); gr.addColorStop(0.8, '#9a3414'); gr.addColorStop(1, '#3b0f05');
      g.fillStyle = gr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
      // 맥락막 결
      g.globalAlpha = 0.18; for (let i = 0; i < 260; i++) { const L = T.lesions[i]; g.fillStyle = L[2] > 0.5 ? '#e07a40' : '#7a2208'; g.beginPath(); g.ellipse(cx + (L[0] - 0.5) * R * 2, cy + (L[1] - 0.5) * R * 2, 6 + L[3] * 18, 3 + L[2] * 8, L[3] * 3, 0, 7); g.fill(); } g.globalAlpha = 1;
      // 황반
      gr = g.createRadialGradient(mac[0], mac[1], 2, mac[0], mac[1], 58); gr.addColorStop(0, 'rgba(70,18,6,0.75)'); gr.addColorStop(1, 'rgba(70,18,6,0)'); g.fillStyle = gr; g.beginPath(); g.arc(mac[0], mac[1], 60, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.7)'; g.beginPath(); g.arc(mac[0], mac[1], 2.2, 0, 7); g.fill();
      // 망막박리 영역(상부)
      if (F.rd) {
        g.save(); g.beginPath(); g.moveTo(cx - R, cy - R); g.lineTo(cx + R, cy - R);
        for (let i = 0; i <= 20; i++) { const x = cx + R - i / 20 * R * 2; g.lineTo(x, cy - 40 + Math.sin(i * 1.3) * 14); } g.closePath();
        gr = g.createLinearGradient(0, cy - R, 0, cy - 30); gr.addColorStop(0, `rgba(196,190,182,${0.85 * F.rd})`); gr.addColorStop(1, `rgba(170,150,140,${0.55 * F.rd})`); g.fillStyle = gr; g.fill();
        g.strokeStyle = 'rgba(120,110,104,0.5)'; g.lineWidth = 2; for (let k = 0; k < 5; k++) { g.beginPath(); for (let i = 0; i <= 20; i++) { const x = cx + R - i / 20 * R * 2; const y = cy - 70 - k * 34 + Math.sin(i * 1.1 + k) * 9; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
        g.restore();
      }
      // 혈관
      const veinW = 1 + F.venous * 0.5 + F.crvo * 0.6;
      const drawSet = (set, colr, wmul, tort) => {
        for (const v of set) {
          for (let i = 1; i < v.pts.length; i++) {
            const a = v.pts[i - 1], b = v.pts[i];
            const w = Math.max(0.6, b[2] * wmul);
            const off = tort ? Math.sin(i * 1.7) * 3 * tort : 0;
            const inRD = F.rd && (disc[1] + a[1]) < cy - 40;
            g.strokeStyle = inRD ? 'rgba(80,20,16,0.95)' : colr; g.lineWidth = w;
            g.beginPath(); g.moveTo(disc[0] + a[0] * dx, disc[1] + a[1] + off); g.lineTo(disc[0] + b[0] * dx, disc[1] + b[1] + off); g.stroke();
          }
        }
      };
      drawSet(T.v, F.venous || F.crvo ? '#5e0d0a' : '#741410', veinW, F.crvo ? 1 : 0);
      drawSet(T.a, F.avnick ? '#cc5a3e' : '#b3301f', F.avnick ? 0.75 : 1, 0);
      // 동맥 반사
      g.globalAlpha = 0.35; drawSet(T.a, '#f3a07a', F.avnick ? 0.22 : 0.18, 0); g.globalAlpha = 1;
      if (F.avnick) { g.fillStyle = 'rgba(190,80,50,0.9)'; for (let i = 0; i < 6; i++) { const v = T.v[i % T.v.length], p = v.pts[5 + (i % 4)] || v.pts[2]; g.beginPath(); g.arc(disc[0] + p[0] * dx, disc[1] + p[1], 3.5, 0, 7); g.fill(); } }
      // 시신경유두
      const discCol = F.pallorDisc ? '#f6e2c4' : F.papilledema > 0.3 ? '#ec9a62' : '#f1bb82';
      if (F.papilledema) {
        for (let k = 6; k >= 1; k--) { g.fillStyle = `rgba(236,170,110,${0.09 * F.papilledema})`; g.beginPath(); g.arc(disc[0], disc[1], 32 + k * 6 * F.papilledema, 0, 7); g.fill(); }
      }
      gr = g.createRadialGradient(disc[0] - dx * 6, disc[1], 2, disc[0], disc[1], 32); gr.addColorStop(0, '#fbe3c0'); gr.addColorStop(0.45, discCol); gr.addColorStop(1, F.papilledema ? 'rgba(220,130,80,0.7)' : '#d98a55');
      g.fillStyle = gr; g.beginPath(); g.arc(disc[0], disc[1], 32 + F.papilledema * 6, 0, 7); g.fill();
      if (!F.papilledema || F.papilledema < 0.5) { g.fillStyle = 'rgba(255,246,228,0.85)'; g.beginPath(); g.ellipse(disc[0] - dx * 5, disc[1], 11, 13, 0, 0, 7); g.fill(); }
      // 유두 위 혈관이 가려짐(유두부종)
      if (F.papilledema) { gr = g.createRadialGradient(disc[0], disc[1], 24, disc[0], disc[1], 62); gr.addColorStop(0, `rgba(235,160,105,${0.75 * F.papilledema})`); gr.addColorStop(1, 'rgba(235,160,105,0)'); g.fillStyle = gr; g.beginPath(); g.arc(disc[0], disc[1], 62, 0, 7); g.fill(); }
      // 병변
      const Ls = T.lesions; let li = 0; const nxt = () => Ls[(li++) % Ls.length];
      const flameN = F.flame + (F.crvo ? 40 : 0);
      for (let i = 0; i < flameN; i++) { const L = nxt(); const a = L[0] * 7, dd = (F.crvo ? 40 + L[1] * 200 : 45 + L[1] * 90); const x = disc[0] + Math.cos(a) * dd * (F.crvo ? 1 : 1), y = disc[1] + Math.sin(a) * dd; g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(150,12,10,0.85)'; g.beginPath(); g.ellipse(0, 0, 14 + L[2] * 10, 3 + L[3] * 2.5, 0, 0, 7); g.fill(); g.restore(); }
      for (let i = 0; i < F.dotblot + (F.crvo ? 30 : 0); i++) { const L = nxt(); g.fillStyle = 'rgba(120,8,8,0.9)'; g.beginPath(); g.arc(cx + (L[0] - 0.5) * R * 1.4, cy + (L[1] - 0.5) * R * 1.4, 2.5 + L[2] * 5, 0, 7); g.fill(); }
      for (let i = 0; i < F.microan; i++) { const L = nxt(); g.fillStyle = 'rgba(165,20,16,0.95)'; g.beginPath(); g.arc(mac[0] + (L[0] - 0.5) * 220, mac[1] + (L[1] - 0.5) * 200, 1.4 + L[2], 0, 7); g.fill(); }
      for (let i = 0; i < F.exudates; i++) { const L = nxt(); const a = L[0] * 7, dd = 55 + L[1] * 40; g.fillStyle = 'rgba(248,222,120,0.95)'; g.beginPath(); g.ellipse(mac[0] + Math.cos(a) * dd, mac[1] + Math.sin(a) * dd * 0.8, 2.5 + L[2] * 4, 2 + L[3] * 3, a, 0, 7); g.fill(); }
      for (let i = 0; i < F.cws; i++) { const L = nxt(); const x = disc[0] - dx * (40 + L[0] * 110), y = disc[1] + (L[1] < 0.5 ? -1 : 1) * (40 + L[2] * 60); for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(245,240,230,0.35)'; g.beginPath(); g.arc(x + (k % 3) * 5 - 5, y + (k > 2 ? 4 : -2), 8 + L[3] * 4, 0, 7); g.fill(); } }
      for (let i = 0; i < F.drusen; i++) { const L = nxt(); g.fillStyle = 'rgba(240,210,110,0.85)'; g.beginPath(); g.arc(mac[0] + (L[0] - 0.5) * 120, mac[1] + (L[1] - 0.5) * 110, 2 + L[2] * 3.5, 0, 7); g.fill(); }
      for (let i = 0; i < F.roth; i++) { const L = nxt(); const x = cx + (L[0] - 0.5) * 260, y = cy + (L[1] - 0.5) * 220; g.fillStyle = 'rgba(150,12,10,0.9)'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.fillStyle = 'rgba(250,245,235,0.95)'; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
      // 백내장이 있으면 안저가 뿌옇게
      const cat = this.S[s].cataract || 0;
      if (cat) { g.fillStyle = `rgba(225,215,205,${0.75 * cat})`; g.fillRect(cx - R, cy - R, R * 2, R * 2); }
      // 비네팅
      gr = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, R); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = gr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
      g.restore();
      g.fillStyle = '#c9d0d4'; g.font = '600 15px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillText(s === 'R' ? '우안 OD' : '좌안 OS', cx, cy + R + 28);
    }
  };

  // ---------------------------------------------------------- 시야
  EyeEngine.prototype.drawField = function (g) {
    g.fillStyle = '#f3f1ec'; g.fillRect(-200, -200, W + 400, H + 400);
    const F = this.S.field || { R: 'normal', L: 'normal' }, fd = this.dyn.field;
    // 관례대로 환자 시점: 좌안 차트가 왼쪽
    const charts = [['L', 320], ['R', 880]];
    for (const [s, cx] of charts) {
      const cy = 300, R = 210, type = F[s] || 'normal';
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = '#ffffff'; g.fill(); g.clip();
      g.fillStyle = 'rgba(28,30,34,0.86)';
      const temporalRight = s === 'R';
      if (type === 'right_hemi' || type === 'right_hemi_ms') { g.fillRect(cx, cy - R, R, R * 2); if (type === 'right_hemi_ms') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 34, -Math.PI / 2, Math.PI / 2); g.fill(); } }
      else if (type === 'left_hemi' || type === 'left_hemi_ms') { g.fillRect(cx - R, cy - R, R, R * 2); if (type === 'left_hemi_ms') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 34, Math.PI / 2, Math.PI * 1.5); g.fill(); } }
      else if (type === 'temporal') { if (temporalRight) g.fillRect(cx, cy - R, R, R * 2); else g.fillRect(cx - R, cy - R, R, R * 2); }
      else if (type === 'inferior') { g.fillRect(cx - R, cy + 10, R * 2, R); }
      else if (type === 'central') { const gr = g.createRadialGradient(cx, cy, 10, cx, cy, 70); gr.addColorStop(0, 'rgba(28,30,34,0.9)'); gr.addColorStop(1, 'rgba(28,30,34,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 70, 0, 7); g.fill(); }
      else if (type === 'blur') { g.fillStyle = 'rgba(120,124,130,0.45)'; g.fillRect(cx - R, cy - R, R * 2, R * 2); }
      g.restore();
      g.strokeStyle = '#8b9196'; g.lineWidth = 1; for (const rr of [70, 140, 210]) { g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.stroke(); }
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      g.fillStyle = '#2a2f33'; g.font = '600 15px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillText(s === 'R' ? '우안 OD' : '좌안 OS', cx, cy + R + 30);
      g.font = '12px "IBM Plex Mono", monospace'; g.fillStyle = '#6b7176';
      g.fillText(s === 'R' ? '이측 →' : '← 이측', cx + (s === 'R' ? 160 : -160), cy - R + 10);
      // 대면검사 손가락 위치
      if (fd && fd.eye === s) {
        const q = fd.q, qx = cx + (q === 1 || q === 4 ? 1 : -1) * 105, qy = cy + (q === 1 || q === 2 ? -1 : 1) * 105;
        g.fillStyle = fd.seen ? '#2f7d5b' : '#b5402e'; g.beginPath(); g.arc(qx, qy, 15, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.font = '600 14px "IBM Plex Sans KR", sans-serif'; g.fillText(fd.seen ? '보임' : '안 보임', qx, qy + 38 > cy + R ? qy - 24 : qy + 38);
      }
    }
    g.fillStyle = '#4c5257'; g.font = '13px "IBM Plex Sans KR", sans-serif'; g.textAlign = 'center';
    g.fillText('검은 영역 = 시야 결손 (환자 시점 차트, 왼쪽이 좌안)', 600, 572);
  };

  // ---------------------------------------------------------- 실사 사진 모드 (ChatGPT 눈 근접 사진 + 엔진이 동공·깜빡임·빛 반사를 그림)
  // setPhoto({ src: 데이터 주소, marks: { R: [x, y, 홍채 반지름], L: [...] }(사진 px), mirror: 좌우 반전 }) / null = 코드 그림
  //   paint: true 면 정상 사진 흰자에 상태의 충혈·황달을 엔진이 칠함(소견 사진이 없는 외형·강도)
  // 시선 이동(펜 따라보기·안진·사시·마비)은 사진의 눈 둘레만 늘이고 줄여서(워프) 홍채를 옮김. 눈꺼풀 뒤집기·Dix-Hallpike 는 코드 그림
  const EIMG = {};
  EyeEngine.prototype.setPhoto = function (p) {
    this.photo = p || null; this.photoPrep = null;
    if (!p) return;
    let im = EIMG[p.src];
    if (!im) { im = EIMG[p.src] = new Image(); im.src = p.src; }
    const prep = () => { if (this.photo === p) this.photoPrep = preparePhoto(im, p, this.S, this.tex.ves); };
    if (im.complete && im.naturalWidth) prep(); else im.addEventListener('load', prep, { once: true });
  };
  EyeEngine.prototype.photoReady = function () { return !this.photo || !!this.photoPrep; };
  // 사진을 한 번 분석: 좌우 반전, 엔진 눈 자리에 맞추는 배율·위치, 눈마다 '보이는 홍채' 가리개와 홍채 색
  function preparePhoto(im, p, S, ves) {
    const w = im.naturalWidth, h = im.naturalHeight, src = makeCanvas(w, h), sg = src.getContext('2d');
    if (p.mirror) { sg.translate(w, 0); sg.scale(-1, 1); }
    sg.drawImage(im, 0, 0);
    const m = p.marks, f = (e) => p.mirror ? [w - e[0], e[1], e[2]] : e;
    const R = p.mirror ? f(m.L) : f(m.R), L = p.mirror ? f(m.R) : f(m.L);      // R = 사진 왼쪽 눈 = 환자 우안
    const k = (EYE.L.cx - EYE.R.cx) / (L[0] - R[0]);
    const ox = EYE.R.cx - R[0] * k, oy = (EYE.R.cy + EYE.L.cy) / 2 - (R[1] + L[1]) / 2 * k;
    const data = sg.getImageData(0, 0, w, h).data, lum = (x, y) => { const i = ((y | 0) * w + (x | 0)) * 4; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
    const eyes = {};
    // 눈꺼풀 자리(tools/eye_marks.py 가 사진에서 재거나 손으로 적은 값, r 단위). 좌우 반전이면 눈이 바뀌고 기울기(b)의 부호가 바뀜
    const ML = m.lids || {}, fl = (o) => o && p.mirror && o.U ? { U: [o.U[0], -o.U[1], o.U[2]], Lo: o.Lo } : o;
    const LD = { R: fl(p.mirror ? ML.L : ML.R), L: fl(p.mirror ? ML.R : ML.L) };
    for (const [s, e] of [['R', R], ['L', L]]) {
      const [cx, cy, r] = e, n = Math.ceil(r * 1.1), size = n * 2;
      // 흰자 밝기: 홍채 양옆(1.4r~1.9r)에서
      const sc = []; for (let dx = r * 1.4; dx < r * 1.9; dx += 2) for (const sx of [-1, 1]) sc.push(lum(cx + sx * dx, cy));
      sc.sort((a, b) => a - b); const sclera = sc[(sc.length * 0.7) | 0] || 200, thr = sclera * 0.72;
      const mask = makeCanvas(size, size), mg = mask.getContext('2d'), md = mg.createImageData(size, size);
      let cr = 0, cgr = 0, cb = 0, cn = 0, bot = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = cx - n + x, py = cy - n + y, dd = Math.hypot(px - cx, py - cy);
        if (px < 0 || py < 0 || px >= w || py >= h || dd > r * 1.02) continue;
        const i = ((py | 0) * w + (px | 0)) * 4, L0 = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (L0 < thr) {
          md.data[(y * size + x) * 4 + 3] = 255;
          if (Math.abs(px - cx) < r * 0.3) bot = Math.max(bot, py - cy);   // 보이는 홍채 아래 끝 = 아랫눈꺼풀 자리
          if (dd > r * 0.45 && dd < r * 0.85) { cr += data[i]; cgr += data[i + 1]; cb += data[i + 2]; cn++; }
        }
      }
      mg.putImageData(md, 0, 0);
      const soft = makeCanvas(size, size), so = soft.getContext('2d'); so.filter = 'blur(1px)'; so.drawImage(mask, 0, 0);
      // 아랫눈꺼풀 자리(가운데): 보이는 홍채 아래 끝. 홍채가 다 보이면(눈꺼풀이 안 덮음) 1.05r
      const lidL = (LD[s] && LD[s].Lo ? clamp(LD[s].Lo, 0.55, 1.05) : clamp(bot / r + 0.03, 0.55, 1.05)) * r;
      // 윗눈꺼풀 자리(열마다): 흰자에서 위로 올라가다 처음 어두운 속눈썹 선을 만나는 곳. 옆 시선 때 그 아래(눈알)만 옮기려고
      // 홍채 열(가운데 ±1.15r)은 아몬드 한계값 그대로(홍채가 어두워 못 잼, 여기 눈꺼풀 선은 거의 수평이라 옆으로 끌어도 티 안 남)
      // 못 찾으면 한계값(lidCap) → 틀려도 전보다 나빠지지 않음
      const nT = Math.ceil(r * 2.7), lidT = new Float32Array(nT * 2 + 1);
      const lidCap = (ax) => { const q = Math.sqrt(Math.max(0, 1 - (ax / (2.2 * r)) ** 2)); return 1.05 * r * q ** 1.5 + 0.05 * r; };
      for (let k = -nT; k <= nT; k++) {
        const x = cx + k, ax = Math.abs(k), cap = lidCap(ax);
        let v = cap;
        if (LD[s] && LD[s].U) {                   // marks 의 윗눈꺼풀 곡선이 있으면 그것(어린이·처진 눈꺼풀은 자동으로 못 재서 손으로 적음)
          const t = k / r, U = LD[s].U; v = clamp((U[0] * t * t + U[1] * t + U[2]) * r, 0.05 * r, cap);
        } else if (ax >= r * 1.15 && x >= 0 && x < w) {
          let y0 = cy, best = -1;
          for (let y = cy - r * 0.3; y <= cy + r * 0.3; y++) { const L0 = lum(x, y); if (L0 > best) { best = L0; y0 = y; } }
          if (best > sclera * 0.6) {               // 흰자가 보이는 열만 잼(눈꼬리 분홍 살·피부 열은 한계값)
            let y = y0; while (y > cy - cap && lum(x, y) > best * 0.62) y--;
            v = Math.min(cap, Math.max(cap * 0.8, cy - y));   // 속눈썹 그늘을 눈꺼풀로 잘못 잡아도 한계값의 80% 아래로는 안 내려감(홍채 윗부분 잘림 방지)
          }
        }
        lidT[k + nT] = v;
      }
      const bw = Math.max(1, Math.round(r * 0.15)), lidTs = new Float32Array(lidT.length);   // 들쭉날쭉한 열 값을 이동 평균
      for (let k = 0; k < lidT.length; k++) { let s2 = 0, c2 = 0; for (let q = Math.max(0, k - bw); q <= Math.min(lidT.length - 1, k + bw); q++) { s2 += lidT[q]; c2++; } lidTs[k] = s2 / c2; }
      // 실제 홍채 크기(가로): 가운데 줄에서 홍채와 흰자 밝기의 중간을 넘는 곳까지. marks 의 r 은 50px 로 막혀 있어 어린이 사진은 작게 나옴
      //   → 워프(홍채를 통째로 옮기는 범위·흰자 배경판에서 지우는 범위)는 rI 로. 동공 크기는 그대로 r 기준. 잘못 재도 r~1.2r
      let rI = r;
      { const im0 = []; for (let q = -0.4; q <= 0.4; q += 0.1) im0.push(lum(cx + q * r, cy)); im0.sort((a2, b2) => a2 - b2);
        const mid = (im0[(im0.length / 2) | 0] + sclera) / 2, wl2 = [];
        for (const dir of [-1, 1]) { let x = cx; while (Math.abs(x - cx) < 1.5 * r && (lum(x, cy - 1) + lum(x, cy) + lum(x, cy + 1)) / 3 < mid) x += dir; wl2.push(Math.abs(x - cx)); }
        rI = clamp((wl2[0] + wl2[1]) / 2, r, 1.2 * r); }
      // 아랫눈꺼풀 선(가운데 lidL, 눈꼬리 ±2.1r 에서 0 인 포물선, 조금 안쪽으로): 위아래 시선 때 이 아래(아랫눈꺼풀·눈 밑·볼)는 그대로
      const lowB = (x) => Math.max(0, lidL - 0.04 * r) * Math.max(0, 1 - ((x - cx) / (1.95 * r)) ** 2) ** 1.3;   // 눈꼬리 쪽으로 더 좁게(어긋나면 피부가 끌려 옴)
      // 흰자 배경판: 홍채를 지우고 그 줄의 왼쪽·오른쪽 흰자 색을 이어 칠한 판. 위를 볼 때 홍채 아래로 새로 드러나는 흰자를 메울 때 씀
      //   홍채 옆이 아랫눈꺼풀에 가린 줄은 가운데에 더 가까운 줄의 색을 이어 씀
      const pX0 = Math.max(0, Math.floor(cx - 2.7 * r)), pY0 = Math.max(0, Math.floor(cy - 1.2 * r));
      const pW = Math.min(w - 1, Math.ceil(cx + 2.7 * r)) - pX0, pH = Math.min(h - 1, Math.ceil(cy + 1.6 * r)) - pY0;
      const plate = new Float32Array(pW * pH * 3);
      for (let j = 0; j < pH; j++) for (let i = 0; i < pW; i++) { const q = ((pY0 + j) * w + pX0 + i) * 4, o = (j * pW + i) * 3; plate[o] = data[q]; plate[o + 1] = data[q + 1]; plate[o + 2] = data[q + 2]; }
      const avg3 = (x, y, dir) => { const v = [0, 0, 0]; for (let q = 0; q < 3; q++) { const i = ((y | 0) * w + ((x + dir * q * 2) | 0)) * 4; v[0] += data[i] / 3; v[1] += data[i + 1] / 3; v[2] += data[i + 2] / 3; } return v; };
      const RIp = 1.06 * rI;
      for (const dir of [-1, 1]) {
        let cl = null, cr2 = null;
        for (let yy = Math.round(cy); Math.abs(yy - cy) < RIp && yy >= pY0 && yy < pY0 + pH; yy += dir) {
          const hw = Math.sqrt(Math.max(0, RIp * RIp - (yy - cy) ** 2)), xl = cx - hw - 2, xr = cx + hw + 2;
          if (yy - cy < lowB(xl) - 1 || !cl) cl = avg3(xl, yy, -1);
          if (yy - cy < lowB(xr) - 1 || !cr2) cr2 = avg3(xr, yy, 1);
          for (let x = Math.ceil(xl); x <= xr; x++) {
            const i = x - pX0; if (i < 0 || i >= pW) continue;
            const u = (x - xl) / (xr - xl), o = ((yy - pY0) * pW + i) * 3;
            for (let ch = 0; ch < 3; ch++) plate[o + ch] = cl[ch] + (cr2[ch] - cl[ch]) * u;
          }
        }
      }
      eyes[s] = { cx, cy, r, rI, n, lidL, lowB, plate, pX0, pY0, pW, pH, lidT: lidTs, nT, mask: soft, iris: cn ? [cr / cn, cgr / cn, cb / cn] : [70, 45, 30], tmp: makeCanvas(size, size) };
    }
    if (p.paint) for (const s of ['R', 'L']) paintSclera(sg, data, w, eyes[s], S[s], ves[s], s);
    const px = p.paint ? sg.getImageData(0, 0, w, h).data : data;          // 워프할 때 읽는 원본 픽셀
    const cur = makeCanvas(w, h); cur.getContext('2d').drawImage(src, 0, 0);  // 워프한 눈을 써 넣는 사본(깜빡임도 여기서 가져옴)
    // 바깥(사진이 안 덮는 곳) 채울 색: 사진 가장자리 평균
    let er = 0, eg = 0, eb = 0, en = 0;
    for (let x = 0; x < w; x += 7) for (const y of [2, h - 3]) { const i = (y * w + x) * 4; er += data[i]; eg += data[i + 1]; eb += data[i + 2]; en++; }
    // 사진이 화면을 다 덮도록 눈 사이 가운데(600, 330)를 기준으로 조금 확대할 배율(펜라이트·눈금자도 같이 확대되어 위치가 맞음)
    const l = ox, r = ox + w * k, t = oy, b = oy + h * k;
    // 단, 너무 키우면 동공 눈금자·펜라이트가 화면 밖으로 나가므로 1.15배까지. 남는 가장자리는 부드럽게 녹여 피부색으로 이음
    const zp = Math.min(1.15, Math.max(1, 600 / (600 - l), 600 / (r - 600), 330 / (330 - t), 270 / (b - 330)) * 1.01);
    const soft = makeCanvas(w, h), sf = soft.getContext('2d'); sf.drawImage(src, 0, 0); sf.globalCompositeOperation = 'destination-in';
    const F = 0.08, gx = sf.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(F, '#000'); gx.addColorStop(1 - F, '#000'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    sf.fillStyle = gx; sf.fillRect(0, 0, w, h);
    const fy = makeCanvas(w, h), fg = fy.getContext('2d'), gy = fg.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(F * 1.6, '#000'); gy.addColorStop(1 - F * 1.6, '#000'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = gy; fg.fillRect(0, 0, w, h); sf.drawImage(fy, 0, 0);
    const avg = (y0) => { let a = 0, b2 = 0, c2 = 0, n2 = 0; for (let x = 0; x < w; x += 9) for (let y = y0; y < y0 + 12; y += 3) { const i = (y * w + x) * 4; a += data[i]; b2 += data[i + 1]; c2 += data[i + 2]; n2++; } return `rgb(${a / n2 | 0},${b2 / n2 | 0},${c2 / n2 | 0})`; };
    return { src, soft, cur, px, w, h, k, ox, oy, zp, top: avg(2), bottom: avg(h - 14), eyes, edge: `rgb(${er / en | 0},${eg / en | 0},${eb / en | 0})` };
  }
  // 정상 사진 흰자에 충혈·황달 칠하기(코드 그림과 같은 규칙). 흰자 = 홍채 밖의 밝고 채도 낮은 곳
  function paintSclera(sg, data, w, e, st, V, side) {
    const inj = st.injection || 0, ict = st.icterus || 0;
    if (inj < 0.02 && ict < 0.02) return;
    const { cx, cy, r } = e, s = r / RI, n = Math.ceil(r * 2.6), size = n * 2;
    // 흰자 기준 밝기: 홍채 바로 옆(1.1r~1.5r) 밝은 쪽
    const lum = (x, y) => { const i = ((y | 0) * w + (x | 0)) * 4; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
    const sc = []; for (let dx = r * 1.1; dx < r * 1.5; dx += 1) for (const sx of [-1, 1]) for (const dy of [-3, 0, 3]) sc.push(lum(cx + sx * dx, cy + dy));
    sc.sort((a, b) => a - b); const ref = sc[(sc.length * 0.8) | 0] || 200;
    const mask = makeCanvas(size, size), mg = mask.getContext('2d'), md = mg.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = cx - n + x, py = cy - n + y, ddx = px - cx, ddy = py - cy;
      if ((ddx / (r * 2.3)) ** 2 + (ddy / (r * 1.15)) ** 2 > 1 || Math.hypot(ddx, ddy) < r * 0.97) continue;
      const i = ((py | 0) * w + (px | 0)) * 4, R = data[i], G = data[i + 1], B = data[i + 2];
      const L = (R + G + B) / 3, sat = (Math.max(R, G, B) - Math.min(R, G, B)) / Math.max(1, Math.max(R, G, B));
      const a = clamp((L - ref * 0.7) / (ref * 0.15), 0, 1) * clamp((0.3 - sat) / 0.1, 0, 1) * clamp((B / Math.max(1, R) - 0.72) / 0.08, 0, 1);
      md.data[(y * size + x) * 4 + 3] = a * 255;
    }
    mg.putImageData(md, 0, 0);
    const soft = makeCanvas(size, size), so = soft.getContext('2d'); so.filter = 'blur(1.2px)'; so.drawImage(mask, 0, 0);
    // 칠할 색(곱하기): 흰자 전체 붉은 기·노란 기 + 혈관
    const t = makeCanvas(size, size), tg = t.getContext('2d');
    const dir = side === 'R' ? 1 : -1;      // 코 쪽 방향(사진 왼쪽 눈은 코가 오른쪽)
    if (ict) { const gr = tg.createRadialGradient(n, n, r * 1.05, n, n, r * 2.4); gr.addColorStop(0, `rgba(240,200,70,${0.35 * ict})`); gr.addColorStop(1, `rgba(220,170,40,${0.75 * ict})`); tg.fillStyle = gr; tg.fillRect(0, 0, size, size); }
    if (inj) {
      const col = st.violaceous ? [125, 40, 95] : [215, 85, 85], ty = st.inj || 'conj';
      const rgbA = (a) => `rgba(${col[0]},${col[1]},${col[2]},${a})`;
      let gr;
      if (ty === 'ciliary') { gr = tg.createRadialGradient(n, n, r, n, n, r * 1.85); gr.addColorStop(0, `rgba(160,35,70,${0.8 * inj})`); gr.addColorStop(1, 'rgba(160,35,70,0)'); }
      else if (ty === 'sector') { const sx = n - dir * r * 1.7; gr = tg.createRadialGradient(sx, n, 2, sx, n, r * 1.2); gr.addColorStop(0, rgbA(0.85 * inj)); gr.addColorStop(1, rgbA(0)); }
      // 사진 흰자는 홍채 옆 1~2r 로 좁음: 코드 그림보다 가까이에서 진해지게. 가와사키(bulbar)는 각막 둘레만 얇게 비움
      else { gr = tg.createRadialGradient(n, n, r * (ty === 'bulbar' ? 1.08 : 1.0), n, n, r * 2.1); gr.addColorStop(0, rgbA(ty === 'diffuse' || ty === 'plethora' ? 0.4 * inj : 0)); gr.addColorStop(0.25, rgbA(0.8 * inj)); gr.addColorStop(1, rgbA(0.95 * inj)); }
      tg.fillStyle = gr; tg.fillRect(0, 0, size, size);
      tg.lineCap = 'round';
      for (const v of V.list) {
        const q = v.pts[(v.pts.length / 2) | 0], dist = Math.hypot(q[0], q[1]);
        let wgt = 0.85;
        if (ty === 'conj') wgt = clamp((dist - RI) / (FW * 0.35), 0.15, 1);
        else if (ty === 'bulbar') wgt = dist < RI * 1.12 ? 0 : clamp((dist - RI * 1.12) / 30, 0, 1);
        else if (ty === 'ciliary') wgt = clamp(1.2 - (dist - RI) / 80, 0.15, 1);
        else if (ty === 'sector') wgt = (q[0] * -dir > RI * 0.6) ? 1 : 0.1;
        const a = clamp(inj * wgt * 0.6, 0, 0.6); if (a < 0.03) continue;
        tg.strokeStyle = (st.violaceous && v.deep) ? `rgba(110,30,90,${a})` : `rgba(170,30,40,${a})`; tg.lineWidth = Math.max(0.5, v.w * s * (0.7 + inj * 0.4));
        tg.beginPath(); v.pts.forEach((q2, i) => { const X = n + q2[0] * s * 1.05, Y = n + q2[1] * s * 0.95; i ? tg.lineTo(X, Y) : tg.moveTo(X, Y); }); tg.stroke();
      }
    }
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(soft, 0, 0);
    sg.save(); sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'multiply'; sg.drawImage(t, cx - n, cy - n); sg.restore();
  }
  // 눈 하나 워프: 홍채(반지름 r)를 (dx, dy)만큼 통째로 옮기고, 그 둘레 흰자는 늘이고 줄여 메움. 눈꼬리(±2.1r)·눈썹은 그대로
  // 옆 시선: 눈 뜬 틈(아몬드 모양)만 움직임 — 실제처럼 눈꺼풀·쌍꺼풀 선은 제자리(전에는 띠째 옮겨 쌍꺼풀이 구겨졌음)
  // 위아래 시선: 윗눈꺼풀은 따라가고(실제 눈과 같음), 아랫눈꺼풀·눈 밑·볼은 그대로(아랫눈꺼풀 선 lowB 아래는 안 움직임).
  //   아래를 보면 홍채가 아랫눈꺼풀 뒤로 들어가고, 위를 보면 홍채 아래로 새로 드러나는 흰자는 흰자 배경판에서,
  //   가려 있던 홍채 아랫부분은 같은 반지름의 보이는 무늬로 메움. 옆으로는 넓고 부드럽게 줄어 눈꼬리 쪽이 안 꺾임
  // f: 옆을 볼 때 홍채가 좁아 보이는 정도
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function warpEye(P, e, dx, dy, f) {
    const key = dx.toFixed(1) + ',' + dy.toFixed(1) + ',' + f.toFixed(3);
    if (e.wkey === key) return; e.wkey = key;
    const { cx, cy, r, rI, lidL, lowB, lidT, nT } = e, w = P.w, h = P.h, src = P.px;
    const x0 = Math.max(0, Math.floor(cx - 2.7 * r)), x1 = Math.min(w - 1, Math.ceil(cx + 2.7 * r));
    const y0 = Math.max(0, Math.floor(cy - 2.6 * r)), y1 = Math.min(h - 1, Math.ceil(cy + 2.3 * r));
    const rw = x1 - x0, rh = y1 - y0;
    if (!e.wimg || e.wimg.width !== rw || e.wimg.height !== rh) e.wimg = new ImageData(rw, rh);
    const out = e.wimg.data;
    const xa = cx - 2.1 * r, xb = cx + 2.1 * r;
    const ix0 = cx + dx - rI * f, ix1 = cx + dx + rI * f;
    const pw = (x, a, b, A, B) => A + (x - a) * (B - A) / (b - a);
    const HX = new Float32Array(rw), HW = new Float32Array(rw), HU = new Float32Array(rw), HF = new Float32Array(rw), HL = new Float32Array(rw);
    for (let i = 0; i < rw; i++) {
      const x = x0 + i;
      HX[i] = x <= xa || x >= xb ? x : x < ix0 ? pw(x, xa, ix0, xa, cx - rI) : x <= ix1 ? pw(x, ix0, ix1, cx - rI, cx + rI) : pw(x, ix1, xb, cx + rI, xb);
      HW[i] = 1 - smooth(0.9 * r, 2.0 * r, Math.abs(x - cx));       // 위아래 이동: 눈 가운데서 눈꼬리 쪽으로 줄어듦(눈꼬리는 경계가 덜 정확해 피부가 끌려 옴)
      // 눈 뜬 틈의 위·아래 반높이: 위는 사진에서 잰 윗눈꺼풀 선(lidT, 경계 0.2r), 아래는 사진에서 잰 아랫눈꺼풀 자리(lidL, +0.05r). 눈꼬리(±2.2r)로 갈수록 0
      const q = Math.sqrt(Math.max(0, 1 - ((x - cx) / (2.2 * r)) ** 2));
      const k = Math.round(x - cx) + nT; HU[i] = k >= 0 && k < lidT.length ? lidT[k] : 0.05 * r; HF[i] = 0.2 * r; HL[i] = lidL * q + 0.05 * r;
    }
    // 위아래 이동량(원본 사진 높이 t = y - cy 에서 얼마나 옮기나): 윗눈꺼풀은 눈알을 따라감(쌍꺼풀 위 2.3r 부터 서서히), 그 아래 눈알 = dy
    // 아랫눈꺼풀 선(lowB) 아래는 0 → 아래 반복문에서 wl 로 처리
    const F = (t) => t < -r ? dy * smooth(-2.3 * r, -r, t) : dy;
    const mg = 0.08 * r, mf = 0.1 * r, RI2 = (1.06 * rI) ** 2;
    const HB = new Float32Array(rw); for (let i = 0; i < rw; i++) HB[i] = lowB(x0 + i);
    const samp = (arr, W2, x, y, o, st) => {     // 양선형 보간으로 한 점 읽기(st = 한 픽셀 칸 수: 사진 4, 배경판 3)
      const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, p0 = (yi * W2 + xi) * st, p1 = p0 + W2 * st;
      for (let ch = 0; ch < 3; ch++) { const a = arr[p0 + ch] + (arr[p0 + st + ch] - arr[p0 + ch]) * fx, b = arr[p1 + ch] + (arr[p1 + st + ch] - arr[p1 + ch]) * fx; out[o + ch] = a + (b - a) * fy; }
    };
    for (let j = 0; j < rh; j++) {
      const y = y0 + j;
      for (let i = 0; i < rw; i++) {
        const x = x0 + i;
        // 좌우 이동은 아몬드 안에서만(눈꺼풀과 같이 올라간 눈 중심 기준). 아래쪽은 경계 0.2r 로 좁게 → 아랫눈꺼풀·눈 밑 피부가 옆으로 안 끌림
        // 위쪽은 윗눈꺼풀 선(속눈썹) 아래만: 비스듬한 쌍꺼풀 선을 옆으로 끌면 계단처럼 꺾이므로. 홍채 위는 넉넉히(그늘진 홍채 윗부분까지 같이 옮겨야 자국이 안 남음)
        const ty = y - cy - dy * HW[i], tyL = y - cy;
        // 아래쪽 경계는 아랫눈꺼풀이 안 움직이므로 원래 자리(tyL) 기준
        const aw = ty < 0 ? 1 - smooth(HU[i], HU[i] + HF[i], -ty) : 1 - smooth(HL[i], HL[i] + 0.2 * r, tyL);
        // 아랫눈꺼풀 선 아래(아랫눈꺼풀·눈 밑·볼)는 위아래로 안 움직임(경계 2.4px 에서 부드럽게)
        const wl = clamp((HB[i] + 1.2 - tyL) / 2.4, 0, 1);
        // 화면 y 가 원본 어디서 왔나: y = s + HW·F(s - cy) 를 몇 번 되풀이해 풂
        let sy = y;
        if (dy && wl > 0) { for (let q = 0; q < 4; q++) sy = y - HW[i] * F(sy - cy); sy = y + wl * (sy - y); }
        const sx = clamp(x + aw * (HX[i] - x), 0, w - 1.001);
        sy = clamp(sy, 0, h - 1.001);
        const o = (j * rw + i) * 4;
        out[o + 3] = 255;
        // 드러나는 곳 판정은 화면 열(x)의 아랫눈꺼풀 선 기준(아랫눈꺼풀은 화면에서 제자리). 옆으로 옮겨 온 원본 열(sx)로 재면
        //   홍채 뒤쪽(늘어나는 쪽)은 눈꼬리 쪽 낮은 선을 써서 넓은 쐐기가 칠해졌음. 위아래로 실제로 옮긴 픽셀만(눈 밖 1px 줄 방지)
        const bs = cy + lowB(x) - mg;
        if (dy < 0 && wl > 0 && sy - y > 0.3 && sy > bs && sy > cy) {
          // 위를 볼 때 원래 아랫눈꺼풀 뒤였던 곳이 드러남
          if ((sx - cx) ** 2 + (sy - cy) ** 2 < RI2) {            // 홍채 아랫부분: 같은 반지름에서 각도를 수평 쪽으로 돌려 보이는 곳 무늬(홍채 결은 방사상)
            const u = sx - cx, v = sy - cy, rho = Math.min(Math.hypot(u, v), 1.02 * rI), th0 = Math.atan2(v, u);
            const tgt = Math.abs(th0) < Math.PI / 2 ? 0 : Math.PI, stp = (tgt - th0) / 16;
            let qx = sx, qy = sy, ok = false;
            for (let q = 1; q <= 16; q++) { const th = th0 + stp * q; qx = cx + Math.cos(th) * rho; qy = cy + Math.sin(th) * rho; if (qy < cy + lowB(qx) - mg) { ok = true; break; } }
            if (ok) { samp(src, w, clamp(qx, 0, w - 1.001), clamp(qy, 0, h - 1.001), o, 4); continue; }
          }
          // 흰자: 그 열의 아랫눈꺼풀 선 조금 위 흰자 색을 아래로 이어 씀(흰자 배경판 = 홍채를 지운 판). 무늬를 접어 오면 네모 얼룩이 생겨서
          const { plate, pX0, pY0, pW, pH } = e;
          const ry = Math.max(cy, cy + Math.min(lowB(x), lowB(sx)) - mg - mf);   // 원본 열(sx)에서도 아랫눈꺼풀 위(흰자)인 줄
          samp(plate, pW, clamp(sx - pX0, 0, pW - 1.001), clamp(ry - pY0, 0, pH - 1.001), o, 3);
          continue;
        }
        samp(src, w, sx, sy, o, 4);
      }
    }
    P.cur.getContext('2d').putImageData(e.wimg, x0, y0);
    e.wr = [x0, y0, rw, rh];
  }
  // 지금 사진으로 그려도 되는지: 눈 진찰 화면이면 모두. 시선 이동은 워프, 아래 눈꺼풀 당기기는 drawPhotoEvert, 회선성 안진(Dix-Hallpike)은 홍채 돌리기
  EyeEngine.prototype.usePhoto = function () {
    const d = this.dyn; return !!this.photoPrep && d.mode === 'eyes';
  };
  // 사진에서 아래 눈꺼풀 당기기: 아랫눈꺼풀 선(lowB) 아래 피부를 아래로 끌어내리고(볼 쪽은 제자리라 눌려 모임),
  // 벌어진 틈에 아래 흰자 → 원개부 그늘 → 검결막(정상 붉음 / 빈혈 창백 / 충혈 더 붉음, 혈관결·점상출혈) → 눈꺼풀 가장자리·속눈썹을 칠함
  // 색 규칙은 코드 그림(drawEye 의 검결막 띠)과 같음
  EyeEngine.prototype.drawPhotoEvert = function (g) {
    const P = this.photoPrep, d = this.dyn, k = P.k;
    for (const s of ['R', 'L']) {
      const e = P.eyes[s], S = this.S[s], r = e.r, Dm = d.evert * 0.85 * r, RW = 1.95 * r;
      const prof = (x) => Math.max(0, 1 - ((x - e.cx) / (1.7 * r)) ** 2) ** 1.7;     // 눈꼬리 쪽은 빨리 줄어 틈이 눈 밖으로 안 뻗음
      const top = (x) => e.cy + e.lowB(x), D = (x) => Dm * prof(x), H2 = 2.6 * r, st = 1.5;
      const X = (x) => P.ox + x * k, Y = (y) => P.oy + y * k;
      // 1) 아랫눈꺼풀·눈 밑 피부를 열마다 아래로 (아래 끝 top+H2 는 제자리)
      for (let x = e.cx - RW; x < e.cx + RW; x += st) {
        const yl = top(x), dd = D(x); if (dd < 0.3) continue;
        g.drawImage(P.cur, x, yl, st, H2, X(x), Y(yl + dd), st * k + 0.5, (H2 - dd) * k);
      }
      // 2) 벌어진 틈: 세로 색 띠(위 = 사진 흰자 색 → 원개부 그늘 → 검결막 → 가장자리)를 열마다 그 열의 틈 높이로 늘여 붙임
      let pc = mix([206, 72, 80], [236, 205, 196], S.pallor || 0);
      pc = mix(pc, [190, 38, 48], (S.injection || 0) * 0.45);
      pc = mix(pc, [214, 128, 122], 0.22);                    // 사진 위에서는 코드 그림보다 조금 차분하게(실제 점막 색)
      const px = P.px, sam = [];     // 사진 속 흰자 색: 홍채 옆에서 가장 밝은 곳들(눈꺼풀 그늘을 피함)
      for (const sx of [-1.45, -1.3, -1.15, 1.15, 1.3, 1.45]) for (const sy of [-0.1, 0, 0.1]) { const i = ((Math.round(e.cy + sy * r) * P.w + Math.round(e.cx + sx * r)) * 4); sam.push([px[i], px[i + 1], px[i + 2]]); }
      sam.sort((c1, c2) => (c2[0] + c2[1] + c2[2]) - (c1[0] + c1[1] + c1[2]));
      const scl = sam.slice(0, 4).reduce((q, c) => [q[0] + c[0] / 4, q[1] + c[1] / 4, q[2] + c[2] / 4], [0, 0, 0]);
      const key = pc.map(Math.round).join() + '|' + scl.map(Math.round).join();
      if (e.evKey !== key) {
        e.evKey = key; e.evStrip = e.evStrip || document.createElement('canvas'); e.evStrip.width = 1; e.evStrip.height = 128;
        const sg = e.evStrip.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 128);
        gr.addColorStop(0, rgb(scl)); gr.addColorStop(0.14, rgb(mix(scl, pc, 0.35))); gr.addColorStop(0.3, rgb(mix(pc, [110, 28, 38], 0.4)));
        gr.addColorStop(0.48, rgb(pc)); gr.addColorStop(0.86, rgb(mix(pc, [235, 160, 150], 0.2))); gr.addColorStop(1, rgb(mix(pc, [190, 130, 112], 0.45)));
        sg.fillStyle = gr; sg.fillRect(0, 0, 1, 128);
      }
      for (let x = e.cx - RW; x < e.cx + RW; x += st) { const dd = D(x); if (dd < 0.3) continue; g.drawImage(e.evStrip, X(x), Y(top(x)) - 0.5, st * k + 0.5, dd * k + 1); }
      // 젖은 점막 광택
      g.save(); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(1, 0.07 * r * k); g.lineCap = 'round'; g.beginPath();
      for (let x = e.cx - RW * 0.6; x <= e.cx + RW * 0.6; x += 2) g.lineTo(X(x - 0.1 * r), Y(top(x) + D(x) * 0.62)); g.stroke(); g.restore();
      // 혈관결(세로로 가늘게)·점상출혈 — 틈 안에서 그 열의 높이 비율로
      const rr = rng(s === 'R' ? 77 : 88);
      g.strokeStyle = rgb(mix(pc, [150, 30, 40], 0.45), 0.4); g.lineWidth = 0.7;
      for (let i = 0; i < 34; i++) {
        const x = e.cx + (rr() * 2 - 1) * RW * 0.75, a = top(x) + D(x) * (0.4 + rr() * 0.1), b = top(x) + D(x) * (0.82 + rr() * 0.1);
        g.beginPath(); g.moveTo(X(x), Y(a)); g.quadraticCurveTo(X(x + (rr() - 0.5) * r * 0.25), Y((a + b) / 2), X(x + (rr() - 0.5) * r * 0.2), Y(b)); g.stroke();
      }
      if (S.petechiae) {
        g.fillStyle = 'rgba(150,10,20,0.9)';
        for (let i = 0; i < 18 * S.petechiae; i++) { const x = e.cx + (rr() * 2 - 1) * RW * 0.7, y = top(x) + D(x) * (0.45 + rr() * 0.45); g.beginPath(); g.arc(X(x), Y(y), (0.035 + rr() * 0.035) * r * k, 0, 7); g.fill(); }
      }
      // 3) 눈꺼풀 가장자리(살짝 어두운 테)와 아래 속눈썹
      g.save(); g.lineCap = 'round';
      g.strokeStyle = 'rgba(150,80,70,0.35)'; g.lineWidth = Math.max(1, 0.05 * r * k);
      g.beginPath(); for (let x = e.cx - RW; x <= e.cx + RW; x += 2) g.lineTo(X(x), Y(top(x) + D(x))); g.stroke();
      g.strokeStyle = 'rgba(40,28,22,0.45)'; g.lineWidth = Math.max(0.7, 0.022 * r * k);
      for (let x = e.cx - RW * 0.8; x <= e.cx + RW * 0.8; x += r * 0.13) {
        const y = top(x) + D(x), lx = (rr() - 0.5) * 0.08 * r + (x - e.cx) * 0.05;
        g.beginPath(); g.moveTo(X(x), Y(y + 0.04 * r)); g.lineTo(X(x + lx), Y(y + (0.18 + rr() * 0.1) * r * prof(x))); g.stroke();
      }
      g.restore();
    }
  };
  EyeEngine.prototype.drawPhotoEyes = function (g) {
    const P = this.photoPrep, d = this.dyn, k = P.k;
    const bg = g.createLinearGradient(0, P.oy, 0, P.oy + P.h * k); bg.addColorStop(0, P.top); bg.addColorStop(1, P.bottom);
    g.fillStyle = bg; g.fillRect(-200, -200, W + 400, H + 400);
    g.drawImage(P.soft, P.ox, P.oy, P.w * k, P.h * k);      // 가장자리가 녹은 사진(render() 가 zp 만큼 확대)
    const off = {};
    for (const s of ['R', 'L']) {                            // 시선: 홍채 이동량(사진 px). 좌우 ±0.85r, 위 0.22r·아래 0.4r 까지
      const e = P.eyes[s], gz = this.eyeGaze(s);
      // 위로는 0.22r 까지만: 아랫눈꺼풀이 안 따라가서 홍채 아래로 원래 가려 있던 곳이 드러나는데, 그 부분은 사진에 없어 메워야 하므로 작게
      // 아래로는 0.4r(홍채가 아랫눈꺼풀 뒤로 들어가고 윗눈꺼풀이 따라옴 — 메울 곳 없음)
      const dx = clamp(gz.x * 0.8, -0.85, 0.85) * e.r, dy = (gz.y < 0 ? clamp(gz.y * 0.25, -0.22, 0) : clamp(gz.y * 0.4, 0, 0.4)) * e.r, f = 1 - 0.12 * Math.min(1, Math.abs(gz.x));
      if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15 || e.wkey) {
        warpEye(P, e, dx, dy, f);
        if (Math.abs(dx) <= 0.15 && Math.abs(dy) <= 0.15) e.wkey = null;   // 정면으로 돌아옴(원본과 같음): 다음부터 워프 안 함
      }
      if (e.wr) { const [x0, y0, rw, rh] = e.wr; g.drawImage(P.cur, x0, y0, rw, rh, P.ox + x0 * k, P.oy + y0 * k, rw * k, rh * k); }
      off[s] = [dx, dy, f];
      const tor = gz.tor || 0;
      if (Math.abs(tor) > 0.2) {     // 회선성 안진(Dix-Hallpike): 보이는 홍채를 중심으로 돌림 + 옅은 방사형 결(짙은 홍채에서도 돌아가는 게 보이게). 눈꺼풀 안쪽만
        const cx = e.cx + dx, cy = e.cy + dy, R = e.rI * 1.02, SX = P.ox + cx * k, SY = P.oy + cy * k;
        g.save(); g.beginPath();
        for (let q = -1.2; q <= 1.21; q += 0.1) { const xq = cx + q * R, kk = clamp(Math.round(xq - e.cx) + e.nT, 0, e.lidT.length - 1); g.lineTo(P.ox + xq * k, P.oy + (e.cy - e.lidT[kk]) * k); }
        for (let q = 1.2; q >= -1.21; q -= 0.1) { const xq = cx + q * R; g.lineTo(P.ox + xq * k, P.oy + (e.cy + e.lowB(xq)) * k); }
        g.closePath(); g.clip();
        g.beginPath(); g.arc(SX, SY, R * k, 0, 7); g.clip();
        g.translate(SX, SY); g.rotate(tor * Math.PI / 180);
        g.drawImage(P.cur, cx - R, cy - R, 2 * R, 2 * R, -R * k, -R * k, 2 * R * k, 2 * R * k);
        const c = e.iris, rr = rng(s === 'R' ? 31 : 47);
        g.lineWidth = Math.max(0.6, 0.03 * e.r * k);
        for (let a = 0; a < 6.28; a += 0.26) {
          const a2 = a + (rr() - 0.5) * 0.12, r0 = e.r * 0.42 * k, r1 = e.r * (0.82 + rr() * 0.12) * k;
          g.strokeStyle = rr() < 0.5 ? `rgba(${Math.min(255, c[0] * 1.9) | 0},${Math.min(255, c[1] * 1.8) | 0},${Math.min(255, c[2] * 1.6) | 0},0.28)` : 'rgba(10,6,4,0.3)';
          g.beginPath(); g.moveTo(Math.cos(a2) * r0, Math.sin(a2) * r0); g.lineTo(Math.cos(a2 + 0.06) * r1, Math.sin(a2 + 0.06) * r1); g.stroke();
        }
        g.restore();
      }
    }
    for (const s of ['R', 'L']) {
      const e = P.eyes[s], [odx, ody, of] = off[s], X = P.ox + (e.cx + odx) * k, Y = P.oy + (e.cy + ody) * k, S = this.S[s];
      // 동공: 사진 속 '보이는 홍채'에만(눈꺼풀이 덮은 곳은 안 그림). 홍채 지름 11.5mm 기준으로 mm → px
      const pxmm = e.r / 5.75, rp = clamp(d.pupil[s] / 2 * pxmm, 0.6 * pxmm, e.r * 0.82), base = e.r * 0.34;
      const t = e.tmp, tg = t.getContext('2d'), n = e.n;
      tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, t.width, t.height);
      if (rp < base) {          // 사진의 원래 동공보다 작아지면 그 사이를 홍채 색으로 메움
        const c = e.iris, gr = tg.createRadialGradient(n, n, rp, n, n, base * 1.15);
        gr.addColorStop(0, `rgb(${c[0] * 0.8 | 0},${c[1] * 0.75 | 0},${c[2] * 0.7 | 0})`); gr.addColorStop(0.7, `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`); gr.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
        tg.fillStyle = gr; tg.beginPath(); tg.arc(n, n, base * 1.15, 0, 7); tg.fill();
        tg.strokeStyle = `rgba(${c[0] * 1.3 | 0},${c[1] * 1.2 | 0},${c[2] | 0},0.25)`; tg.lineWidth = 0.6;   // 홍채 결
        for (let a = 0; a < 6.28; a += 0.21) { tg.beginPath(); tg.moveTo(n + Math.cos(a) * rp, n + Math.sin(a) * rp); tg.lineTo(n + Math.cos(a + 0.05) * base * 1.1, n + Math.sin(a + 0.05) * base * 1.1); tg.stroke(); }
      }
      const cat = S.cataract || 0, pc = cat > 0.3 ? [205, 200, 190] : [8, 6, 5];
      const pg = tg.createRadialGradient(n, n, rp * 0.75, n, n, rp * 1.08);
      pg.addColorStop(0, `rgb(${pc[0]},${pc[1]},${pc[2]})`); pg.addColorStop(1, `rgba(${pc[0]},${pc[1]},${pc[2]},0)`);
      tg.fillStyle = pg; tg.beginPath(); tg.arc(n, n, rp * 1.08, 0, 7); tg.fill();
      // 각막 반사: 펜라이트를 비추면 밝은 점, 평소엔 작은 창문 반사
      const lit = (d.light === s || d.light === 'both') ? d.lightPos : 0;
      tg.fillStyle = `rgba(255,255,255,${0.55 + lit * 0.45})`;
      tg.beginPath(); tg.ellipse(n - e.r * 0.22, n - e.r * 0.28, e.r * (0.07 + lit * 0.06), e.r * (0.055 + lit * 0.05), -0.4, 0, 7); tg.fill();
      tg.globalCompositeOperation = 'destination-in'; tg.drawImage(e.mask, 0, 0);
      g.save(); g.beginPath();                    // 아래를 볼 때 홍채가 아랫눈꺼풀 뒤로 들어가면 동공·반사도 가려지게(아랫눈꺼풀 선 위만)
      for (let q = -2.6; q <= 2.61; q += 0.1) { const xq = e.cx + q * e.r; g.lineTo(P.ox + xq * k, P.oy + (e.cy + e.lowB(xq)) * k); }
      g.lineTo(P.ox + (e.cx + 2.6 * e.r) * k, P.oy + (e.cy - 3 * e.r) * k); g.lineTo(P.ox + (e.cx - 2.6 * e.r) * k, P.oy + (e.cy - 3 * e.r) * k); g.closePath(); g.clip();
      g.drawImage(t, X - n * k * of, Y - n * k, t.width * k * of, t.height * k);   // 홍채와 함께 옮기고, 옆을 보면 좁게
      g.restore();
      // 깜빡임·눈부심 찡그림: 윗눈꺼풀 피부를 아래로 늘여 덮음(피부 진찰실과 같은 방법)
      const bl = d.blink > 0 ? Math.sin(d.blink * Math.PI) : 0;
      let c = 1 - (1 - bl * 0.97) * (1 - 0.5 * d.squint[s]);
      if (this.S.glob.conscious === 'coma') c = Math.max(c, 0.95);
      if (d.holdLids) c = Math.min(c, 0.08);
      if (c > 0.01) {
        const X = P.ox + e.cx * k;          // 눈꺼풀은 옆으로는 안 움직임(위아래 시선만 따라감)
        const RX = e.r * 2.4 * k, RY = e.r * 1.1 * k, step = 0.8, edge = [];
        for (let x = X - RX; x <= X + RX; x += step) {
          const q = Math.sqrt(Math.max(0, 1 - ((x - X) / RX) ** 2)), yu = Y - RY * q, yl = Y + RY * 0.85 * q, ym = yu + (yl - yu) * c;
          const Hs = RY * 1.7 * q;          // 늘이는 높이도 눈 끝으로 갈수록 0 → 이음매가 안 보임
          edge.push([x, ym]); if (ym - yu < 0.2 || Hs < 0.5) continue;
          g.drawImage(P.cur, (x - P.ox) / k, (yu - Hs - P.oy) / k, step / k, Hs / k, x, yu - Hs, step + 0.4, Hs + (ym - yu));
        }
        g.save(); g.strokeStyle = `rgba(30,20,16,${0.7 * Math.min(1, c * 2.5)})`; g.lineWidth = Math.max(1.5, RY * 0.08); g.lineCap = 'round';
        g.beginPath(); edge.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.restore();
      }
    }
    if (d.evert > 0.02) this.drawPhotoEvert(g);
  };

  // ---------------------------------------------------------- 프레임 렌더
  EyeEngine.prototype.render = function () {
    const g = this.g, d = this.dyn, z = d.zoom;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height);
    g.setTransform(this.dpr * z.s, 0, 0, this.dpr * z.s, this.dpr * (600 - z.x * z.s), this.dpr * (330 - z.y * z.s));
    if (d.mode === 'fundus') this.drawFundus(g);
    else if (d.mode === 'field') this.drawField(g);
    else {
      this._photoOn = this.usePhoto();
      if (this._photoOn) { const zp = this.photoPrep.zp; g.translate(600, 330); g.scale(zp, zp); g.translate(-600, -330); this.drawPhotoEyes(g); }
      else { this.drawSkin(g); this.drawEye(g, 'R'); this.drawEye(g, 'L'); }
      // 방 조명
      const dark = (1 - d.room) * 0.66;
      if (dark > 0.01) { g.fillStyle = `rgba(6,8,12,${dark})`; g.fillRect(-200, -200, W + 400, H + 400); }
      this.drawPenlight(g);
      this.drawTarget(g);
      this.drawGauge(g);
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (d.modeFade < 1) { g.fillStyle = `rgba(10,12,14,${1 - d.modeFade})`; g.fillRect(0, 0, W, H); }
    if (d.mode === 'eyes' && this._photoOn) { g.font = '12px sans-serif'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText('AI 생성 이미지', 14, H - 12); }
    if (d.hud) {
      g.font = '600 15px "IBM Plex Sans KR", sans-serif';
      const w = g.measureText(d.hud).width + 28;
      g.fillStyle = 'rgba(12,16,18,0.78)'; g.beginPath(); g.roundRect ? g.roundRect(18, 18, w, 34, 8) : g.rect(18, 18, w, 34); g.fill();
      g.fillStyle = '#eef3f1'; g.textAlign = 'left'; g.fillText(d.hud, 32, 41);
    }
  };

  EyeEngine.prototype.diplopia = function () {
    const a = this.eyeGaze('R'), b = this.eyeGaze('L');
    return Math.abs(a.x - b.x) > 0.14 || Math.abs(a.y - b.y) > 0.12;
  };

  // ---------------------------------------------------------- 변형: 강도 조절 · 좌우 반전
  // k = 0.5(경증) / 1(중등, 프리셋 그대로) / 1.35(중증). 정상값에서 벗어난 만큼만 늘리거나 줄인다.
  const ZERO_KEYS = ['icterus', 'injection', 'pallor', 'petechiae', 'discharge', 'tearing', 'haze', 'infiltrate', 'hypopyon', 'cataract', 'limbalIschemia', 'arcus', 'ptosis', 'retraction', 'lidEdema', 'lidRed', 'bleph', 'xanth', 'proptosis', 'photophobia'];
  const ONE_KEYS = ['react', 'afferent'];
  const FUNDUS_FRAC = ['papilledema', 'rd', 'crvo', 'avnick', 'venous', 'pallorDisc'];
  const FUNDUS_COUNT = ['flame', 'dotblot', 'microan', 'exudates', 'cws', 'drusen', 'roth'];
  EyeEngine.scaleState = function (st, k) {
    st = JSON.parse(JSON.stringify(st));
    for (const s of ['R', 'L']) {
      const e = st[s]; if (!e) continue;
      for (const key of ZERO_KEYS) if (typeof e[key] === 'number') e[key] = clamp(e[key] * k, 0, 1);
      for (const key of ONE_KEYS) if (typeof e[key] === 'number') e[key] = clamp(1 - (1 - e[key]) * k, 0, 1);
      if (typeof e.pupil === 'number') e.pupil = clamp(3.5 + (e.pupil - 3.5) * k, 1, 8.5);
      if (e.lim) for (const d in e.lim) e.lim[d] = clamp(1 - (1 - e.lim[d]) * k, 0.02, 1);
      if (e.dev) e.dev = [e.dev[0] * k, e.dev[1] * k];
    }
    for (const f of ['fundusR', 'fundusL']) {
      const F = st[f]; if (!F) continue;
      for (const key of FUNDUS_FRAC) if (typeof F[key] === 'number') F[key] = clamp(F[key] * k, 0, 1);
      for (const key of FUNDUS_COUNT) if (typeof F[key] === 'number') F[key] = Math.round(F[key] * k);
    }
    const G = st.glob || {};
    if (G.conjGaze) G.conjGaze = clamp(G.conjGaze * k, -0.9, 0.9);
    if (G.nys) { if (G.nys.rest) G.nys.rest.amp = (G.nys.rest.amp || 0.04) * k; if (G.nys.gaze) G.nys.gaze *= k; }
    return st;
  };
  EyeEngine.isUnilateral = function (st) {
    const G = st.glob || {}, n = G.nys || {};
    return JSON.stringify(st.R) !== JSON.stringify(st.L) || JSON.stringify(st.fundusR) !== JSON.stringify(st.fundusL) ||
      (st.field && st.field.R !== st.field.L) || !!G.conjGaze || !!(n.rest && n.rest.type === 'h') || !!n.dix ||
      (st.field && /right|left/.test(st.field.R + st.field.L));
  };
  const FLIP_FIELD = { right_hemi: 'left_hemi', left_hemi: 'right_hemi', right_hemi_ms: 'left_hemi_ms', left_hemi_ms: 'right_hemi_ms' };
  EyeEngine.mirrorState = function (st) {
    st = JSON.parse(JSON.stringify(st));
    const R = st.R; st.R = st.L; st.L = R;
    for (const s of ['R', 'L']) if (st[s] && st[s].dev) st[s].dev = [-st[s].dev[0], st[s].dev[1]];
    const fr = st.fundusR; st.fundusR = st.fundusL; st.fundusL = fr;
    if (st.field) { const a = st.field.R, b = st.field.L; st.field = { R: FLIP_FIELD[b] || b, L: FLIP_FIELD[a] || a }; }
    const G = st.glob || {};
    if (G.conjGaze) { G.conjGaze = -G.conjGaze; G.conjLimit = G.conjLimit === 'right' ? 'left' : G.conjLimit === 'left' ? 'right' : G.conjLimit; }
    if (G.nys) {
      if (G.nys.rest && G.nys.rest.type === 'h') G.nys.rest.dir = G.nys.rest.dir === 'L' ? 'R' : 'L';
      if (G.nys.dix) G.nys.dix.side = G.nys.dix.side === 'R' ? 'L' : 'R';
    }
    return st;
  };
  EyeEngine.mirrorText = function (t) {
    return String(t || '').replace(/우안|좌안|우측|좌측|오른쪽|왼쪽|OD|OS/g, m => ({ '우안': '좌안', '좌안': '우안', '우측': '좌측', '좌측': '우측', '오른쪽': '왼쪽', '왼쪽': '오른쪽', 'OD': 'OS', 'OS': 'OD' }[m]));
  };

  EyeEngine.W = W; EyeEngine.H = H;
  global.EyeEngine = EyeEngine;
})(window);
