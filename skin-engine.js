/* =====================================================================
   CPX 가상환자 피부 엔진 (SkinEngine)
   - 눈 엔진과 같은 방식: 같은 환자의 피부를 코드로 그리고, 소견 파라미터(0~1)만 바꿔 정상/이상을 만든다.
   - 부위(view): face 얼굴·입술 / hands 손등·손바닥·손끝 / trunk 앞가슴·배 / pinch 피부 긴장도(꼬집기)
   - 파라미터: jaundice 황달, pallor 창백, cyanosis 청색증, flush 홍조, bronze 과색소침착,
     sweat 땀, turgor 긴장도 저하, cold 차가움, spider 거미혈관종, palmar 손바닥 홍반, striae 선조, bruise 멍
   - 시간은 advance(dt)로만 흐르므로, 일괄 생성 때 프레임 단위로 똑같이 재현된다.
   ===================================================================== */
(function (global) {
  'use strict';

  const W = 1200, H = 600;
  const VIEWS = { face: '얼굴·입술', hands: '손등·손바닥', trunk: '앞가슴·배', legs: '다리(무릎~발)', arms: '팔꿈치·아래팔', pinch: '피부 긴장도(꼬집기)' };

  // ---------------------------------------------------------- 유틸
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  const rgb = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  // 외형별 기본 피부색: 눈 엔진이 있으면 같은 값을 쓴다(같은 환자로 보이도록)
  const FALLBACK = { m_m: { name: '40~50대 남성', skin: [222, 176, 146] } };
  const avatars = () => (global.EyeEngine && global.EyeEngine.AVATARS) || FALLBACK;

  const ZERO = { jaundice: 0, pallor: 0, cyanosis: 0, flush: 0, bronze: 0, sweat: 0, turgor: 0, cold: 0, spider: 0, palmar: 0, striae: 0, bruise: 0 };

  // ---------------------------------------------------------- 색 계산 (부위별)
  // 순서: 과색소 → 창백 → 황달 → 홍조 → 청색증. 각 소견이 실제로 잘 보이는 부위에서 더 세게 보이도록 weight를 준다.
  function tint(base, s, part) {
    const w = {               // [황달, 창백, 홍조, 청색증, 과색소]
      skin:   [1, 1, 0.5, 0.15, 1],
      cheek:  [1, 1, 1, 0.2, 1],
      lip:    [0.3, 1, 0.6, 1, 0.4],
      nail:   [0.2, 1, 0.3, 1, 0],
      palm:   [0.9, 1, 0.4, 0.3, 0.3],
      crease: [0.8, 1, 0.3, 0.2, 1.6],
    }[part] || [1, 1, 1, 1, 1];
    let c = base.slice();
    if (s.bronze) c = mix(c, [140, 92, 62], clamp(s.bronze * 0.55 * w[4], 0, 0.9));
    if (s.pallor) { const g = (c[0] + c[1] + c[2]) / 3; c = mix(c, [g + 30, g + 26, g + 22], s.pallor * 0.65 * w[1]); }
    if (s.jaundice) c = mix(c, [226, 196, 96], s.jaundice * 0.55 * w[0]);
    if (s.flush) c = mix(c, [214, 96, 86], s.flush * 0.5 * w[2]);
    if (s.cyanosis) c = mix(c, [112, 104, 162], s.cyanosis * 0.65 * w[3]);
    return c.map(v => clamp(v, 0, 255));
  }
  const LIP = [196, 108, 108], NAIL = [232, 170, 168];

  // ---------------------------------------------------------- 엔진
  function SkinEngine(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    this.t = 0; this.view = 'face'; this.s = Object.assign({}, ZERO);
    this.setAvatar('m_m');
    // 살아 있는 환자: 눈 깜빡임·시선·숨쉬기 (rng 고정 → 일괄 생성 때 똑같이 재현)
    this.rnd = rng(77); this.blinkAt = 2.2; this.blinkT0 = -9;
    this.gaze = [0, 0]; this.gazeT = [0, 0]; this.sacAt = 1.2;
    // 카메라: s 배율, (x, y) 화면 가운데에 올 지점(기본 좌표). 누르는 곳으로 다가갔다가 돌아온다
    this.cam = { s: 1, x: W / 2, y: H / 2 };
    this.pr = null;        // 지금(또는 방금) 누른 것 { x, y, r: 부위, t0: 누른 시각, t1: 뗀 시각 }
    this.hover = null;     // 마우스가 올라간 부위 { x, y, name } (화면 좌표)
    this.marks = null;     // 사진 속 눈·입·피부 위치 (tools/skin_marks.py)
    this.lesions = []; this.lesionCache = {};   // 코드로 그리는 병변(소아 발진 등)
  }
  SkinEngine.VIEWS = VIEWS;
  SkinEngine.ZERO = ZERO;

  SkinEngine.prototype.setAvatar = function (id) {
    const A = avatars();
    const alias = (global.EyeEngine && global.EyeEngine.AVATAR_ALIAS) || {};
    id = alias[id] || id; if (!A[id]) id = Object.keys(A).includes('m_m') ? 'm_m' : Object.keys(A)[0];
    this.avatarId = id; this.base = A[id].skin.slice();
  };
  // skin: 프리셋의 skin 객체, k: 강도 배율(경증 0.6 / 중등도 1 / 중증 1.3)
  SkinEngine.prototype.setSkin = function (skin, k) {
    k = k === undefined ? 1 : k; this.s = Object.assign({}, ZERO);
    for (const key in skin || {}) if (key in ZERO) this.s[key] = clamp(skin[key] * k, 0, 1);
  };
  SkinEngine.prototype.setView = function (v) {
    if (!VIEWS[v]) return;
    this.view = v; this.t = 0; this.pr = null; this.hover = null; this.pain = null;
    this.blinkAt = 2.2; this.blinkT0 = -9; this.sacAt = 1.2; this.gaze = [0, 0]; this.gazeT = [0, 0];
    this.cam = this.camHome();
  };
  SkinEngine.prototype.advance = function (dt) {
    const t = this.t += dt;
    if (t >= this.blinkAt) { this.blinkT0 = t; this.blinkAt = t + 2 + this.rnd() * 4.5; }
    if (t >= this.sacAt) {    // 시선: 가끔 살짝 옮겨 봄. 누르는 동안은 누르는 손 쪽을 봄
      const p = this.pr;
      this.gazeT = p && p.t1 === null && this.view === 'face' ? [clamp((p.x - this.cam.x) / 250, -1, 1) * 0.8, 0.5]
        : [(this.rnd() - 0.5) * 0.7, (this.rnd() - 0.5) * 0.3];
      this.sacAt = t + 0.7 + this.rnd() * 2.3;
    }
    const kg = 1 - Math.exp(-dt * 25);
    this.gaze = [lerp(this.gaze[0], this.gazeT[0], kg), lerp(this.gaze[1], this.gazeT[1], kg)];
    const ct = this.camTarget(), kc = 1 - Math.exp(-dt * 3.5);
    this.cam = { s: lerp(this.cam.s, ct.s, kc), x: lerp(this.cam.x, ct.x, kc), y: lerp(this.cam.y, ct.y, kc) };
    this.draw();
  };
  SkinEngine.prototype.snap = function () { this.draw(); return this.cv.toDataURL('image/jpeg', 0.9); };

  // 촉진했을 때 손에 느껴지는 것(그림으로 안 보이는 온도·습기). 진찰 반응이므로 학생에게 보여도 된다.
  SkinEngine.prototype.touch = function () {
    const s = this.s, out = [];
    out.push(s.cold > 0.4 ? '피부가 차갑다' : (s.flush > 0.6 && s.sweat < 0.2) ? '피부가 뜨겁다' : (s.flush > 0.2 || s.sweat > 0.4) ? '피부가 따뜻하다' : '피부 온도는 보통이다');
    out.push(s.sweat > 0.5 ? '축축하게 땀이 묻어난다' : s.sweat > 0.2 ? '약간 촉촉하다' : (s.turgor > 0.4 || (s.flush > 0.6 && s.sweat < 0.2)) ? '건조하다' : '습기는 보통이다');
    return out.join(', ');
  };
  // 꼬집었다 놓은 뒤 원래대로 펴지는 데 걸리는 시간(초). 정상 < 0.5초, 탈수는 2초 이상.
  SkinEngine.prototype.recoilTime = function () { return 0.3 + this.s.turgor * 3.6; };

  // ---------------------------------------------------------- 실사 사진 모드 (ChatGPT 생성 사진)
  // photo: { main: 주소 } 또는 꼬집기 { hold: 집은 장면, release: 놓은 직후(탈수면 피부가 서 있음), flat: 다 펴진 장면 }
  // null 이면 코드 그림으로 그린다. 꼬집기 시간 흐름(pinchHeight·recoilTime)은 그림과 똑같이 쓴다.
  const IMG = {};
  const srcs = (p) => ['main', 'hold', 'release', 'flat'].map(k => p[k]).filter(Boolean);   // tint·mouth 는 주소가 아님
  // photo.marks: 사진 속 눈·입·피부 위치(tools/skin_marks.py). 없으면 깜빡임·부위 구분 없이 그림
  SkinEngine.prototype.setPhoto = function (photo) {
    this.photo = photo || null; this.marks = (photo && photo.marks) || null;
    this.cam = this.camHome();
    if (!photo) return;
    for (const src of srcs(photo)) {
      if (!IMG[src]) { IMG[src] = new Image(); IMG[src].onload = () => { if (!this.pr) this.cam = this.camHome(); this.draw(); }; IMG[src].src = src; }
    }
  };
  // 사진을 다 불러왔는지 (스냅샷 찍기 전에 기다릴 때)
  SkinEngine.prototype.photoReady = function () {
    return !this.photo || srcs(this.photo).every(src => IMG[src] && IMG[src].complete && IMG[src].naturalWidth);
  };
  // 정상 실사 사진 위에 소견 색 입히기 (ChatGPT가 소견 사진을 못 만든 경우: 미성년자 얼굴 등)
  // 피부 전체는 얼굴 둘레로 부드럽게, 입술(청색증·창백)은 mouth [중심x, 중심y, 가로반지름, 세로반지름](0~1)에.
  SkinEngine.prototype.photoTint = function (c, x, y, w, h, mouth) {
    const s = this.s;
    let inner = 0.35;                                 // 이 반지름 비율까지는 고르게, 그 밖은 서서히 흐려짐
    const glow = (cx, cy, rx, ry, color, op) => {   // 가장자리가 부드러운 타원 색칠
      c.save(); c.globalCompositeOperation = op;
      c.translate(cx, cy); c.scale(1, ry / rx);
      const g = c.createRadialGradient(0, 0, rx * inner, 0, 0, rx);
      g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore();
    };
    const face = this.view === 'face';
    const m = mouth || [0.5, 0.6, 0.06, 0.026];
    // 색을 입힐 범위: 얼굴은 입술 기준으로 얼굴 둘레를 추정, 손·몸통은 사진 가운데 넓게(배경 회색엔 덜 묻게 가장자리는 흐리게)
    const fx = face ? x + w * m[0] : x + w / 2, fy = face ? y + h * (m[1] - 0.14) : y + h / 2;
    const frx = w * (face ? 0.27 : 0.62), fry = h * (face ? 0.36 : 0.62);
    inner = face ? 0.5 : 0.65;
    if (s.pallor) glow(fx, fy, frx, fry, `rgba(236,230,224,${0.45 * s.pallor})`, 'soft-light'), glow(fx, fy, frx, fry, `rgba(225,222,218,${0.4 * s.pallor})`, 'color');
    if (s.jaundice) {                                  // 황달: 노랗게 곱하고(multiply) 살짝 밝혀 탁해지지 않게
      glow(fx, fy, frx, fry, `rgba(245,205,70,${0.8 * s.jaundice})`, 'multiply');
      glow(fx, fy, frx, fry, `rgba(255,225,120,${0.35 * s.jaundice})`, 'soft-light');
    }
    if (s.flush) glow(fx, fy + fry * 0.15, frx, fry * 0.7, `rgba(230,110,100,${0.4 * s.flush})`, 'multiply');
    if (!face) return;                                   // 입술은 얼굴에서만
    const lx = x + w * m[0], ly = y + h * m[1];
    if (s.cyanosis) {
      glow(lx, ly, w * m[2] * 2.2, h * m[3] * 3.2, `rgba(150,150,205,${0.35 * s.cyanosis})`, 'multiply');   // 입 주변 거무스름
      glow(lx, ly, w * m[2] * 1.25, h * m[3] * 1.5, `rgba(120,95,165,${0.6 * s.cyanosis})`, 'color');        // 입술 보라색
      glow(lx, ly, w * m[2] * 1.1, h * m[3] * 1.3, `rgba(175,160,200,${0.45 * s.cyanosis})`, 'multiply');  // 입술을 어둡게(칠한 티 줄이기)
    }
    if (s.pallor) glow(lx, ly, w * m[2] * 1.2, h * m[3] * 1.4, `rgba(215,200,198,${0.6 * s.pallor})`, 'color');
    if (s.turgor > 0.3) glow(lx, ly, w * m[2] * 1.2, h * m[3] * 1.4, `rgba(200,170,160,${0.4 * s.turgor})`, 'color');   // 탈수: 입술이 핏기 없이 마름
  };

  SkinEngine.prototype.draw = function () {
    const c = this.ctx, k = this.cam;
    c.save(); c.clearRect(0, 0, W, H);
    this.drawRoom(c);
    this._label = '';
    if (this.photo && !this.photo.cutout) this.photoBackdrop(c);
    c.save(); c.translate(W / 2, H / 2); c.scale(k.s, k.s); c.translate(-k.x, -k.y);   // 카메라
    c.save(); this.bodyMotion(c);               // 숨쉬기·머리 움직임: 사진과 누르는 손이 같이 움직임
    if (this.photo) this.draw_photo(c); else this['draw_' + this.view](c);
    this.drawLesions(c);
    this.drawPress(c);
    c.restore(); c.restore();
    this.drawHud(c);
    c.restore();
  };

  // 진찰실 배경 하나(모든 부위·사진 공통): 위는 밝은 벽, 아래로 조금 어둡게, 가운데 은은한 빛
  SkinEngine.prototype.drawRoom = function (c) {
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#e4e8ec'); bg.addColorStop(1, '#c3cad1');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.5, W * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  };

  // ---------------------------------------------------------- 카메라·좌표
  // 기본 좌표(1200×600) ↔ 화면 좌표(카메라 확대 적용). 사진 안 위치(u, v: 0~1) ↔ 기본 좌표
  SkinEngine.prototype.toBase = function (sx, sy) { const k = this.cam; return [(sx - W / 2) / k.s + k.x, (sy - H / 2) / k.s + k.y]; };
  // 지금 그리는 사진이 놓인 자리(기본 좌표). 코드 그림이면 캔버스 전체
  SkinEngine.prototype.layout = function () {
    const im = this.photo && IMG[this.photo.main || this.photo.hold];
    if (!im || !im.naturalWidth) return this.view === 'legs' || this.view === 'arms' ? { x: (W - H) / 2, y: 0, w: H, h: H } : { x: 0, y: 0, w: W, h: H };
    const k = Math.min(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };
  // 기준점: 사진이면 skin_marks.py 값, 코드 그림 얼굴이면 그림의 고정 위치
  SkinEngine.prototype.faceMarks = function () {
    if (this.view !== 'face') return null;
    if (this.photo) return this.marks && this.marks.eyes ? this.marks : null;
    return { eyes: [[515 / W, 290 / H, 44 / W, 18 / H], [685 / W, 290 / H, 44 / W, 18 / H]], mouth: [600 / W, 462 / H, 70 / W, 22 / H] };
  };
  // 평소 카메라: 얼굴 사진은 얼굴이 화면을 채우게 당겨서, 나머지는 전체
  SkinEngine.prototype.camHome = function () {
    const m = this.faceMarks();
    if (this.photo && m) {
      const r = this.layout();
      return { s: 1.5, x: r.x + r.w * (m.eyes[0][0] + m.eyes[1][0]) / 2, y: r.y + r.h * ((m.eyes[0][1] + m.mouth[1]) / 2 + 0.02) };
    }
    return { s: 1, x: W / 2, y: H / 2 };
  };
  // 누르는 동안과 뗀 뒤 색이 돌아올 때까지는 그곳으로 다가감
  SkinEngine.prototype.camTarget = function () {
    const p = this.pr, home = this.camHome();
    if (!p || (p.t1 !== null && this.t - p.t1 > this.afterTime(p.r) + 1.2)) return home;
    const zs = { lid: 3.2, lip: 3, eye: home.s }[p.r.id] || (this.view === 'face' ? 3 : 2.4);
    let x = p.x, y = p.y;
    if (p.r.id === 'lid') { const e = this.eyeBase(p.r.eye); x = e.x; y = e.y + e.ry * 2; }
    if (p.r.id === 'lip') { const m = this.faceMarks(), r = this.layout(); x = r.x + r.w * m.mouth[0]; y = r.y + r.h * m.mouth[1]; }
    return { s: Math.max(home.s, zs), x, y };
  };
  // 눈 위치(기본 좌표): i=0 환자 우안(화면 왼쪽), 1 좌안
  SkinEngine.prototype.eyeBase = function (i) {
    const e = this.faceMarks().eyes[i], r = this.layout();
    return { x: r.x + r.w * e[0], y: r.y + r.h * e[1], rx: r.w * e[2], ry: r.h * e[3] };
  };

  // ---------------------------------------------------------- 살아 있는 환자
  // 숨쉬기(가슴·어깨 오르내림) 0~1. 청색증(호흡곤란)이면 빠르게
  SkinEngine.prototype.breath = function () {
    const per = 60 / (15 + this.s.cyanosis * 12);
    return (1 - Math.cos(this.t / per * 2 * Math.PI)) / 2;
  };
  SkinEngine.prototype.bodyMotion = function (c) {
    const pn = this.pain;            // 아파서 움찔(0.5초 안에 잦아드는 작은 떨림)
    if (pn && this.t > pn.t0 && this.t < pn.t0 + 0.6) {
      const d = this.t - pn.t0, a = Math.exp(-d * 7) * pn.k * 5;
      c.translate(Math.sin(d * 38) * a, -Math.abs(Math.sin(d * 25)) * a * 0.6);
    }
    if (this.view === 'face') {        // 머리가 아주 조금 흔들림(숨쉬기 + 느린 흔들림)
      const t = this.t, b = this.breath(), r = this.layout();
      const px = r.x + r.w / 2, py = r.y + r.h * 0.9;
      c.translate(px, py); c.rotate((Math.sin(t * 0.43) * 0.6 + Math.sin(t * 1.17) * 0.25) * Math.PI / 180 * 0.35);
      c.translate(-px + Math.sin(t * 0.61) * 1.2, -py - b * 1.6 + Math.sin(t * 0.9) * 0.5);
    } else if (this.view === 'trunk') {  // 가슴·배가 숨쉴 때마다 살짝 부풂
      const b = this.breath();
      c.translate(W / 2, H); c.scale(1 + b * 0.004, 1 + b * 0.01); c.translate(-W / 2, -H);
    }
  };
  // 눈꺼풀 닫힘 0~1 (깜빡임 0.28초: 0.07초 감고, 0.05초 머물고, 0.16초 뜸)
  SkinEngine.prototype.blinkAmt = function () {
    const d = this.t - this.blinkT0;
    if (d < 0 || d > 0.28) return 0;
    return d < 0.07 ? d / 0.07 : d < 0.12 ? 1 : 1 - (d - 0.12) / 0.16;
  };

  // 사진 속 눈: 시선(눈 안쪽만 옆으로 살짝 밀기) + 깜빡임(윗눈꺼풀 피부를 아래로 늘여 덮기)
  SkinEngine.prototype.liveEyes = function (c, im, r) {
    const b = Math.max(this.blinkAmt(), this.squint(), this.puffAmt()), sx = im.naturalWidth / r.w, sy = im.naturalHeight / r.h;
    const pull = this.pr && this.pr.r.id === 'lid' ? this.pr.r.eye : -1;
    for (let i = 0; i < 2; i++) {
      const e = this.eyeBase(i);
      // 시선: 눈 안쪽(타원)만 옆으로 옮겨 그림
      const gx = this.gaze[0] * e.rx * 0.16, gy = this.gaze[1] * e.ry * 0.12;
      if (Math.abs(gx) + Math.abs(gy) > 0.15) {
        c.save(); c.beginPath(); c.ellipse(e.x, e.y, e.rx * 0.82, e.ry * 0.95, 0, 0, 7); c.clip();
        const bw = e.rx * 2, bh = e.ry * 2.4;
        c.drawImage(im, (e.x - bw / 2 - r.x) * sx, (e.y - bh / 2 - r.y) * sy, bw * sx, bh * sy, e.x - bw / 2 + gx, e.y - bh / 2 + gy, bw, bh);
        c.restore();
      }
      if (b <= 0.01 || i === pull) continue;
      // 깜빡임: 열 단위로 윗눈꺼풀 피부(눈 위 Hs 높이)를 늘여서 눈을 덮음
      const RX = e.rx * 1.25, RY = e.ry * 1.35, step = 0.6;
      const edge = [];
      for (let x = e.x - RX; x <= e.x + RX; x += step) {
        const d = (x - e.x) / RX, q = Math.sqrt(Math.max(0, 1 - d * d));
        const yu = e.y - RY * q, yl = e.y + RY * 0.85 * q, ym = yu + (yl - yu) * b, Hs = RY * 1.8 * q;   // 눈 끝으로 갈수록 덜 늘임(이음매 없게)
        edge.push([x, ym]);
        if (ym - yu < 0.2 || Hs < 0.5) continue;
        c.drawImage(im, (x - r.x) * sx, (yu - Hs - r.y) * sy, step * sx, Hs * sy, x, yu - Hs, step + 0.35, Hs + (ym - yu));
      }
      // 속눈썹 줄(눈꺼풀 끝)
      c.save(); c.strokeStyle = `rgba(35,22,18,${0.75 * Math.min(1, b * 2.5)})`; c.lineWidth = Math.max(1, e.ry * 0.22); c.lineCap = 'round';
      c.beginPath(); edge.forEach(([x, y], k) => k ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); c.restore();
    }
  };

  SkinEngine.prototype.photoBackdrop = function (c) {    // 양옆 빈칸: 같은 사진을 흐리게 깔기
    const im = IMG[this.photo.main || this.photo.hold];
    if (!im || !im.complete || !im.naturalWidth) return;
    const kc = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    c.save(); c.filter = 'blur(24px) brightness(0.55)';
    c.drawImage(im, (W - im.naturalWidth * kc) / 2, (H - im.naturalHeight * kc) / 2, im.naturalWidth * kc, im.naturalHeight * kc);
    c.restore();
  };

  SkinEngine.prototype.draw_photo = function (c) {
    const p = this.photo, t = this.t;
    let src = p.main, fade = 0;
    if (p.hold) {     // 꼬집기: 1.6초까지 집고 있다가 놓음 → recoilTime 동안 놓은 직후 장면, 그 뒤 펴진 장면
      const held = t < 1.6;
      src = held ? p.hold : p.release;
      if (!held) fade = 1 - clamp(this.pinchHeight(t) / 0.25, 0, 1);  // 거의 다 가라앉을 때부터 '펴진 사진'을 서서히 겹침
      this._label = held ? '손등 피부를 집어 올리는 중…' : `놓은 뒤 ${Math.min(t - 1.6, 9.9).toFixed(1)}초`;
    }
    const im = IMG[src];
    if (!(im && im.complete && im.naturalWidth)) {
      c.fillStyle = '#556'; c.font = '24px sans-serif'; c.textAlign = 'center'; c.fillText('사진 불러오는 중…', W / 2, H / 2);
      return;
    }
    const r = this.layout(), m = this.faceMarks();
    if (p.cutout) { c.save(); c.filter = 'blur(14px) brightness(0)'; c.globalAlpha = 0.18; c.drawImage(im, r.x + 6, r.y + 10, r.w, r.h); c.restore(); }
    c.drawImage(im, r.x, r.y, r.w, r.h);
    if (m) {
      // 숨쉬기: 목 아래(어깨·가운)만 위로 살짝 올라감. 띠 여러 개로 나눠 아래로 갈수록 더 많이 올림
      const v0 = Math.min(0.95, m.mouth[1] + 0.16), A = r.h * 0.01 * this.breath(), N = 16;
      for (let j = 0; j < N; j++) {
        const va = v0 + (1 - v0) * j / N, vb = v0 + (1 - v0) * (j + 1) / N, f = (j + 0.5) / N, dy = -A * f * f * (3 - 2 * f);
        c.drawImage(im, 0, va * im.naturalHeight, im.naturalWidth, (vb - va) * im.naturalHeight + 1, r.x, r.y + va * r.h + dy, r.w, (vb - va) * r.h + 1.5);
      }
      this.liveEyes(c, im, r);
    }
    const fl = IMG[p.flat];
    if (fade > 0 && fl && fl.complete && fl.naturalWidth) { c.save(); c.globalAlpha = fade; c.drawImage(fl, r.x, r.y, r.w, r.h); c.restore(); }
    if (p.tint) { c.save(); if (p.cutout) c.clip(this.skinClip()); this.photoTint(c, r.x, r.y, r.w, r.h, p.mouth); c.restore(); }
  };

  // ---------------------------------------------------------- 누르며 진찰
  // 부위 id: forehead 이마 / cheek 볼 / chin 턱·목 / lid 아래눈꺼풀(eye: 0 우안, 1 좌안) / lip 입술 / eye 눈(누르지 않음)
  //          tip 손끝 / hand 손 / chest 앞가슴 / abd 배.  부위 목록은 소견과 관계없이 같다(학생 모드 정답 노출 방지)
  const REGION = { forehead: '이마', cheek: '볼', chin: '턱·목', lid: '아래눈꺼풀', lip: '입술', eye: '눈', tip: '손끝(손톱)', hand: '손', chest: '앞가슴', abd: '배',
    knee: '무릎', shin: '정강이·종아리', ankle: '발목', foot: '발등', toe: '엄지발가락', elbow: '팔꿈치', forearm: '아래팔' };
  // 다리·팔 사진(정면)에서 부위 나누기: 무릎~발 세로 위치(0~1). 환자 기준 오른쪽 = 화면 왼쪽(u < 0.5)
  const LEG_BANDS = [[0.25, 'knee'], [0.66, 'shin'], [0.77, 'ankle'], [1, 'foot']];
  const CODE_ELBOWS = [[0.3, 0.74], [0.7, 0.74]];
  SkinEngine.REGION = REGION;
  // 사진의 피부 지도(48×48)에서 (u, v)가 피부인지
  SkinEngine.prototype.onSkin = function (u, v) {
    const mk = this.marks;
    if (!mk || !mk.skin) return true;
    const G = 48, i = Math.floor(clamp(u, 0, 0.999) * G), j = Math.floor(clamp(v, 0, 0.999) * G), k = j * G + i;
    return !!((parseInt(mk.skin[k >> 2], 16) >> (3 - (k & 3))) & 1);
  };
  SkinEngine.prototype.regionAt = function (x, y) {
    if (this.view === 'pinch') return null;
    const r = this.layout(), u = (x - r.x) / r.w, v = (y - r.y) / r.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const mk = (id, extra) => Object.assign({ id, name: REGION[id] }, extra || {});
    if (this.view === 'face') {
      const m = this.faceMarks();
      if (!m) return this.onSkin(u, v) ? mk('cheek') : null;
      for (let i = 0; i < 2; i++) {
        const e = m.eyes[i], du = (u - e[0]) / (e[2] * 1.25), dv = (v - e[1]) / (e[3] * 1.5);
        const side = i ? '왼쪽 ' : '오른쪽 ';                    // 환자 기준: 화면 왼쪽 = 환자 오른쪽
        if (du * du + dv * dv < 1) return mk('eye', { name: side + '눈', eye: i });
        if (Math.abs(u - e[0]) < e[2] * 1.3 && v > e[1] && v < e[1] + e[3] * 1.5 + 0.04) return mk('lid', { name: side + '아래눈꺼풀', eye: i });
      }
      const o = m.mouth, du = (u - o[0]) / (o[2] * 1.35), dv = (v - o[1]) / (o[3] * 1.8);
      if (du * du + dv * dv < 1) return mk('lip');
      if (this.photo ? !this.onSkin(u, v) : ((x - 600) / 215) ** 2 + ((y - 320) / 265) ** 2 > 1 && !(Math.abs(x - 600) < 95 && y > 480)) return null;
      const ey = m.eyes[0][1];
      return mk(v < ey - (this.photo ? 0.06 : 0.12) ? 'forehead' : v > o[1] + (this.photo ? 0.06 : 0.1) ? 'chin' : 'cheek');
    }
    if (this.view === 'hands') {
      if (this.photo) {
        if (!this.onSkin(u, v)) return null;
        const near = ((this.marks && this.marks.tips) || []).some(t => Math.hypot(t[0] - u, t[1] - v) < 0.055);
        return mk(near ? 'tip' : 'hand');
      }
      for (const hx of [330, 870]) {       // 코드 그림: 손 모양 안인지
        const c = this.ctx; handPath(c, hx, 300, 1.15);
        if (c.isPointInPath(x, y)) return mk(FINGERS.some(([fx, fy]) => Math.hypot(hx + fx * 1.15 - x, 300 + fy * 1.15 - y) < 34) ? 'tip' : 'hand');
      }
      return null;
    }
    const sided = (id) => { const R = (u < 0.5) !== !!(this.marks && this.marks.mirror); return mk(id, { side: R ? 'R' : 'L', name: (R ? '오른쪽 ' : '왼쪽 ') + REGION[id] }); };
    if (this.view === 'trunk') {
      if (this.photo ? !this.onSkin(u, v) : Math.abs(x - 600) > 250) return null;
      return sided(v < 0.5 ? 'chest' : 'abd');
    }
    if (this.view === 'legs') {
      if (this.photo ? !this.onSkin(u, v) : !this.onCodeLeg(u, v)) return null;
      if (v > 0.84 && Math.abs(u - 0.5) < 0.16) return sided('toe');
      return sided(LEG_BANDS.find(b => v < b[0])[1]);
    }
    if (this.view === 'arms') {
      if (this.photo ? !this.onSkin(u, v) : !this.onCodeArm(u, v)) return null;
      const el = (this.marks && this.marks.elbows) || CODE_ELBOWS;
      return sided(el.some(e => Math.hypot(e[0] - u, e[1] - v) < 0.1) ? 'elbow' : 'forearm');
    }
    return null;
  };
  // 코드 그림 다리·팔 안인지 (가운데 정사각형 기준 u, v)
  SkinEngine.prototype.onCodeLeg = function (u, v) {
    return [0.38, 0.62].some(cu => {
      const d = cu < 0.5 ? 1 : -1;
      if (v > 0.06 && v < 0.82 && Math.abs(u - cu) < (v < 0.74 ? 0.078 - 0.033 * v / 0.74 : 0.048)) return true;   // 다리
      return ((u - cu - d * 0.01) / 0.065) ** 2 + ((v - 0.85) / 0.075) ** 2 < 1;                                     // 발
    });
  };
  SkinEngine.prototype.onCodeArm = function (u, v) { return v > 0.1 && v < 0.84 && CODE_ELBOWS.some(([cu]) => Math.abs(u - cu) < 0.045 + 0.018 * clamp((v - 0.12) / 0.6, 0, 1)); };
  // 모세혈관 재충혈 시간(초): 손끝을 5초 눌렀다 뗀 뒤 붉은색이 돌아오는 시간. 정상 2초 미만,
  // 말초가 차고 혈류가 줄면(쇼크·탈수·추위) 늦어짐. 값은 초안(검수 필요)
  SkinEngine.prototype.crt = function () { const s = this.s; return clamp(1.2 + s.cold * 2.4 + s.turgor * 1.4, 0.8, 6); };
  SkinEngine.prototype.refillTime = function (r) {
    if (!r) return 0;
    if (r.id === 'lid' || r.id === 'lip' || r.id === 'eye') return 0.3;
    // 허혈(그 부위만 차가움): 피가 늦게 돌아와 색도 늦게 돌아옴 (초안)
    return (r.id === 'tip' ? this.crt() : this.crt() * 0.8) + (this.palpAt(r).cold ? 2.5 : 0);
  };
  // 누르기 시작 (화면 좌표). 피부가 아니면 null
  SkinEngine.prototype.press = function (sx, sy) {
    const [x, y] = this.toBase(sx, sy), r = this.regionAt(x, y);
    if (!r) return null;
    this.pr = { x, y, r, t0: this.t, t1: null };
    this.sacAt = this.t;          // 환자가 누르는 손 쪽을 봄
    this.startPain();
    return r;
  };
  // 부위 이름으로 누르기(패널 단추·스냅샷용): 그 부위 안에서 대표 위치에 가장 가까운 곳을 찾아 누름
  SkinEngine.prototype.pressRegion = function (id) {
    const r = this.layout(), m = this.faceMarks(), e = m && m.eyes[0];
    const side = id.split(':')[1]; id = id.split(':')[0];
    const right = (side === 'L') !== !!(this.marks && this.marks.mirror);   // 화면 오른쪽에 있는지 (뒤에서 찍은 사진은 반대)
    const el = ((this.marks && this.marks.elbows) || CODE_ELBOWS)[right ? 1 : 0];
    const lu = right ? 0.62 : 0.38;
    const want = {
      knee: [lu, 0.14], shin: [lu, 0.45], ankle: [lu, 0.72], foot: [lu, 0.81], toe: [right ? 0.56 : 0.44, 0.9],
      elbow: el, forearm: [el[0] + (side === 'L' ? -0.05 : 0.05), el[1] + (el[1] > 0.5 ? -0.25 : 0.25)],
      forehead: m && [(m.eyes[0][0] + m.eyes[1][0]) / 2, e[1] - 0.1], cheek: e && [e[0] - 0.01, e[1] + 0.1], chin: m && [m.mouth[0], m.mouth[1] + 0.09],
      lid: e && [e[0], e[1] + e[3] + 0.015], lip: m && m.mouth.slice(0, 2), tip: [0.75, 0.85], hand: [0.72, 0.45], chest: [0.42, 0.3], abd: [0.5, 0.7],
    }[id];
    if (!want) return null;
    // 손끝은 손톱(손가락 끝에서 조금 위)을 누름. 코드 그림은 왼쪽 손등의 손톱
    if (id === 'tip') {
      const tips = this.photo ? ((this.marks && this.marks.tips) || []).map(t => [t[0], t[1] - 0.03])
        : FINGERS.map(([fx, fy]) => [(330 + fx * 1.15) / W, (300 + (fy + 10) * 1.15) / H]);
      const dist = (q) => Math.hypot(q[0] - want[0], q[1] - want[1]);
      const tp = tips.slice().sort((q1, q2) => dist(q1) - dist(q2))[0];
      const g = tp && this.regionAt(r.x + tp[0] * r.w, r.y + tp[1] * r.h);
      if (g && g.id === 'tip') { this.pr = { x: r.x + tp[0] * r.w, y: r.y + tp[1] * r.h, r: g, t0: this.t, t1: null }; this.sacAt = this.t; this.startPain(); return g; }
    }
    let best = null, bd = 1e9;
    for (let j = 0; j <= 60; j++) for (let i = 0; i <= 60; i++) {
      const u = i / 60, v = j / 60, g = this.regionAt(r.x + u * r.w, r.y + v * r.h);
      const d = Math.hypot(u - want[0], v - want[1]);
      // 피부 가장자리가 아닌 곳(둘레도 피부)만: 피부 지도는 조금 넓혀 둬서 가장자리는 배경일 수 있음
      const solid = !this.photo || [[-0.04, 0], [0.04, 0], [0, -0.04], [0, 0.04]].every(([du, dv]) => this.onSkin(u + du, v + dv));
      if (g && g.id === id && (!side || g.side === side) && solid && d < bd) { bd = d; best = [r.x + u * r.w, r.y + v * r.h, g]; }
    }
    if (!best) return null;
    this.pr = { x: best[0], y: best[1], r: best[2], t0: this.t, t1: null };
    this.sacAt = this.t; this.startPain();
    return best[2];
  };
  // 떼기 → { r: 부위, held: 누른 시간 }
  SkinEngine.prototype.release = function () {
    const p = this.pr;
    if (!p || p.t1 !== null) return null;
    p.t1 = this.t;
    return { r: p.r, held: p.t1 - p.t0 };
  };
  SkinEngine.prototype.setHover = function (sx, sy) {
    if (sx === null) { this.hover = null; return null; }
    const [x, y] = this.toBase(sx, sy), r = this.regionAt(x, y);
    this.hover = r ? { x: sx, y: sy, name: r.name } : null;
    return r;
  };
  // ---------------------------------------------------------- 병변 그리기 (코드): 소아 발진 등 사진이 없는 소견
  // 프리셋 lesions: [{ view, type, area, n, size: [최소, 최대](cm), seed }]
  //   type: macule 반점 / papule 구진 / varicella 수두(여러 시기 섞임) / petechia 점상출혈 / purpura 자반 / ppurpura 만져지는 자반
  //         bruise 멍(여러 시기) / slapped 뺨 홍반 / lacy 그물 모양 / lips_red 붉고 갈라진 입술 / palm_red 손바닥 홍반
  //         puff 눈 주위 부종 / eczema 습진(태선화·인설·긁은 자국) / conj_red 양쪽 결막 충혈(흰자가 붉음, 가와사키·홍역)
  //   area: 'all' | [u0, v0, u1, v1](사진·그림 안 비율) | 얼굴은 'face' 'cheeks' 'hairline' 'perioral' (눈·입 위치 기준)
  // 사진이면 사진 위에, 사진이 없으면 코드 그림 위에 같은 방법으로 그림. 피부가 아닌 곳(배경·옷·눈)은 건너뜀
  // 흰자 지도(tools/skin_marks.py SCL_BOX·32×16): 눈 중심 ± 가로반지름×1.5, ± 세로반지름×1.7 상자, 16진수 → 가장자리를 흐린 마스크 캔버스
  const SCL_BOX = [1.5, 1.7], SCL_W = 32, SCL_H = 16, SCL_CACHE = {};
  function sclMask(hex) {
    if (SCL_CACHE[hex]) return SCL_CACHE[hex];
    const m = document.createElement('canvas'); m.width = SCL_W; m.height = SCL_H;
    const g = m.getContext('2d'), d = g.createImageData(SCL_W, SCL_H);
    for (let k = 0; k < SCL_W * SCL_H; k++) if ((parseInt(hex[k >> 2], 16) >> (3 - (k & 3))) & 1) d.data[k * 4 + 3] = 255;
    g.putImageData(d, 0, 0);
    const b = document.createElement('canvas'); b.width = SCL_W * 4; b.height = SCL_H * 4;
    const bg = b.getContext('2d'); bg.filter = 'blur(2px)'; bg.drawImage(m, 0, 0, b.width, b.height);
    return (SCL_CACHE[hex] = b);
  }
  const BLANCH_TYPES = { macule: 1, papule: 1, slapped: 1, lacy: 1, palm_red: 1, eczema: 1, lips_red: 0 };
  SkinEngine.prototype.setLesions = function (list) { this.lesions = list || []; this.lesionCache = {}; };
  // 1cm 가 몇 px 인지(기본 좌표): 사진·그림 속 몸 크기로 대강 맞춤
  SkinEngine.prototype.pxPerCm = function () {
    const r = this.layout(), ph = !!this.photo;
    return { face: ph ? r.w * 0.032 : 31, hands: ph ? r.w * 0.032 : 22, trunk: ph ? r.w * 0.025 : 20, legs: r.w * 0.016, arms: r.w * 0.02 }[this.view] || 20;
  };
  // 병변 위치 정하기(같은 케이스면 항상 같은 자리)
  SkinEngine.prototype.lesionSpots = function (L, idx) {
    const key = this.view + '|' + (this.photo ? this.photo.main : 'code') + '|' + idx;
    if (this.lesionCache[key]) return this.lesionCache[key];
    const r = this.layout(), m = this.faceMarks(), rnd = rng(L.seed || (101 + idx * 7)), cm = this.pxPerCm();
    const inArea = () => {
      const a = L.area || 'all';
      if (Array.isArray(a)) return [a[0] + rnd() * (a[2] - a[0]), a[1] + rnd() * (a[3] - a[1])];
      if (m && a !== 'all') {
        const ex = (m.eyes[0][0] + m.eyes[1][0]) / 2, ey = m.eyes[0][1], my = m.mouth[1], w = (m.eyes[1][0] - m.eyes[0][0]);
        if (a === 'face') return [ex + (rnd() - 0.5) * w * 2.6, ey - w * 0.8 + rnd() * (my - ey + w * 1.3)];
        if (a === 'hairline') return [ex + (rnd() - 0.5) * w * 2.4, ey - w * 0.85 + rnd() * w * 0.4];
        if (a === 'perioral') { const t = rnd() * 6.28, d = Math.sqrt(rnd()); return [m.mouth[0] + Math.cos(t) * w * 0.6 * d, my + Math.sin(t) * w * 0.4 * d]; }
        if (a === 'cheeks') { const e = m.eyes[rnd() < 0.5 ? 0 : 1], t = rnd() * 6.28, d = Math.sqrt(rnd()); return [e[0] + Math.cos(t) * w * 0.38 * d, ey + w * 0.55 + Math.sin(t) * w * 0.35 * d]; }
      }
      return [rnd(), rnd()];
    };
    const out = [], skip = { eye: 1, lid: 1, lip: 1 };
    const one = { slapped: 1, lacy: 1, lips_red: 1, puff: 1, conj_red: 1 }[L.type];
    for (let tries = 0; out.length < (one ? 1 : L.n || 30) && tries < (L.n || 30) * 25; tries++) {
      const [u, v] = inArea(), x = r.x + u * r.w, y = r.y + v * r.h;
      const rr0 = ((L.size || [0.2, 0.5])[1]) * cm * 0.8;     // 병변 크기만큼 눈·입술에서 떨어뜨림
      if (!one && [[0, 0], [rr0, 0], [-rr0, 0], [0, rr0], [0, -rr0]].some(([dx, dy]) => { const g = this.regionAt(x + dx, y + dy); return !g || skip[g.id]; })) continue;
      if (!one && this.photo && ![[-0.02, 0], [0.02, 0], [0, -0.02], [0, 0.02]].every(([du, dv]) => this.onSkin(u + du, v + dv))) continue;   // 피부 가장자리 제외
      const sz = L.size || [0.2, 0.5];
      out.push({ x, y, r: (sz[0] + rnd() * (sz[1] - sz[0])) * cm, a: rnd(), b: rnd(), c: rnd() });
    }
    // 사진 영역을 다 불러온 뒤에만 기억(불러오기 전 자리는 틀릴 수 있음)
    if (!this.photo || this.photoReady()) this.lesionCache[key] = out;
    return out;
  };
  // 누르고 있거나 막 뗀 자리: 소퇴성 병변은 색이 빠짐(0~1)
  SkinEngine.prototype.pressFade = function (x, y) {
    const p = this.pr; if (!p || { eye: 1, lid: 1, lip: 1 }[p.r.id]) return 0;
    const R = this.fingerSize() * 0.75; if (Math.hypot(x - p.x, y - p.y) > R) return 0;
    if (p.t1 === null) return clamp((this.t - p.t0) / 0.25, 0, 1);
    return p.t1 - p.t0 < 0.4 ? 0 : clamp(1 - (this.t - p.t1) / this.refillTime(p.r), 0, 1);
  };
  function blob(c, x, y, rx, ry, rot, color, op) {   // 가장자리가 부드러운 타원 얼룩
    c.save(); c.globalCompositeOperation = op || 'multiply'; c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
    g.addColorStop(0, color(1)); g.addColorStop(0.6, color(0.75)); g.addColorStop(1, color(0));
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore();
  }
  // 병변을 피부 안에만 그리도록 자르는 모양: 격자 칸 중 피부인 칸(둘레도 피부)만 모음. 부위·사진마다 한 번 만들어 둠
  SkinEngine.prototype.skinClip = function () {
    const key = 'clip|' + this.view + '|' + (this.photo ? this.photo.main : 'code');
    if (this.lesionCache[key]) return this.lesionCache[key];
    const r = this.layout(), G = 160, path = new Path2D(), d = this.photo ? 2.5 / G : 0.6 / G, bad = {};   // 눈·입은 점을 놓을 때 피함(구멍을 내면 네모가 보임)
    const ok = (u, v) => { const g = this.regionAt(r.x + u * r.w, r.y + v * r.h); return g && !bad[g.id]; };
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const u = (i + 0.5) / G, v = (j + 0.5) / G;
      if (ok(u, v) && ok(u - d, v) && ok(u + d, v) && ok(u, v - d) && ok(u, v + d)) path.rect(r.x + i / G * r.w, r.y + j / G * r.h, r.w / G + 0.5, r.h / G + 0.5);
    }
    if (!this.photo || this.photoReady()) this.lesionCache[key] = path;
    return path;
  };
  SkinEngine.prototype.drawLesions = function (c) {
    const list = (this.lesions || []).filter(L => L.view === this.view);
    if (!list.length || this.view === 'pinch') return;
    const free = { puff: 1, lips_red: 1, conj_red: 1 };   // 눈·입술 위에 그리는 것은 자르지 않음
    c.save(); c.clip(this.skinClip());
    this.drawLesionList(c, list.filter(L => !free[L.type]));
    c.restore();
    this.drawLesionList(c, list.filter(L => free[L.type]));
  };
  SkinEngine.prototype.drawLesionList = function (c, list) {
    list.forEach((L, i) => {
      const spots = this.lesionSpots(L, this.lesions.indexOf(L)), A = L.alpha || 1;
      const rgba = (col, a) => (k) => `rgba(${col[0]},${col[1]},${col[2]},${(a * k).toFixed(3)})`;
      for (const s of spots) {
        const fade = BLANCH_TYPES[L.type] || L.type === 'varicella' ? 1 - this.pressFade(s.x, s.y) * 0.9 : 1, a = A * fade;
        if (a < 0.02 && L.type !== 'puff') continue;
        const rot = s.a * 6.28, sq = 0.7 + s.b * 0.3;
        switch (L.type) {
          case 'macule': case 'papule': {
            blob(c, s.x, s.y, s.r, s.r * sq, rot, rgba(L.color || [214, 74, 74], 0.62 * a));
            if (L.type === 'papule') {    // 솟은 느낌: 위쪽 빛, 아래쪽 그림자
              blob(c, s.x - s.r * 0.25, s.y - s.r * 0.3, s.r * 0.4, s.r * 0.3, 0, rgba([255, 255, 255], 0.22 * a), 'screen');
              blob(c, s.x + s.r * 0.2, s.y + s.r * 0.35, s.r * 0.55, s.r * 0.3, 0, rgba([120, 50, 40], 0.18 * a));
            }
            break;
          }
          case 'varicella': {           // 반점 → 구진 → 수포(이슬방울) → 가피 가 섞여 있음
            const st = s.c < 0.2 ? 0 : s.c < 0.45 ? 1 : s.c < 0.8 ? 2 : 3;
            blob(c, s.x, s.y, s.r * (st === 2 ? 1.7 : 1.3), s.r * (st === 2 ? 1.6 : 1.2), rot, rgba([214, 70, 70], 0.55 * a));
            if (st === 1) blob(c, s.x - s.r * 0.2, s.y - s.r * 0.25, s.r * 0.4, s.r * 0.3, 0, rgba([255, 255, 255], 0.2 * a), 'screen');
            if (st === 2) {
              c.save(); c.globalAlpha = A;
              const g = c.createRadialGradient(s.x - s.r * 0.3, s.y - s.r * 0.35, s.r * 0.05, s.x, s.y, s.r * 0.75);
              g.addColorStop(0, 'rgba(255,255,250,0.95)'); g.addColorStop(0.5, 'rgba(250,236,226,0.7)'); g.addColorStop(1, 'rgba(235,200,190,0.35)');
              c.fillStyle = g; c.beginPath(); c.ellipse(s.x, s.y, s.r * 0.75, s.r * 0.7, rot, 0, 7); c.fill();
              c.strokeStyle = 'rgba(170,110,100,0.35)'; c.lineWidth = Math.max(0.4, s.r * 0.08); c.stroke();
              c.restore();
            }
            if (st === 3) {
              c.save(); c.globalAlpha = A; c.fillStyle = 'rgba(120,70,40,0.85)'; c.beginPath();
              for (let k = 0; k < 7; k++) { const t = k / 7 * 6.28, rr = s.r * (0.45 + 0.25 * Math.sin(k * 2.3 + s.b * 9)); k ? c.lineTo(s.x + Math.cos(t) * rr, s.y + Math.sin(t) * rr) : c.moveTo(s.x + Math.cos(t) * rr, s.y + Math.sin(t) * rr); }
              c.closePath(); c.fill(); c.restore();
            }
            break;
          }
          case 'petechia': {            // 바늘 끝 크기 붉은 보라 점: 눌러도 안 사라짐
            c.save(); c.globalAlpha = A; c.fillStyle = `rgba(${120 + s.b * 40 | 0},20,${45 + s.c * 30 | 0},0.85)`;
            c.beginPath(); c.arc(s.x, s.y, Math.max(0.6, s.r), 0, 7); c.fill(); c.restore();
            break;
          }
          case 'purpura': case 'ppurpura': {
            blob(c, s.x, s.y, s.r, s.r * sq, rot, rgba([120, 30, 80], 0.7 * A));
            blob(c, s.x + s.r * 0.3, s.y - s.r * 0.2, s.r * 0.6, s.r * 0.5, rot, rgba([100, 25, 70], 0.4 * A));
            if (L.type === 'ppurpura') blob(c, s.x - s.r * 0.25, s.y - s.r * 0.3, s.r * 0.35, s.r * 0.25, 0, rgba([255, 255, 255], 0.2 * A), 'screen');
            break;
          }
          case 'bruise': {              // 시기에 따라 보라 → 파랑 → 황록 (가장자리가 먼저 누렇게)
            const age = s.c, core = age < 0.35 ? [95, 40, 115] : age < 0.7 ? [70, 80, 140] : [150, 150, 70];
            blob(c, s.x, s.y, s.r * 1.15, s.r * sq * 1.1, rot, rgba(age < 0.35 ? [150, 70, 120] : [170, 160, 80], 0.35 * A));
            blob(c, s.x, s.y, s.r, s.r * sq, rot, rgba(core, 0.65 * A));
            break;
          }
          case 'slapped': {             // 양 뺨이 맞은 듯 붉음, 코입술주름·입 주위는 덜함
            const m = this.faceMarks(), r = this.layout(); if (!m) break;
            const w = (m.eyes[1][0] - m.eyes[0][0]) * r.w;
            for (const e of m.eyes) blob(c, r.x + e[0] * r.w, r.y + (e[1] + (m.mouth[1] - e[1]) * 0.45) * r.h, w * 0.42, w * 0.36, 0, rgba([225, 60, 60], 0.6 * a));
            break;
          }
          case 'lacy': {                // 팔다리의 그물(레이스) 모양 홍반
            const rnd = rng(L.seed || 77), r = this.layout(), cm = this.pxPerCm();
            c.save(); c.globalCompositeOperation = 'multiply'; c.lineWidth = cm * 0.16;
            for (let k = 0; k < (L.n || 140) * 2; k++) {
              const u = (L.area || [0, 0, 1, 1]), x = r.x + (u[0] + rnd() * (u[2] - u[0])) * r.w, y = r.y + (u[1] + rnd() * (u[3] - u[1])) * r.h;
              const g = this.regionAt(x, y); if (!g) continue;
              const f = 1 - this.pressFade(x, y) * 0.9;
              c.strokeStyle = `rgba(215,95,95,${(0.32 * A * f).toFixed(3)})`;
              c.beginPath(); c.arc(x, y, cm * (0.3 + rnd() * 0.35), rnd() * 6, rnd() * 6 + 3.2); c.stroke();
            }
            c.restore();
            break;
          }
          case 'lips_red': {            // 가와사키: 새빨갛고 갈라진 입술
            const m = this.faceMarks(), r = this.layout(); if (!m) break;
            const o = m.mouth, x = r.x + o[0] * r.w, y = r.y + o[1] * r.h, rx = o[2] * r.w, ry = o[3] * r.h;
            blob(c, x, y, rx * 1.0, ry * 1.15, 0, rgba([215, 40, 45], 0.5 * A));
            blob(c, x, y, rx * 0.85, ry * 0.9, 0, rgba([210, 20, 35], 0.28 * A), 'color');
            c.save(); c.strokeStyle = `rgba(120,30,30,${0.35 * A})`; c.lineWidth = Math.max(0.3, ry * 0.05);   // 마르고 갈라진 틈
            for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x + k * rx * 0.22, y - ry * 0.55); c.lineTo(x + k * rx * 0.22 + ry * 0.08, y + ry * 0.45); c.stroke(); }
            c.restore();
            break;
          }
          case 'conj_red': {            // 흰자를 붉게 곱함. 사진은 skin_marks.py 의 흰자 지도 안에만, 깜빡이면 옅어짐
            const open = 1 - Math.max(this.blinkAmt(), this.squint());
            if (open < 0.05 || !this.faceMarks()) break;
            const SC = this.photo && this.marks && this.marks.sclera;
            for (let i = 0; i < 2; i++) {
              const e = this.eyeBase(i);
              if (SC && SC[i]) {
                const bw = e.rx * SCL_BOX[0] * 2, bh = e.ry * SCL_BOX[1] * 2, t = this.sclTmp || (this.sclTmp = document.createElement('canvas'));
                t.width = Math.ceil(bw); t.height = Math.ceil(bh);
                const tg = t.getContext('2d');
                tg.fillStyle = `rgba(215,70,70,${(0.8 * A * open).toFixed(3)})`; tg.fillRect(0, 0, t.width, t.height);
                tg.globalCompositeOperation = 'destination-in'; tg.imageSmoothingEnabled = true; tg.drawImage(sclMask(SC[i]), 0, 0, t.width, t.height);
                c.save(); c.globalCompositeOperation = 'multiply'; c.drawImage(t, e.x - bw / 2, e.y - bh / 2, bw, bh); c.restore();
              } else {                  // 코드 그림 얼굴: 눈틈 타원 안
                c.save(); c.beginPath(); c.ellipse(e.x, e.y, e.rx * 0.95, e.ry * 0.85 * open, 0, 0, 7); c.clip();
                for (const sx of [-1, 1]) blob(c, e.x + sx * e.rx * 0.62, e.y, e.rx * 0.5, e.ry * 0.9, 0, rgba([215, 70, 70], 0.75 * A));
                c.restore();
              }
            }
            break;
          }
          case 'palm_red': blob(c, s.x, s.y, s.r, s.r * sq, rot, rgba([225, 60, 60], 0.42 * a)); break;
          case 'puff': this.drawPuff(c, A); break;
          case 'eczema': {              // 붉고 두꺼워진 판 + 고운 인설 + 긁은 자국
            blob(c, s.x, s.y, s.r, s.r * sq, rot, rgba([185, 80, 70], 0.5 * a));
            const rr = rng(1000 + (s.a * 1e4 | 0)); c.save();
            c.fillStyle = `rgba(255,250,240,${0.5 * A})`;
            for (let k = 0; k < 14; k++) { c.beginPath(); c.arc(s.x + (rr() - 0.5) * s.r * 1.4, s.y + (rr() - 0.5) * s.r * 1.2, Math.max(0.4, s.r * 0.05), 0, 7); c.fill(); }
            c.strokeStyle = `rgba(170,40,40,${0.6 * A})`; c.lineWidth = Math.max(0.4, s.r * 0.05);
            for (let k = 0; k < 3; k++) { const x0 = s.x + (rr() - 0.5) * s.r, y0 = s.y + (rr() - 0.5) * s.r; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + s.r * 0.5, y0 + s.r * (0.6 + rr() * 0.4)); c.stroke(); }
            c.restore();
            break;
          }
        }
      }
    });
  };
  // 눈 주위 부종: 아래눈꺼풀이 불룩(위 빛·아래 그림자), 눈이 조금 감긴 듯(liveEyes 가 this.puff 를 씀)
  SkinEngine.prototype.puffAmt = function () {
    const L = (this.lesions || []).find(q => q.type === 'puff' && q.view === this.view);
    return L ? (L.amount || 0.3) : 0;
  };
  SkinEngine.prototype.drawPuff = function (c, A) {
    const m = this.faceMarks(); if (!m) return;
    for (let i = 0; i < 2; i++) {
      const e = this.eyeBase(i);
      blob(c, e.x, e.y + e.ry * 2.7, e.rx * 1.3, e.ry * 1.7, 0, (k) => `rgba(255,246,238,${0.4 * A * k})`, 'screen');
      blob(c, e.x, e.y + e.ry * 4.4, e.rx * 1.1, e.ry * 0.6, 0, (k) => `rgba(150,95,85,${0.1 * A * k})`);
      blob(c, e.x, e.y - e.ry * 2.2, e.rx * 1.2, e.ry * 1.1, 0, (k) => `rgba(255,245,235,${0.25 * A * k})`, 'screen');
    }
  };

  // ---------------- 촉진 반응: 프리셋의 palp { 'shin:L': {tender, warm, pitting, fluct, firm, blanch}, 'shin': … }
  SkinEngine.prototype.setPalp = function (palp) { this.palp = palp || {}; };
  SkinEngine.prototype.palpAt = function (r) {
    const P = this.palp || {}, out = {};
    for (const k of ['*', r.id, r.id + ':' + r.side]) if (P[k]) Object.assign(out, P[k]);
    return out;
  };
  // 압통이 있으면: 누르고 0.25초 뒤 환자가 움찔하고(찡그림) 아프다고 말함
  SkinEngine.prototype.startPain = function () {
    const k = this.palpAt(this.pr.r).tender || 0;
    this.pain = k >= 0.5 ? { t0: this.t + 0.25, k, said: false } : null;
  };
  SkinEngine.prototype.takeSay = function () {
    const p = this.pain;
    if (!p || p.said || this.t < p.t0) return null;
    p.said = true;
    return p.k >= 0.9 ? '아악! 거기 너무 아파요!' : '아야, 거기 아파요.';
  };
  SkinEngine.prototype.squint = function () {   // 아파서 눈을 찡그림 0~1
    const p = this.pain, pr = this.pr;
    if (!p || this.t < p.t0 || !pr) return 0;
    const end = pr.t1 === null ? 1e9 : pr.t1 + 0.6;
    return this.t > end ? 0 : clamp((this.t - p.t0) / 0.12, 0, 1) * clamp((end - this.t) / 0.3, 0, 1) * (0.35 + p.k * 0.35);
  };
  // 누른 자국이 사라지는 데까지 걸리는 시간: 색(재충혈)과 함요부종 중 긴 것
  SkinEngine.prototype.afterTime = function (r) { return Math.max(this.refillTime(r), this.palpAt(r).pitting || 0); };

  // 누른 결과. feel: 손에 느껴지는 것·잰 시간(학생에게도 보임) / look: 눈으로 본 판단(정답이 될 수 있어 교수자만)
  SkinEngine.prototype.pressReport = function (r, held) {
    const s = this.s, rt = this.refillTime(r), out = { feel: '', look: '' };
    const blanch = { cheek: 1, chin: 1, hand: 1, tip: 1, chest: 1, abd: 1, knee: 1, shin: 1, ankle: 1, foot: 1, toe: 1, elbow: 1, forearm: 1 }[r.id];
    const pa = this.palpAt(r);
    if (r.id === 'eye') { out.feel = '눈은 누르지 않습니다. 눈 바로 아래(아래눈꺼풀)를 당겨 보세요.'; return out; }
    if (r.id === 'lid') {
      out.feel = '아래눈꺼풀을 당겨 안쪽(결막)을 봤습니다.';
      out.look = s.pallor > 0.35 ? '눈꺼풀 결막이 창백함' : '눈꺼풀 결막은 붉은색(정상)';
      return out;
    }
    if (r.id === 'lip') {
      out.feel = '입술을 가까이 봤습니다.';
      out.look = s.cyanosis > 0.3 ? '입술이 푸르스름함(청색증)' : s.pallor > 0.35 ? '입술이 창백함' : s.turgor > 0.4 ? '입술이 마르고 갈라짐' : '입술 색 정상';
      return out;
    }
    // 그 부위만 뜨겁거나 차가우면 전신 온도 문장은 빼고 습기만 (서로 어긋나 보이지 않게)
    const feel = [pa.warm || pa.cold ? this.touch().split(', ')[1] : this.touch()];
    if (pa.tender >= 0.9) feel.push('누르자 환자가 몹시 아파함(심한 압통)');
    else if (pa.tender >= 0.5) feel.push('누르자 환자가 아파함(압통)');
    else if (pa.tender > 0) feel.push('누르면 조금 불편해함');
    if (pa.warm) feel.push('주변보다 뜨겁게 느껴짐(국소 열감)');
    if (pa.cold) feel.push('반대쪽보다 차갑게 느껴짐');
    if (pa.itch) feel.push('환자가 가렵다고 함');
    if (pa.firm) feel.push('단단하게 만져짐');
    if (pa.fluct) feel.push('말랑하게 출렁임(파동감)');
    if (pa.pitting && held >= 1) feel.push(`눌린 자국이 약 ${pa.pitting.toFixed(1)}초 남음`);
    else if (pa.pitting) feel.push('손가락으로 조금 더 오래(2초 이상) 눌러 보세요');
    if (blanch && held >= 0.4 && pa.blanch !== false) feel.push(`누른 자리 색이 돌아오기까지 약 ${rt.toFixed(1)}초` + (r.id === 'tip' && held < 3 ? ' (손끝은 5초쯤 누른 뒤 떼세요)' : ''));
    out.feel = feel.join(' · ');
    const look = [];
    if (pa.blanch === true) look.push('붉은 병변이 누르면 하얘짐(소퇴성 홍반·발진)');
    if (pa.blanch === false) look.push('눌러도 색이 빠지지 않음(비소퇴성: 자반·멍)');
    if (pa.pitting && held >= 1) look.push(`함요부종(자국 ${pa.pitting.toFixed(1)}초)`);
    if (r.id === 'tip' && held >= 0.4) look.push(rt >= 2 ? `모세혈관 재충혈 지연(${rt.toFixed(1)}초)` : '모세혈관 재충혈 정상(2초 미만)');
    if (blanch && s.jaundice > 0.3) look.push('눌러서 핏기를 빼면 노란색이 더 뚜렷함(황달)');
    if (r.id === 'chest' && !this.photo && s.spider > 0.05 && this.pr && this.spiderNear(this.pr.x, this.pr.y))
      look.push('거미혈관종 가운데를 누르면 사라졌다가, 떼면 가운데부터 다시 붉어짐');
    out.look = look.join(' · ');
    return out;
  };

  // 검사자 손가락(파란 니트릴 장갑): 끝이 (x, y), 손가락은 ang 방향으로 화면 밖까지 이어짐.
  // press 0~1 이면 끝이 눌려 납작해지고 그림자가 붙음. two: 가운뎃손가락도 뒤에 같이 그림
  function fingerShape(c, w, L, press) {
    const tr = w * 0.55 * (1 - press * 0.22);   // 손끝 둥근 부분(눌리면 납작)
    c.beginPath(); c.moveTo(L, -w / 2 - w * 0.14); c.lineTo(tr, -w / 2);
    c.ellipse(tr, 0, tr, w / 2, 0, -Math.PI / 2, Math.PI / 2, true);
    c.lineTo(L, w / 2 + w * 0.14); c.closePath();
  }
  function fingerBody(c, w, L, press, dark) {
    const g = c.createLinearGradient(0, -w * 0.62, 0, w * 0.62);
    const k = dark ? 0.86 : 1, col = (r, gg, b) => `rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`;
    g.addColorStop(0, col(58, 88, 150)); g.addColorStop(0.28, col(132, 164, 222)); g.addColorStop(0.5, col(118, 152, 214));
    g.addColorStop(0.8, col(80, 114, 182)); g.addColorStop(1, col(48, 74, 132));
    c.fillStyle = g; fingerShape(c, w, L, press); c.fill();
    c.strokeStyle = 'rgba(20,35,70,0.28)'; c.lineWidth = Math.max(0.6, w * 0.025); c.stroke();
    c.save(); fingerShape(c, w, L, press); c.clip();
    c.strokeStyle = 'rgba(30,50,95,0.22)'; c.lineWidth = Math.max(0.5, w * 0.02);   // 첫마디 주름
    for (const dx of [-0.05, 0.06]) { c.beginPath(); c.moveTo(w * (1.55 + dx), -w * 0.45); c.quadraticCurveTo(w * (1.62 + dx), 0, w * (1.55 + dx), w * 0.45); c.stroke(); }
    c.fillStyle = 'rgba(235,245,255,0.28)'; c.filter = `blur(${(w * 0.06).toFixed(1)}px)`;   // 장갑 반사
    c.beginPath(); c.ellipse(L * 0.32, -w * 0.2, L * 0.3, w * 0.07, 0, 0, 7); c.fill();
    c.restore();
  }
  function drawFinger(c, x, y, sz, press, ang, two) {
    const w = sz, L = sz * 14;
    c.save(); c.translate(x, y); c.rotate(ang);
    c.save(); c.filter = `blur(${(sz * 0.22).toFixed(1)}px)`;      // 그림자: 닿을수록 손가락 바로 밑으로 모임
    c.fillStyle = `rgba(25,15,15,${0.18 + press * 0.12})`;
    c.translate(w * 0.15 + (1 - press) * w * 0.35, w * 0.25 + (1 - press) * w * 0.4);
    fingerShape(c, w * 1.05, L, press); c.fill();
    if (two) { c.translate(w * 0.6, w * 1.05); fingerShape(c, w * 1.05, L, 0); c.fill(); }
    c.restore();
    if (two) { c.save(); c.translate(w * 0.6, w * 1.02); fingerBody(c, w * 1.02, L, 0, true); c.restore(); }
    fingerBody(c, w, L, press, false);
    c.restore();
  }
  // 눌렀다 뗀 자리가 하얗게(핏기 없이) 됐다가 refillTime 동안 돌아옴. 핏기를 빼면 황달·과색소는 남는다
  SkinEngine.prototype.blanchSpot = function (c, x, y, rad, a) {
    const s = this.s, bl = tint(this.base, { jaundice: s.jaundice, bronze: s.bronze, pallor: 0.7 }, 'skin');
    const spot = (op, color) => {
      const g = c.createRadialGradient(x, y, rad * 0.1, x, y, rad);
      g.addColorStop(0, color(a)); g.addColorStop(0.55, color(a * 0.85)); g.addColorStop(1, color(0));
      c.save(); c.globalCompositeOperation = op; c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); c.restore();
    };
    spot('color', (k) => rgb(bl, 0.6 * k));          // 핏기 뺀 색(황달이면 노란색이 남음)
    spot('screen', (k) => `rgba(255,246,238,${0.45 * k})`);
  };
  // 아래눈꺼풀을 당겨 보이는 결막(눈꺼풀 안쪽). 정상은 붉고, 빈혈(창백)이면 하얗게
  SkinEngine.prototype.drawConj = function (c, i, pull) {
    const e = this.eyeBase(i), s = this.s, rx = e.rx * 1.05, top = e.y + e.ry * 1.3, d = e.ry * 1.6 * pull;
    let col = mix([184, 74, 76], [228, 200, 192], clamp(s.pallor * 1.1, 0, 0.92));
    if (s.cyanosis) col = mix(col, [140, 90, 140], s.cyanosis * 0.3);
    const shape = () => {
      c.beginPath(); c.moveTo(e.x - rx, top - e.ry * 0.25);
      c.quadraticCurveTo(e.x, top + e.ry * 0.25, e.x + rx, top - e.ry * 0.25);
      c.bezierCurveTo(e.x + rx * 0.7, top + d * 0.9, e.x + rx * 0.3, top + d * 1.1, e.x, top + d * 1.1);
      c.bezierCurveTo(e.x - rx * 0.3, top + d * 1.1, e.x - rx * 0.7, top + d * 0.9, e.x - rx, top - e.ry * 0.25); c.closePath();
    };
    // 아래눈꺼풀 피부가 당겨진 그림자
    c.save(); c.filter = `blur(${(e.ry * 0.35).toFixed(1)}px)`; c.fillStyle = `rgba(90,45,40,${0.25 * pull})`;
    c.beginPath(); c.ellipse(e.x, top + d * 1.15, rx * 0.9, e.ry * 0.5, 0, 0, 7); c.fill(); c.restore();
    c.save(); shape(); c.clip();
    const g = c.createLinearGradient(0, top - e.ry * 0.2, 0, top + d * 1.1);
    g.addColorStop(0, rgb(mix(col, [250, 236, 230], 0.35))); g.addColorStop(0.45, rgb(col)); g.addColorStop(1, rgb(shade(col, 0.82)));
    c.fillStyle = g; c.fillRect(e.x - rx, top - e.ry, rx * 2, d * 1.3 + e.ry * 1.2);
    const rr = rng(91 + i);                              // 가는 혈관
    c.strokeStyle = rgb(shade(col, 0.7), 0.45 * (1 - s.pallor * 0.6)); c.lineWidth = Math.max(0.3, e.ry * 0.04);
    for (let k = 0; k < 12; k++) { const x0 = e.x - rx * 0.85 + rr() * rx * 1.7; c.beginPath(); c.moveTo(x0, top + d * 1.05); c.quadraticCurveTo(x0 + (rr() - 0.5) * rx * 0.3, top + d * 0.6, x0 + (rr() - 0.5) * rx * 0.4, top + d * 0.15); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.filter = `blur(${(e.ry * 0.08).toFixed(1)}px)`;   // 젖은 반사
    c.beginPath(); c.ellipse(e.x - rx * 0.2, top + d * 0.4, rx * 0.4, d * 0.07, -0.05, 0, 7); c.fill();
    c.restore();
  };
  // 검사자 손가락 굵기(기본 좌표): 사진 속 환자 크기에 맞춤 (손가락 끝 ≈ 1.6cm)
  SkinEngine.prototype.fingerSize = function () {
    const k = { face: 0.042, hands: 0.07, trunk: 0.05, legs: 0.05, arms: 0.05 }[this.view] || 0.05;
    return this.photo ? this.layout().w * k : { face: 44, hands: 40, trunk: 44, legs: 30, arms: 30 }[this.view] || 44;
  };
  SkinEngine.prototype.drawPress = function (c) {
    const p = this.pr; if (!p) return;
    const t = this.t, held = p.t1 === null, sz = this.fingerSize(), hold = (held ? t : p.t1) - p.t0;
    if (p.r.id === 'eye' || p.r.id === 'lip') return;            // 가까이 보기만
    if (p.r.id === 'lid') {
      const pull = held ? clamp(hold / 0.3, 0, 1) : clamp(1 - (t - p.t1) / 0.25, 0, 1);
      if (pull <= 0) return;
      const e = this.eyeBase(p.r.eye), side = p.r.eye ? -1 : 1;
      this.drawConj(c, p.r.eye, pull);
      // 손가락 끝 볼록한 면으로 눈 아래 피부를 아래로 당김 (손가락은 아래쪽 바깥에서 들어옴)
      drawFinger(c, e.x - side * e.rx * 0.15, e.y + e.ry * (2.2 + 1.6 * pull), sz, 0.7, Math.PI / 2 + side * 0.45);
      return;
    }
    if (held) {
      const k = clamp(hold / 0.25, 0, 1);
      // 눌린 자리 둘레가 살짝 꺼지는 그림자
      const g = c.createRadialGradient(p.x, p.y, sz * 0.4, p.x, p.y, sz * 1.1);
      g.addColorStop(0, `rgba(90,50,40,${0.2 * k})`); g.addColorStop(1, 'rgba(90,50,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, sz * 1.1, 0, 7); c.fill();
      drawFinger(c, p.x - sz * 0.1, p.y - sz * 0.05, sz, k, 0.95, true);
    } else if (hold >= 0.4) {
      const pa = this.palpAt(p.r), k = (t - p.t1) / this.refillTime(p.r);
      const weak = pa.blanch === false ? 0.25 : 1;          // 자반·멍: 눌러도 색이 거의 안 빠짐
      if (k < 1) this.blanchSpot(c, p.x, p.y, sz * 0.62, Math.pow(1 - k, 1.2) * clamp(hold / 1.5, 0.5, 1) * weak);
      if (pa.pitting && hold >= 1) {                       // 함요부종: 손가락 모양으로 오목한 자국이 천천히 차오름
        const kp = clamp((t - p.t1) / pa.pitting, 0, 1), a = Math.pow(1 - kp, 0.8);
        if (a > 0.01) {
          const R = sz * 0.6;
          let g = c.createRadialGradient(p.x, p.y - R * 0.35, R * 0.1, p.x, p.y, R);
          g.addColorStop(0, `rgba(70,40,30,${0.38 * a})`); g.addColorStop(0.6, `rgba(70,40,30,${0.16 * a})`); g.addColorStop(1, 'rgba(70,40,30,0)');
          c.fillStyle = g; c.beginPath(); c.ellipse(p.x, p.y, R, R * 0.85, 0, 0, 7); c.fill();
          g = c.createRadialGradient(p.x, p.y + R * 0.55, R * 0.05, p.x, p.y + R * 0.4, R * 0.7);   // 아래쪽 가장자리 빛
          g.addColorStop(0, `rgba(255,240,228,${0.3 * a})`); g.addColorStop(1, 'rgba(255,240,228,0)');
          c.fillStyle = g; c.beginPath(); c.ellipse(p.x, p.y + R * 0.4, R * 0.7, R * 0.35, 0, 0, 7); c.fill();
        }
      }
    }
  };
  // 화면 위 글씨(카메라 확대와 관계없이 그대로)
  SkinEngine.prototype.setMissing = function (msg) { this.missing = msg || ''; };
  SkinEngine.prototype.drawHud = function (c) {
    const p = this.pr;
    if (this.missing) {
      c.fillStyle = 'rgba(12,16,18,0.72)'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center';
      this.missing.split('\n').forEach((ln, i) => c.fillText(ln, W / 2, H / 2 - 10 + i * 36));
      return;
    }
    let label = this._label;
    if (p && !label && !{ eye: 1, lid: 1, lip: 1 }[p.r.id]) {
      const t = this.t;
      if (p.t1 === null) label = `${p.r.name} 누르는 중 ${(t - p.t0).toFixed(1)}초` + (p.r.id === 'tip' ? ' (5초쯤 누르고 떼기)' : '');
      else if (t - p.t1 < this.afterTime(p.r) + 1.2 && p.t1 - p.t0 >= 0.4) label = `뗀 뒤 ${Math.min(t - p.t1, 9.9).toFixed(1)}초`;
    }
    if (this.photo) { c.font = '13px sans-serif'; c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText('AI 생성 이미지', 14, H - 14); }
    if (label) {
      c.font = 'bold 26px sans-serif'; c.textAlign = 'left';
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(24, 18, c.measureText(label).width + 32, 46);
      c.fillStyle = '#fff'; c.fillText(label, 40, 50);
    }
    const h = this.hover;
    if (h && !(p && p.t1 === null)) {   // 마우스가 올라간 부위 이름
      c.font = 'bold 17px sans-serif'; const tw = c.measureText(h.name).width;
      const bx = Math.min(h.x + 18, W - tw - 24), by = Math.max(h.y - 40, 8);
      c.fillStyle = 'rgba(13,107,99,0.9)'; c.fillRect(bx, by, tw + 18, 28);
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(h.name, bx + 9, by + 20);
    }
  };

  // 땀방울 + 번들거림
  SkinEngine.prototype.sweatLayer = function (c, x, y, w, h, seed) {
    const s = this.s.sweat; if (s < 0.05) return;
    const r = rng(seed), n = Math.round(s * 40);
    for (let i = 0; i < n; i++) {
      const px = x + r() * w, py = y + r() * h, rr = 2 + r() * 4 * s;
      const g = c.createRadialGradient(px - rr * 0.3, py - rr * 0.4, 0, px, py, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(px, py, rr, rr * 1.2, 0, 0, 7); c.fill();
    }
  };

  // 색 얼룩 질감(모공·피부결 느낌)
  function mottle(c, x, y, w, h, col, seed, amt) {
    const r = rng(seed);
    for (let i = 0; i < 160; i++) {
      const px = x + r() * w, py = y + r() * h, rr = 6 + r() * 22;
      c.fillStyle = rgb(shade(col, 0.95 + r() * 0.08), amt * 0.4);
      c.beginPath(); c.arc(px, py, rr, 0, 7); c.fill();
    }
  }

  // ---------------------------------------------------------- 얼굴
  SkinEngine.prototype.draw_face = function (c) {
    const s = this.s, sk = tint(this.base, s, 'skin'), ck = tint(this.base, s, 'cheek');
    const cx = 600, cy = 320;
    // 목
    c.fillStyle = rgb(shade(sk, 0.88)); c.fillRect(cx - 95, cy + 170, 190, 160);
    // 얼굴형
    c.save(); c.beginPath(); c.ellipse(cx, cy, 215, 265, 0, 0, 7); c.clip();
    c.fillStyle = rgb(sk); c.fillRect(cx - 230, cy - 280, 460, 560);
    mottle(c, cx - 220, cy - 270, 440, 540, sk, 7, 0.25);
    // 볼(홍조는 볼에서 가장 진함)
    for (const d of [-1, 1]) {
      const g = c.createRadialGradient(cx + d * 120, cy + 60, 10, cx + d * 120, cy + 60, 120);
      g.addColorStop(0, rgb(ck, 0.25 + s.flush * 0.6)); g.addColorStop(1, rgb(ck, 0));
      c.fillStyle = g; c.fillRect(cx - 230, cy - 280, 460, 560);
    }
    // 가장자리 음영
    const sh = c.createRadialGradient(cx, cy - 20, 150, cx, cy, 290);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,30,20,0.35)');
    c.fillStyle = sh; c.fillRect(cx - 230, cy - 280, 460, 560);
    this.sweatLayer(c, cx - 170, cy - 220, 340, 160, 31);    // 이마
    this.sweatLayer(c, cx - 160, cy + 20, 320, 120, 37);     // 볼·윗입술
    c.restore();
    // 머리카락
    c.fillStyle = '#2b211c'; c.beginPath(); c.ellipse(cx, cy + 5, 228, 282, 0, Math.PI * 1.08, Math.PI * 1.92);
    c.quadraticCurveTo(cx + 150, cy - 190, cx, cy - 175); c.quadraticCurveTo(cx - 150, cy - 190, cx + Math.cos(Math.PI * 1.08) * 228, cy + 5 + Math.sin(Math.PI * 1.08) * 282); c.fill();
    // 눈(간단히: 자세한 눈은 눈 모듈 담당) — 공막은 황달이면 노랗게
    const scl = mix([245, 243, 238], [222, 196, 90], s.jaundice * 0.7), b = Math.max(this.blinkAmt(), this.squint(), this.puffAmt());
    for (const d of [-1, 1]) {
      const ex = cx + d * 85, ey = cy - 30, gx = this.gaze[0] * 8, gy = this.gaze[1] * 3;
      c.save(); c.fillStyle = rgb(scl); c.beginPath(); c.ellipse(ex, ey, 42, 17, 0, 0, 7); c.fill(); c.clip();
      c.fillStyle = '#4a3326'; c.beginPath(); c.arc(ex + gx, ey + gy, 14, 0, 7); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.arc(ex + gx, ey + gy, 6, 0, 7); c.fill();
      if (b > 0.01) { c.fillStyle = rgb(shade(sk, 0.93)); c.fillRect(ex - 44, ey - 18, 88, 36 * b); }   // 깜빡임: 윗눈꺼풀이 내려옴
      c.restore();
      c.strokeStyle = 'rgba(40,25,20,0.8)'; c.lineWidth = 3; c.beginPath();
      if (b > 0.01) { c.moveTo(ex - 42, ey); c.quadraticCurveTo(ex, ey - 34 + 68 * b, ex + 42, ey); } else c.ellipse(ex, ey, 42, 17, 0, Math.PI, 0);
      c.stroke();
      c.strokeStyle = '#3a2a22'; c.lineWidth = 7; c.beginPath(); c.moveTo(ex - 45, ey - 42); c.quadraticCurveTo(ex, ey - 55, ex + 45, ey - 42); c.stroke();
    }
    // 코
    c.strokeStyle = rgb(shade(sk, 0.7)); c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx - 8, cy - 10); c.quadraticCurveTo(cx - 30, cy + 60, cx - 22, cy + 70); c.quadraticCurveTo(cx, cy + 82, cx + 22, cy + 70); c.stroke();
    // 입술: 창백·청색증이 가장 잘 보이는 곳
    const lip = tint(LIP, s, 'lip'), ly = cy + 140;
    c.fillStyle = rgb(lip); c.beginPath();
    c.moveTo(cx - 70, ly); c.quadraticCurveTo(cx - 35, ly - 26, cx, ly - 14); c.quadraticCurveTo(cx + 35, ly - 26, cx + 70, ly);
    c.quadraticCurveTo(cx, ly + 36, cx - 70, ly); c.fill();
    c.strokeStyle = rgb(shade(lip, 0.65)); c.lineWidth = 2.5; c.beginPath(); c.moveTo(cx - 68, ly); c.quadraticCurveTo(cx, ly + 6, cx + 68, ly); c.stroke();
    if (s.turgor > 0.3) {         // 탈수: 입술 갈라짐
      c.strokeStyle = rgb(shade(lip, 0.55), s.turgor); c.lineWidth = 1.2;
      for (let i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(cx + i * 14, ly - 12); c.lineTo(cx + i * 14 + 3, ly + 10); c.stroke(); }
    }
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.ellipse(cx - 20, ly + 12, 22, 5, 0, 0, 7); c.fill();
  };

  // ---------------------------------------------------------- 손(손등 + 손바닥)
  function handPath(c, x, y, k) {    // 손가락 4개 + 엄지, 손목은 아래쪽
    c.beginPath();
    c.moveTo(x - 95 * k, y + 230 * k);
    c.lineTo(x - 105 * k, y + 40 * k);
    const fingers = [[-78, -150, 30], [-27, -185, 31], [24, -175, 30], [70, -130, 27]];
    for (const [fx, fy, fw] of fingers) {
      c.lineTo(x + (fx - fw / 2) * k, y + 10 * k);
      c.lineTo(x + (fx - fw / 2) * k, y + fy * k);
      c.arc(x + fx * k, y + fy * k, fw / 2 * k, Math.PI, 0);
      c.lineTo(x + (fx + fw / 2) * k, y + 10 * k);
    }
    c.lineTo(x + 100 * k, y + 50 * k);
    c.lineTo(x + 165 * k, y - 25 * k); c.arc(x + 178 * k, y - 10 * k, 18 * k, -2.4, 0.7); c.lineTo(x + 105 * k, y + 130 * k);
    c.lineTo(x + 95 * k, y + 230 * k); c.closePath();
  }
  const FINGERS = [[-78, -150, 30], [-27, -185, 31], [24, -175, 30], [70, -130, 27], [178, -10, 34]];

  SkinEngine.prototype.draw_hands = function (c) {
    const s = this.s;
    // 왼쪽: 손등(손톱 보이게), 오른쪽: 손바닥
    for (const side of ['back', 'palm']) {
      const x = side === 'back' ? 330 : 870, y = 300, k = 1.15;
      const sk = tint(this.base, s, side === 'back' ? 'skin' : 'palm');
      c.save(); handPath(c, x, y, k); c.clip();
      c.fillStyle = rgb(side === 'palm' ? mix(sk, [236, 170, 160], 0.25) : sk); c.fillRect(x - 160, y - 260, 420, 560);
      mottle(c, x - 140, y - 240, 400, 520, sk, side === 'back' ? 11 : 13, 0.22);
      // 손끝: 청색증은 손끝에서 가장 진함
      for (const [fx, fy] of FINGERS) {
        const g = c.createRadialGradient(x + fx * k, y + fy * k, 0, x + fx * k, y + fy * k, 60 * k);
        g.addColorStop(0, rgb([96, 92, 160], s.cyanosis * 0.6)); g.addColorStop(1, 'rgba(96,92,160,0)');
        c.fillStyle = g; c.fillRect(x - 160, y - 260, 420, 560);
      }
      if (side === 'palm') {
        // 손바닥 홍반: 엄지·새끼 두덩(thenar/hypothenar)이 붉음
        for (const [px, py, rr] of [[110, 90, 80], [-70, 120, 75]]) {
          const g = c.createRadialGradient(x + px * k, y + py * k, 5, x + px * k, y + py * k, rr * k);
          g.addColorStop(0, `rgba(205,55,60,${s.palmar * 0.6})`); g.addColorStop(1, 'rgba(205,55,60,0)');
          c.fillStyle = g; c.fillRect(x - 160, y - 260, 420, 560);
        }
        // 손금: 창백하면 흐려지고, 과색소침착이면 짙어짐
        const cr = tint(shade(this.base, 0.72), s, 'crease');
        c.strokeStyle = rgb(cr, clamp(0.75 - s.pallor * 0.6 + s.bronze * 0.25, 0.1, 1)); c.lineWidth = 3 + s.bronze * 2.5;
        c.beginPath(); c.moveTo(x - 100 * k, y + 20 * k); c.quadraticCurveTo(x, y + 40 * k, x + 100 * k, y + 0 * k); c.stroke();
        c.beginPath(); c.moveTo(x - 100 * k, y + 60 * k); c.quadraticCurveTo(x - 10 * k, y + 50 * k, x + 70 * k, y + 80 * k); c.stroke();
        c.beginPath(); c.moveTo(x + 100 * k, y + 20 * k); c.quadraticCurveTo(x + 40 * k, y + 110 * k, x + 70 * k, y + 220 * k); c.stroke();
      } else {
        // 손등: 손가락 관절 주름 + 손톱
        c.strokeStyle = rgb(tint(shade(this.base, 0.75), s, 'crease'), 0.6); c.lineWidth = 2;
        for (const [fx, fy, fw] of FINGERS.slice(0, 4)) for (const yy of [fy + 70, fy + 120]) {
          c.beginPath(); c.moveTo(x + (fx - fw / 3) * k, y + yy * k); c.quadraticCurveTo(x + fx * k, y + (yy + 4) * k, x + (fx + fw / 3) * k, y + yy * k); c.stroke();
        }
        const nail = tint(NAIL, s, 'nail');
        for (const [fx, fy, fw] of FINGERS) {
          c.fillStyle = rgb(nail); c.strokeStyle = rgb(shade(nail, 0.7));
          c.beginPath(); c.ellipse(x + fx * k, y + (fy + 8) * k, fw * 0.36 * k, fw * 0.5 * k, 0, 0, 7); c.fill(); c.stroke();
          c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(x + fx * k, y + (fy + 20) * k, fw * 0.22 * k, fw * 0.12 * k, 0, 0, 7); c.fill();
        }
      }
      this.sweatLayer(c, x - 120, y - 150, 300, 300, side === 'back' ? 41 : 43);
      c.restore();
      c.strokeStyle = rgb(shade(sk, 0.6)); c.lineWidth = 2; handPath(c, x, y, k); c.stroke();
      c.fillStyle = '#334'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center';
      c.fillText(side === 'back' ? '손등' : '손바닥', x + 40, 585);
    }
  };

  // ---------------------------------------------------------- 몸통(앞가슴 + 배)
  // 거미혈관종 위치 [x, y, 다리 길이, 다리 각도들] (rng 고정이라 매번 같은 자리)
  SkinEngine.prototype.spiders = function () {
    const r = rng(53), n = Math.round(1 + this.s.spider * 6), out = [];
    for (let i = 0; i < n; i++) {
      const px = 400 + r() * 400, py = 70 + r() * 100, len = 10 + r() * 10, legs = [];
      for (let j = 0; j < 9; j++) legs.push(j / 9 * 6.28 + r() * 0.4);
      out.push([px, py, len, legs]);
    }
    return out;
  };
  SkinEngine.prototype.spiderNear = function (x, y) { return this.spiders().some(([px, py]) => Math.hypot(px - x, py - y) < 26); };
  SkinEngine.prototype.draw_trunk = function (c) {
    const s = this.s, sk = tint(this.base, s, 'skin');
    const cx = 600;
    c.save(); c.beginPath();
    c.moveTo(cx - 260, 0); c.lineTo(cx + 260, 0); c.quadraticCurveTo(cx + 230, 300, cx + 250, 600); c.lineTo(cx - 250, 600); c.quadraticCurveTo(cx - 230, 300, cx - 260, 0); c.clip();
    c.fillStyle = rgb(sk); c.fillRect(0, 0, W, H);
    mottle(c, cx - 260, 0, 520, 600, sk, 17, 0.22);
    const sh = c.createLinearGradient(cx - 260, 0, cx + 260, 0);
    sh.addColorStop(0, 'rgba(60,30,20,0.35)'); sh.addColorStop(0.2, 'rgba(0,0,0,0)'); sh.addColorStop(0.8, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,30,20,0.35)');
    c.fillStyle = sh; c.fillRect(0, 0, W, H);
    // 쇄골·유두·배꼽 (위치 기준점)
    c.strokeStyle = rgb(shade(sk, 0.75)); c.lineWidth = 3;
    for (const d of [-1, 1]) { c.beginPath(); c.moveTo(cx + d * 20, 40); c.quadraticCurveTo(cx + d * 120, 25, cx + d * 220, 50); c.stroke(); }
    c.fillStyle = rgb(mix(shade(sk, 0.75), [150, 90, 80], 0.3 + s.bronze * 0.4));
    for (const d of [-1, 1]) { c.beginPath(); c.arc(cx + d * 130, 200, 9, 0, 7); c.fill(); }
    c.fillStyle = rgb(shade(sk, 0.6)); c.beginPath(); c.ellipse(cx, 470, 9, 13, 0, 0, 7); c.fill();
    // 거미혈관종: 가운데 붉은 점 + 바퀴살처럼 뻗는 가는 혈관 (앞가슴·어깨)
    // 가운데를 누르면 사라지고(혈관이 비워짐), 떼면 가운데부터 바깥으로 다시 채워진다
    if (s.spider > 0.05) {
      const pr = this.pr;
      for (const [px, py, len, legs] of this.spiders()) {
        let k = 1;
        if (pr && Math.hypot(pr.x - px, pr.y - py) < 26) k = pr.t1 === null ? 0 : clamp((this.t - pr.t1) / 0.8, 0, 1);
        if (k <= 0) continue;
        c.strokeStyle = 'rgba(190,40,45,0.75)'; c.lineWidth = 1.2;
        for (const a of legs) {
          const L = len * k;
          c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(a + 0.3) * L * 0.5, py + Math.sin(a + 0.3) * L * 0.5, px + Math.cos(a) * L, py + Math.sin(a) * L); c.stroke();
        }
        c.fillStyle = 'rgb(200,35,40)'; c.beginPath(); c.arc(px, py, 3, 0, 7); c.fill();
      }
    }
    // 보라색 선조: 옆구리·아랫배에 폭넓은 세로 줄무늬
    if (s.striae > 0.05) {
      for (const d of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x0 = cx + d * (130 + i * 22), y0 = 330 + i * 12;
        c.strokeStyle = `rgba(140,50,110,${0.25 + s.striae * 0.45})`; c.lineWidth = 6 + s.striae * 6; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 - d * 30, y0 + 90, x0 - d * 70, y0 + 170); c.stroke();
      }
    }
    // 멍: 자색~황록색 반점
    if (s.bruise > 0.05) {
      const r = rng(61), n = Math.round(s.bruise * 5);
      for (let i = 0; i < n; i++) {
        const px = cx - 200 + r() * 400, py = 240 + r() * 300, rr = 25 + r() * 30;
        const g = c.createRadialGradient(px, py, 3, px, py, rr);
        g.addColorStop(0, 'rgba(95,55,110,0.6)'); g.addColorStop(0.7, 'rgba(120,120,70,0.3)'); g.addColorStop(1, 'rgba(120,120,70,0)');
        c.fillStyle = g; c.beginPath(); c.ellipse(px, py, rr, rr * 0.75, r() * 3, 0, 7); c.fill();
      }
    }
    this.sweatLayer(c, cx - 220, 60, 440, 300, 67);
    c.restore();
  };

  // ---------------------------------------------------------- 다리(무릎~발)·팔 (코드 그림: 사진과 같은 구도, 가운데 정사각형)
  SkinEngine.prototype.draw_legs = function (c) {
    const s = this.s, sk = tint(this.base, s, 'skin'), r = this.layout(), X = (u) => r.x + u * r.w, Y = (v) => r.y + v * r.h;
    c.fillStyle = '#9fb7d8'; c.fillRect(X(0.25), Y(0), r.w * 0.5, r.h * 0.06);            // 반바지
    for (const cu of [0.38, 0.62]) {
      const d = cu < 0.5 ? 1 : -1;      // 엄지발가락 쪽(가운데)
      c.fillStyle = rgb(sk); c.strokeStyle = rgb(shade(sk, 0.7)); c.lineWidth = 2;
      c.beginPath(); c.ellipse(X(cu + d * 0.01), Y(0.85), r.w * 0.065, r.h * 0.075, 0, 0, 7); c.fill(); c.stroke();   // 발
      c.beginPath();
      c.moveTo(X(cu - 0.075), Y(0.04)); c.quadraticCurveTo(X(cu - 0.085), Y(0.4), X(cu - 0.045), Y(0.74)); c.lineTo(X(cu - 0.05), Y(0.82));
      c.lineTo(X(cu + 0.05), Y(0.82)); c.lineTo(X(cu + 0.045), Y(0.74));
      c.quadraticCurveTo(X(cu + 0.085), Y(0.4), X(cu + 0.075), Y(0.04)); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = rgb(shade(sk, 0.88)); c.beginPath(); c.ellipse(X(cu), Y(0.14), r.w * 0.05, r.h * 0.05, 0, 0, 7); c.fill();   // 무릎
    }
    c.save(); c.clip(this.skinClip());      // 피부결·땀이 다리 밖으로 새지 않게
    mottle(c, X(0.28), Y(0.04), r.w * 0.44, r.h * 0.88, sk, 81, 0.15);
    this.sweatLayer(c, X(0.3), Y(0.1), r.w * 0.4, r.h * 0.6, 83);
    c.restore();
  };
  SkinEngine.prototype.draw_arms = function (c) {
    const s = this.s, sk = tint(this.base, s, 'skin'), r = this.layout(), X = (u) => r.x + u * r.w, Y = (v) => r.y + v * r.h;
    for (const [eu, ev] of CODE_ELBOWS) {
      c.fillStyle = rgb(sk); c.beginPath();
      c.moveTo(X(eu - 0.06), Y(0.85)); c.lineTo(X(eu - 0.065), Y(ev)); c.quadraticCurveTo(X(eu - 0.05), Y(0.3), X(eu - 0.045), Y(0.12));
      c.quadraticCurveTo(X(eu), Y(0.06), X(eu + 0.045), Y(0.12)); c.quadraticCurveTo(X(eu + 0.05), Y(0.3), X(eu + 0.065), Y(ev));
      c.lineTo(X(eu + 0.06), Y(0.85)); c.closePath(); c.fill();
      c.strokeStyle = rgb(shade(sk, 0.7)); c.lineWidth = 2; c.stroke();
      c.fillStyle = rgb(shade(sk, 0.85)); c.beginPath(); c.ellipse(X(eu), Y(ev), r.w * 0.035, r.h * 0.03, 0, 0, 7); c.fill();   // 팔꿈치
      c.fillStyle = '#9fb7d8'; c.fillRect(X(eu - 0.08), Y(0.84), r.w * 0.16, r.h * 0.16);   // 소매
    }
  };

  // ---------------------------------------------------------- 피부 긴장도(손등을 꼬집었다 놓기)
  // 0~1초: 집어 올림, 1~1.6초: 유지, 1.6초에 놓음 → recoilTime 동안 천천히 펴짐
  SkinEngine.prototype.pinchHeight = function (t) {
    if (t < 1) return t;
    if (t < 1.6) return 1;
    const r = (t - 1.6) / this.recoilTime();
    return r >= 1 ? 0 : Math.pow(1 - r, 1.6);
  };
  SkinEngine.prototype.draw_pinch = function (c) {
    const s = this.s, t = this.t, sk = tint(this.base, s, 'skin');
    const h = this.pinchHeight(t), held = t < 1.6;
    const top = 330, cx = 600;
    // 손등 단면(옆에서 본 모습)
    const peak = top - 150 * h;
    const shape = () => { c.beginPath(); c.moveTo(80, H); c.lineTo(80, top + 20); c.quadraticCurveTo(300, top - 10, cx - 140, top);
    c.quadraticCurveTo(cx - 40, top, cx - 22 * (1 - h * 0.4), peak + 20); c.quadraticCurveTo(cx, peak - 10, cx + 22 * (1 - h * 0.4), peak + 20);
    c.quadraticCurveTo(cx + 40, top, cx + 140, top); c.quadraticCurveTo(900, top - 10, 1120, top + 20); c.lineTo(1120, H); c.closePath(); };
    c.save(); shape(); c.clip(); c.fillStyle = rgb(shade(sk, 0.95)); c.fillRect(0, 0, W, H);
    mottle(c, 80, top - 160, 1040, 440, sk, 71, 0.2); this.sweatLayer(c, 100, top - 40, 1000, 200, 73); c.restore();
    shape(); c.strokeStyle = rgb(shade(sk, 0.65)); c.lineWidth = 2.5; c.stroke();
    if (h > 0.05) {   // 접힌 주름
      c.strokeStyle = rgb(shade(sk, 0.6), h); c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx, peak + 8); c.lineTo(cx, top - 5); c.stroke();
    }
    // 검사자 손가락(엄지·검지): 집는 동안만
    if (held) {
      for (const d of [-1, 1]) {
        const fx = cx + d * (60 - 34 * Math.min(t, 1)), fy = peak + 40;
        c.fillStyle = '#e9c3a8'; c.strokeStyle = '#a77d64'; c.lineWidth = 2;
        c.beginPath(); c.ellipse(fx + d * 40, fy - 70, 34, 110, d * -0.35, 0, 7); c.fill(); c.stroke();
      }
    }
    // 시간 표시(놓은 뒤 몇 초인지): 학생이 직접 '2초 이상'을 판단하게
    c.fillStyle = '#223'; c.font = 'bold 26px sans-serif'; c.textAlign = 'left';
    c.fillText(held ? '손등 피부를 집어 올리는 중…' : `놓은 뒤 ${Math.min(t - 1.6, 9.9).toFixed(1)}초`, 40, 50);
  };

  global.SkinEngine = SkinEngine;
})(typeof window !== 'undefined' ? window : globalThis);
