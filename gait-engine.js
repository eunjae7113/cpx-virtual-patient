/* 보행 진찰 엔진 (Canvas 2D, 외부 라이브러리 없음)
 * 환자 몸을 간단한 3D 뼈대(x 앞, y 위, z 좌우: 환자 왼쪽 +)로 계산하고, '옆에서 보기'(환자 오른쪽이 보임)와
 * '앞에서 보기'(환자가 다가옴, 환자 오른쪽 = 화면 왼쪽)로 그린다.
 * 걸음: 정상 보행의 엉덩·무릎·발목 각도 곡선(보행 주기 10% 간격)에 질환별 파라미터를 입힘. 디딘 발을 바닥에 고정해 몸을 앞으로 옮김(미끄러짐 없음)
 * 검사: walk 걸음걸이 / heel 발뒤꿈치 보행 / toe 발끝 보행 / romberg (발 모으고 눈 뜨고 → 눈 감고) / tandem 일자 보행
 *       앉아서 하는 협조운동(가까이 비스듬히 봄): fnt finger to nose / hts heel to shin / ram 빠른 교대운동 / drift pronator drift
 * 파라미터는 tools/gait_presets.py 의 프리셋(g). 모든 값 0이면 정상.
 */
(function () {
  'use strict';
  const W = 1200, H = 600;
  const D2R = Math.PI / 180;
  // 보행 주기(오른발 뒤꿈치 닿음 = 0) 10% 간격 관절 각도(도). 엉덩: 앞으로 +, 무릎: 굽힘 +, 발목: 발등 굽힘 +. 입박 0~0.6, 흔듦 0.6~1
  const HIP = [20, 17, 8, -2, -10, -17, -14, 0, 15, 22, 20];      // 허벅지-수직 각도(골반 앞기울기를 뺀 값)
  const KNEE = [4, 16, 14, 8, 4, 8, 38, 62, 52, 22, 4];
  const ANK = [0, -6, 4, 8, 10, 6, -16, -8, 0, 2, 0];
  function curve(K, p) {           // 주기 곡선을 부드럽게(Catmull-Rom) 읽기
    p = ((p % 1) + 1) % 1; const f = p * 10, i = Math.floor(f), t = f - i;
    const a = K[(i + 9) % 10], b = K[i], c = K[i + 1], d = K[(i + 2) % 10 === 0 ? 10 : (i + 2) % 10];
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // 3차원 벡터
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const ease = (u) => u * u * (3 - 2 * u);
  const hr = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };   // 정수 → 0~1 (매번 같은 값)
  // 팔: 어깨 S 에서 손끝 T 로. 위팔 a, 아래팔+손 b, 팔꿈치는 pole 쪽으로 굽힘
  function ik3(S, T, a, b, pole) {
    let d = sub(T, S), dl = Math.hypot(d[0], d[1], d[2]);
    const mx = (a + b) * 0.998, mn = Math.abs(a - b) + 1e-3;
    if (dl > mx) { T = add(S, mul(d, mx / dl)); d = sub(T, S); dl = mx; }
    if (dl < mn) { T = add(S, mul(d, mn / (dl || 1))); d = sub(T, S); dl = mn; }
    const u = mul(d, 1 / dl), v = norm(sub(pole, mul(u, dot(pole, u))));
    const ca = clamp((a * a + dl * dl - b * b) / (2 * a * dl), -1, 1), sa = Math.sqrt(1 - ca * ca);
    return { E: add(S, add(mul(u, a * ca), mul(v, a * sa))), T };
  }
  // 다리(옆면): 엉덩관절 기준 발목 목표(x 앞, y 위) → [엉덩 각도, 무릎 굽힘] 도
  function ik2(th, sh, tx, ty) {
    const d = clamp(Math.hypot(tx, ty), Math.abs(th - sh) + 1e-3, (th + sh) * 0.998);
    const phi = Math.atan2(tx, -ty), al = Math.acos(clamp((th * th + d * d - sh * sh) / (2 * th * d), -1, 1));
    const gm = Math.acos(clamp((th * th + sh * sh - d * d) / (2 * th * sh), -1, 1));
    return [(phi + al) / D2R, 180 - gm / D2R];
  }
  // 관절 각도 → 무릎·발목·뒤꿈치·발끝 (엉덩관절 기준)
  function chainOf(L, l) {
    const th = l.hip * D2R, a = (l.hip - l.knee) * D2R, b = a + l.ank * D2R;
    const knee = [L.th * Math.sin(th), -L.th * Math.cos(th)], ankle = [knee[0] + L.sh * Math.sin(a), knee[1] - L.sh * Math.cos(a)];
    const dn = [Math.sin(b) * L.ank, -Math.cos(b) * L.ank], fw = [Math.cos(b), Math.sin(b)];
    return { knee, ankle, heel: [ankle[0] + dn[0] - fw[0] * L.heel, ankle[1] + dn[1] - fw[1] * L.heel], toe: [ankle[0] + dn[0] + fw[0] * L.toe, ankle[1] + dn[1] + fw[1] * L.toe] };
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // 외형(눈·피부와 같은 id): 키(m), 머리색, 피부색, 아이 비율, 노인 구부정
  const AV = {
    nb: { h: 0.5, hair: '#2a211c', skin: [241, 205, 179], child: 1 },
    c_m: { h: 1.28, hair: '#1d1714', skin: [238, 201, 173], child: 1 }, c_f: { h: 1.27, hair: '#1d1714', skin: [241, 205, 179], child: 1, long: 1 },
    t_m: { h: 1.70, hair: '#1d1714', skin: [232, 189, 159] }, t_f: { h: 1.60, hair: '#1d1714', skin: [237, 196, 168], long: 1 },
    y_m: { h: 1.74, hair: '#1d1714', skin: [226, 181, 151] }, y_f: { h: 1.61, hair: '#1d1714', skin: [234, 193, 166], long: 1 },
    m_m: { h: 1.72, hair: '#2b2622', skin: [222, 176, 146] }, m_f: { h: 1.58, hair: '#3a332e', skin: [230, 188, 160] },
    s_m: { h: 1.68, hair: '#77716b', skin: [220, 174, 144], old: 0.4 }, s_f: { h: 1.55, hair: '#8a847e', skin: [228, 184, 156], old: 0.4 },
    e_m: { h: 1.64, hair: '#d8d5d0', skin: [216, 173, 146], old: 1 }, e_f: { h: 1.50, hair: '#dedad5', skin: [222, 180, 155], old: 1 },
  };
  const GOWN = '#93b6e2', GOWN_D = '#6f93c4', SHORTS = '#7fa3d6';

  // 걸음 파라미터 기본값(정상). 프리셋 g 가 덮어씀. R/L 은 그쪽 다리만
  const DEF = {
    speed: 1, stride: 1, cadence: 1, base: 0.07, trunkFwd: 0, armSwing: 1, elbow: 12, headDown: 0,
    var: 0, sway: 0, waddle: 0, shuffle: 0, festinate: 0, stamp: 0, chorea: 0, scissor: 0, lordosis: 0, unable: null, assist: 0,
    tandem: 0, pTrem: 0,      // tandem 일자 보행 때 헛디딤(1이면 몇 걸음 못 감), pTrem 팔 뻗은 자세 떨림(본태떨림)
    R: {}, L: {},
    rom: { open: 0.4, closed: 0.6, dir: 0, fall: 0, wide: 0 },
  };
  // 다리별: stanceShort 아픈 쪽 디딤 짧게(절뚝임), kneeStiff 흔들 때 무릎 덜 굽힘, footDrop 발처짐, steppage 발 높이 들기,
  // circum 휘돌림, hipDrop 반대쪽 골반 처짐(트렌델렌버그), noPush 발끝 밀기 없음, outToe 발끝 바깥, heelWeak/toeWeak 발뒤꿈치·발끝 보행 못 함, armHeld 팔 굽혀 붙임
  // 협조운동(그쪽 팔다리): dysm 겨냥이상(지나치거나 못 미침), inten 의도 떨림(목표에 가까울수록 커짐), legDysm 다리만 실조(heel to shin),
  // kTrem 움직일 때 규칙적 떨림(본태떨림), ddk 교대운동 불규칙(소뇌), brady 느리고 점점 작아짐(파킨슨), drift 눈 감으면 팔 처지며 엎침(상위운동신경)
  const SIDE = { stanceShort: 0, kneeStiff: 0, footDrop: 0, steppage: 0, circum: 0, hipDrop: 0, noPush: 0, outToe: 0, heelWeak: 0, toeWeak: 0, armHeld: 0, stride: 1, equinus: 0,
    dysm: 0, inten: 0, legDysm: 0, kTrem: 0, ddk: 0, brady: 0, drift: 0 };
  const CLOSE = { fnt: 1, hts: 1, ram: 1, drift: 1 };   // 앉아서, 가까이 비스듬히 보는 검사

  function GaitEngine(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.view = 'side'; this.task = 'walk'; this.av = 'm_m'; this.sev = 1;
    this.setGait({});
    this.reset();
  }
  GaitEngine.VIEWS = { side: '옆에서', front: '앞에서' };
  GaitEngine.TASKS = { walk: '걸음걸이', heel: '발뒤꿈치 보행', toe: '발끝 보행', romberg: 'Romberg', tandem: '일자 보행',
    fnt: 'Finger to nose', hts: 'Heel to shin', ram: '빠른 교대운동', drift: 'Pronator drift' };
  GaitEngine.CLOSE = CLOSE;
  const P = GaitEngine.prototype;

  P.setAvatar = function (a) { this.av = AV[a] ? a : 'm_m'; this.reset(); };
  P.setView = function (v) { this.view = v; this.reset(); };
  P.setTask = function (t) { this.task = t; this.reset(); };
  P.setSev = function (s) { this.sev = s; this.setGait(this.raw || {}); this.reset(); };
  // 프리셋 파라미터(g)에 강도(sev: 0.6 경증 / 1 / 1.3 중증)를 곱해 정상 쪽으로 섞음
  P.setGait = function (g) {
    this.raw = g || {};
    const k = this.sev, mix = (d, v) => typeof v === 'number' && typeof d === 'number' ? d + (v - d) * k : v;
    const o = {};
    for (const key of Object.keys(DEF)) {
      if (key === 'R' || key === 'L') {
        const s = Object.assign({}, SIDE, this.raw[key] || {});
        o[key] = {}; for (const kk of Object.keys(SIDE)) o[key][kk] = clamp(mix(SIDE[kk], s[kk]), kk === 'stride' ? 0.2 : 0, kk === 'stride' ? 1.5 : 1.3);
      } else if (key === 'rom') {
        const r = Object.assign({}, DEF.rom, this.raw.rom || {});
        o.rom = { open: mix(DEF.rom.open, r.open), closed: mix(DEF.rom.closed, r.closed), dir: r.dir, fall: r.fall && k >= 0.9 ? 1 : 0, wide: r.wide };
      } else o[key] = key in this.raw ? mix(DEF[key], this.raw[key]) : DEF[key];
    }
    o.unable = this.raw.unable || null; o.assist = this.raw.assist || 0;
    this.p = o;
  };

  P.reset = function () {
    this.t = 0; this.phase = 0; this.dist = 0; this.prints = []; this.prevPh = { R: 0, L: 0.5 };
    this.anchor = null; this.rnd = rng(7 + (this.av.charCodeAt(0) || 0)); this.hsPh = {};
    this.vr = { R: { lat: 0, str: 1 }, L: { lat: 0, str: 1 } };
    this.fade = 0; this.sayQ = []; this.saidT = {}; this.hud = '';
    this.stepTimes = []; this.lastPose = null; this.chor = [0, 1, 2, 3, 4, 5].map(() => this.rnd() * 6.28);
    this.fallen = 0; this.tStep = -9;
    this.ram = {}; for (const s of ['R', 'L']) this.ram[s] = { ph: 0, k: 0, per: 0.4, amp: 1, r0: 0, r1: Math.PI, off: [0, 0] };
    this.pose = this.solve(0);
  };
  P.say = function (line) { this.sayQ.push(line); };
  P.takeSay = function () { return this.sayQ.shift() || null; };

  // ------------------------------------------------------------------ 한 프레임 진행
  P.advance = function (dt) {
    this.t += dt;
    const p = this.p;
    if (this.task === 'romberg' || CLOSE[this.task] || p.unable) { this.pose = this.solve(dt); return; }
    // 주기 속도: 기본 1.05초/주기. 아픈 쪽 디딤(입박)이 짧으면 그동안 빨리 지나감(절뚝임)
    let T = 1.05 / p.cadence * (AV[this.av].child ? 0.85 : 1) * (this.task === 'walk' ? 1 : this.task === 'tandem' ? 1.6 : 1.15);
    if (p.festinate) T /= 1 + p.festinate * 0.5 * clamp((this.t - 1.5) / 4, 0, 1);
    let rate = 1 / T;
    for (const s of ['R', 'L']) {
      const ph = this.legPhase(s), k = p[s].stanceShort;
      if (k > 0) rate *= ph < 0.6 ? 1 + k * 0.9 : 1 - k * 0.25;
    }
    if (p.chorea) rate *= 1 + 0.35 * p.chorea * Math.sin(this.t * 2.3 + this.chor[0]);
    if (p.festinate && this.t < 1.2) rate *= 0.45;                       // 출발 머뭇거림
    this.phase += dt * rate;
    this.pose = this.solve(dt);
    if (this.pose.pelvis.x > (this.view === 'side' ? 4.4 : 4.4)) { this.dist = 0; this.anchor = null; this.prints = []; this.fade = 1; }
    this.fade = Math.max(0, this.fade - dt * 2.5);
  };
  P.legPhase = function (s) { return ((this.phase + (s === 'L' ? 0.5 : 0)) % 1 + 1) % 1; };

  // ------------------------------------------------------------------ 자세 계산 (미터, 몸 기준)
  P.solve = function (dt) {
    const p = this.p, A = AV[this.av], Hh = A.h, ch = A.child ? 1 : 0;
    const L = { th: 0.245 * Hh, sh: 0.246 * Hh, ank: 0.039 * Hh, heel: 0.045 * Hh, toe: 0.11 * Hh, hipW: 0.085 * Hh * (ch ? 0.9 : 1) };
    const out = { legs: {}, H: Hh, L };
    const task = this.task, rom = task === 'romberg';
    const t = this.t;
    // 무도병: 몸통·팔·머리에 불규칙한 움직임
    const cn = (i, f) => p.chorea ? p.chorea * (Math.sin(t * f + this.chor[i]) * 0.6 + Math.sin(t * f * 2.7 + this.chor[i + 1 > 5 ? 0 : i + 1]) * 0.4) : 0;

    if (CLOSE[task]) return this.solveSeated(dt, L);
    if (rom || p.unable) return this.solveStand(dt, L);
    const tan = task === 'tandem';

    for (const s of ['R', 'L']) {
      const q = p[s], ph = this.legPhase(s), sg = s === 'R' ? -1 : 1;
      const sw = ph > 0.6 ? Math.sin(Math.PI * (ph - 0.6) / 0.4) : 0;            // 흔듦 정도 0~1
      // 한 걸음마다 바뀌는 흔들림(실조): 발이 공중에 있을 때(흔듦 중간) 새로 뽑음 — 닿는 순간 바꾸면 발이 튐
      if (this.prevPh[s] < 0.72 && ph >= 0.72) {
        this.vr[s] = { lat: (this.rnd() * 2 - 1) * p.var, str: 1 + (this.rnd() * 2 - 1) * p.var * 0.45, out: 0 };
        // 일자 보행: 좁은 발 간격에서 흔들림이 드러남. tandem 이 크면 가끔 옆으로 발을 내디뎌 버팀
        if (tan && p.tandem && this.rnd() < p.tandem * 0.55) {
          const dir = p.rom.dir || (this.rnd() < 0.5 ? -1 : 1);
          this.vr[s].out = dir * (0.1 + 0.08 * p.tandem); this.tStep = this.t;
          if (!this.saidT.tan || this.t - this.saidT.tan > 6) { this.saidT.tan = this.t; this.say('어어… 선 위로 걷기가 힘들어요.'); }
        }
      }
      this.prevPh[s] = ph;
      const strideK = p.stride * q.stride * this.vr[s].str * (1 - p.shuffle * 0.6) * (task === 'walk' ? 1 : tan ? 0.42 : 0.75);
      let hip = curve(HIP, ph) * strideK + 3 * p.trunkFwd;
      let knee = curve(KNEE, ph);
      knee = ph > 0.55 ? knee * (1 - q.kneeStiff * 0.75) * (1 - p.shuffle * 0.45) : knee * (1 - p.shuffle * 0.2);
      knee += p.trunkFwd * 12 + (A.old || 0) * 5;                            // 구부정하면 무릎도 굽힘
      let ank = curve(ANK, ph) * (1 - p.shuffle * 0.5);
      // 발 높이 들기(발처짐 보상·감각 실조 쿵쿵 걸음)
      const lift = Math.max(q.steppage, p.stamp * 0.8);
      hip += lift * sw * 26; knee += lift * sw * 42;
      // 발처짐: 흔드는 동안 발끝이 처지고 발끝부터 닿음
      ank = lerp(ank, -28, q.footDrop * (ph > 0.55 ? 1 : ph < 0.08 ? 1 - ph / 0.08 : 0));
      if (q.noPush && ph > 0.4 && ph < 0.65) ank = Math.max(ank, 4);           // 발끝으로 밀지 못함(아킬레스건)
      if (q.equinus) ank = Math.min(ank, -14 * q.equinus);                    // 까치발(구축)
      // 검사: 발뒤꿈치 보행(발등 굽혀 발끝 듦) / 발끝 보행(뒤꿈치 듦). 약한 쪽은 못 함
      if (task === 'heel') ank = lerp(24, -4, q.heelWeak) + (ph > 0.6 ? 4 : 0);
      if (task === 'toe') { ank = lerp(-30, -2, q.toeWeak); knee += q.toeWeak * 10; }
      // 좌우: 발 간격 + 휘돌림 + 실조 흔들림 + 가위 걸음(다리가 안으로 모임)
      let lat = sg * (p.base / 2 + 0.02) + sg * q.circum * sw * 0.16 * Hh / 1.7 + sg * this.vr[s].lat * 0.11 - sg * p.scissor * 0.07;
      if (tan) lat = this.vr[s].lat * 0.07 + (this.vr[s].out || 0);          // 일자 보행: 발을 가운데 선 위에
      const hipZ = sg * L.hipW;
      out.legs[s] = { hip, knee, ank, lat, hipZ, ph, sw, outToe: q.outToe };
    }
    // 앞뒤(시상면) 다리 사슬
    const chains = {};
    let minY = Infinity, stanceLeg = null;
    for (const s of ['R', 'L']) {
      const l = out.legs[s], th = l.hip * D2R, a = (l.hip - l.knee) * D2R, b = a + l.ank * D2R;
      const knee = [L.th * Math.sin(th), -L.th * Math.cos(th)];
      const ankle = [knee[0] + L.sh * Math.sin(a), knee[1] - L.sh * Math.cos(a)];
      const dn = [Math.sin(b) * L.ank, -Math.cos(b) * L.ank], fw = [Math.cos(b), Math.sin(b)];
      const heel = [ankle[0] + dn[0] - fw[0] * L.heel, ankle[1] + dn[1] - fw[1] * L.heel];
      const toe = [ankle[0] + dn[0] + fw[0] * L.toe, ankle[1] + dn[1] + fw[1] * L.toe];
      chains[s] = { knee, ankle, heel, toe };
      chains[s].low = Math.min(heel[1], toe[1]);
    }
    // 디딘 다리: 보행 주기상 디딤 구간(뒤꿈치 닿기 직전~발끝 떼기)인 다리 중 더 낮은 쪽. 흔드는 발이 잠깐 스쳐도 디딘 발로 보지 않음
    const inStance = (s) => { const ph = out.legs[s].ph; return ph < 0.62 || ph > 0.95; };
    for (const s of ['R', 'L']) if (inStance(s) && chains[s].low < minY) { minY = chains[s].low; stanceLeg = s; }
    if (!stanceLeg) for (const s of ['R', 'L']) if (chains[s].low < minY) { minY = chains[s].low; stanceLeg = s; }
    // 골반 높이: 가장 낮은 발이 바닥(y=0)에 닿게
    const pelY = -Math.min(minY, chains.R.low, chains.L.low);      // 어느 발도 바닥 아래로 내려가지 않게
    // 디딘 발 고정: 디딘 다리·닿은 점(뒤꿈치/발끝)이 바뀔 때만 기준점을 새로 잡음 → 미끄러지지 않음
    const st = chains[stanceLeg], cpt = st.heel[1] <= st.toe[1] ? 'heel' : 'toe', relX = st[cpt][0];
    if (!this.anchor || this.anchor.leg !== stanceLeg || this.anchor.pt !== cpt) this.anchor = { leg: stanceLeg, pt: cpt, x: this.dist + relX };
    const newDist = Math.max(this.dist, this.anchor.x - relX);              // 뒤로 가지 않음
    this.dist = newDist;
    // 발자국: 보행 주기상 그 다리의 뒤꿈치 닿기(주기가 0을 지날 때)에 기록 → 한 주기에 정확히 두 걸음
    for (const s of ['R', 'L']) {
      const l = out.legs[s], c = chains[s], prev = this.hsPh[s];
      if (prev !== undefined && prev > 0.8 && l.ph < 0.2 && this.t > 0.05) {
        this.prints.push({ x: this.dist + (c.heel[0] + c.toe[0]) / 2, z: l.lat, s, len: L.heel + L.toe, out: l.outToe, t: this.t });
        if (this.prints.length > 16) this.prints.shift();
        this.stepTimes.push(this.t); if (this.stepTimes.length > 8) this.stepTimes.shift();
        if (p.stamp > 0.3) this.lastStamp = { s, t: this.t };
      }
      this.hsPh[s] = l.ph;
    }
    // 골반·몸통: 디딘 쪽으로 무게 이동, 뒤뚱(양쪽 골반 처짐), 트렌델렌버그(한쪽), 실조 흔들림
    const wR = out.legs.R.ph < 0.6 ? 1 : 0, wL = out.legs.L.ph < 0.6 ? 1 : 0, side = (wL - wR);      // +면 왼다리로 섬
    const swayZ = side * (tan ? 0.008 : 0.018 + p.waddle * 0.05 + p.sway * 0.03) * Hh / 1.7 + (p.var ? Math.sin(t * 1.7) * p.var * (tan ? 0.08 : 0.05) : 0) + cn(0, 1.9) * 0.05;
    let drop = side * p.waddle * 7 + cn(1, 2.2) * 6;                     // 골반 기울기(도): 흔드는 쪽이 처짐
    if (wR && !wL) drop += -p.R.hipDrop * 9; if (wL && !wR) drop += p.L.hipDrop * 9;
    const hike = -(out.legs.R.sw * p.R.circum - out.legs.L.sw * p.L.circum) * 5;     // 휘돌리는 쪽 골반을 들어 올림
    const trunkLat = side * (p.waddle * 10 + (p.R.hipDrop + p.L.hipDrop) * 7) + cn(2, 1.6) * 9 + (p.var ? Math.sin(t * 1.3 + 1) * p.var * (tan ? 10 : 6) : 0)
      + (tan ? Math.sin(t * 2.6) * p.tandem * 4 * clamp(1 - (this.t - this.tStep) / 1.5, 0.3, 1) : 0);
    const trunkFwd = p.trunkFwd * 32 + (A.old || 0) * 6 - p.lordosis * 9 + cn(3, 1.4) * 6 + (p.var ? Math.sin(t * 2.1) * p.var * 4 : 0);
    out.pelvis = { x: this.dist, y: pelY, z: swayZ, tilt: drop + hike };
    out.trunk = { fwd: trunkFwd, lat: trunkLat, head: p.headDown * 25 + (A.old || 0) * 6 + cn(4, 2.5) * 10, headLat: cn(5, 1.8) * 12 };
    out.chains = chains;
    // 팔: 반대쪽 다리와 함께 흔듦
    for (const s of ['R', 'L']) {
      const o = s === 'R' ? 'L' : 'R', q = p[s];
      const swing = (out.legs[o].hip + 2) * 0.75 * p.armSwing * (1 - q.armHeld);      // 반대쪽 다리와 같은 방향
      out.legs[s].arm = { sh: swing * (tan ? 0.4 : 1) + cn(s === 'R' ? 1 : 3, 2) * 25, el: p.elbow + q.armHeld * 80 + (p.armSwing < 0.5 ? 15 : 0), abd: q.armHeld * 10 + p.var * 14 + p.stamp * 8 + Math.abs(cn(s === 'R' ? 2 : 4, 2.4)) * 25 + (tan ? 14 + p.tandem * 16 : 0) };
    }
    out.eyes = 1;
    return out;
  };

  // 서 있기: Romberg(발 모으고 눈 뜨고 → 감고) / 걸을 수 없음(한 다리로 버팀)
  P.solveStand = function (dt, L) {
    const p = this.p, A = AV[this.av], Hh = A.h, t = this.t, r = p.rom, out = { legs: {}, H: Hh, L };
    let eyes = 1, feet = 0.04 + (r.wide ? 0.12 : 0), sw = 0, dir = 0;
    if (p.unable) {
      this.hud = '';
      if (!this.saidT.unable && t > 0.6) { this.saidT.unable = 1; this.say(p.unable.line || '아파서 다리를 디딜 수가 없어요.'); }
    } else {
      // 0~2초: 발 모으기, 2~7초 눈 뜸, 7~17초 눈 감음 → 다시 처음
      const tt = t % 18;
      if (tt < 2) { this.hud = '발을 모으고 서세요'; feet = lerp(0.18, feet, tt / 2); }
      else if (tt < 7) this.hud = '눈 뜨고 ' + Math.floor(tt - 2) + '초';
      else { eyes = 0; this.hud = '눈 감고 ' + Math.floor(tt - 7) + '초'; }
      if (tt >= 7 && !this.saidT['c' + Math.floor(t / 18)]) { this.saidT['c' + Math.floor(t / 18)] = 1; }
      const amp = (eyes ? r.open : r.closed + (r.fall ? clamp((tt - 8) / 4, 0, 1) * 3 : 0)) * (A.old ? 1.2 : 1);
      sw = amp; dir = r.dir;
      if (r.fall && !eyes && tt > 11 && !this.saidT['f' + Math.floor(t / 18)]) { this.saidT['f' + Math.floor(t / 18)] = 1; this.say('어어… 넘어질 것 같아요!'); }
    }
    // 몸 전체 흔들림(발목 기준 거꾸로 선 진자). 도 단위
    const n1 = Math.sin(t * 2.2 + 0.3) * 0.6 + Math.sin(t * 5.1 + 1.1) * 0.4, n2 = Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 4.3) * 0.4;
    let latA = sw * n1 + dir * sw * 0.55, apA = sw * 0.7 * n2;
    const catching = r.fall && !eyes && Math.abs(latA) > 3.2;
    if (catching) latA = Math.sign(latA) * 3.2;
    for (const s of ['R', 'L']) {
      const sg = s === 'R' ? -1 : 1, hurt = p.unable && p.unable.side === s;
      const stepOut = catching && Math.sign(latA) === sg ? 0.12 : 0;
      out.legs[s] = { hip: hurt ? 22 : 2, knee: hurt ? 40 : 3, ank: hurt ? -10 : 0, lat: sg * (feet / 2 + stepOut), hipZ: sg * L.hipW, ph: 0, sw: 0, outToe: hurt ? 1 : 0 };
    }
    const chains = {};
    let minY = Infinity;
    for (const s of ['R', 'L']) {
      const l = out.legs[s], th = l.hip * D2R, a = (l.hip - l.knee) * D2R, b = a + l.ank * D2R;
      const knee = [L.th * Math.sin(th), -L.th * Math.cos(th)], ankle = [knee[0] + L.sh * Math.sin(a), knee[1] - L.sh * Math.cos(a)];
      const dn = [Math.sin(b) * L.ank, -Math.cos(b) * L.ank], fw = [Math.cos(b), Math.sin(b)];
      chains[s] = { knee, ankle, heel: [ankle[0] + dn[0] - fw[0] * L.heel, ankle[1] + dn[1] - fw[1] * L.heel], toe: [ankle[0] + dn[0] + fw[0] * L.toe, ankle[1] + dn[1] + fw[1] * L.toe] };
      minY = Math.min(minY, chains[s].heel[1], chains[s].toe[1]);
    }
    const pelY = -minY, hgt = pelY;
    // 서 있는 자리
    this.dist = this.view === 'side' ? 1.9 * Hh / 1.7 : 3.7;
    const tiltZ = Math.sin(latA * D2R) * hgt, tiltX = Math.sin(apA * D2R) * hgt;
    out.pelvis = { x: this.dist + tiltX, y: pelY, z: tiltZ + (p.unable ? (p.unable.side === 'R' ? 0.05 : -0.05) : 0), tilt: p.unable ? (p.unable.side === 'R' ? 6 : -6) : 0 };
    out.trunk = { fwd: apA * 1.3 + (A.old || 0) * 6 + (p.trunkFwd || 0) * 30, lat: latA * 1.6 + (p.unable ? (p.unable.side === 'R' ? 8 : -8) : 0), head: (A.old || 0) * 6, headLat: 0 };
    out.chains = chains; out.footShift = { R: -tiltX, L: -tiltX };
    for (const s of ['R', 'L']) {
      const hold = p.unable && p.unable.side === s;
      out.legs[s].arm = { sh: hold ? -10 : 2, el: hold ? 70 : 10, abd: catching ? 45 : hold ? 25 : 6 + Math.abs(latA) * 3 };
    }
    out.eyes = eyes; out.standing = true;
    return out;
  };

  // 앉아서 하는 협조운동: 진찰대 끝에 앉음(골반 x = 0). 팔은 손끝 목표(tgt)로 IK, 다리는 발목 목표로 IK
  P.solveSeated = function (dt, L) {
    const p = this.p, A = AV[this.av], Hh = A.h, t = this.t, task = this.task, U = Hh / 1.7;
    const out = { legs: {}, H: Hh, L, standing: true, eyes: 1 };
    const seat = L.sh + L.ank, sgOf = (s) => s === 'R' ? -1 : 1, nm = (s) => s === 'R' ? '오른' : '왼';
    const oth = (s) => s === 'R' ? 'L' : 'R';
    for (const s of ['R', 'L']) out.legs[s] = { hip: 90, knee: 90, ank: 0, lat: sgOf(s) * (L.hipW + 0.01 * U), hipZ: sgOf(s) * L.hipW, ph: 0, sw: 0, outToe: 0 };
    const pole = (s) => [-0.6, -1, sgOf(s) * 0.7];                                   // 팔꿈치: 뒤·아래·바깥
    const onThigh = (s) => [L.th * 0.6, seat + 0.06 * Hh, sgOf(s) * (L.hipW + 0.005)];
    const onBed = (s) => [0.01 * Hh, seat - 0.03 * Hh, sgOf(s) * 0.19 * Hh];
    // 본태떨림: 6~7 Hz 규칙적 떨림
    const trem = (q, ph) => q.kTrem ? mul([0, Math.sin(t * 41 + ph), Math.cos(t * 43 + ph * 1.7) * 0.7], q.kTrem * 0.011 * U) : [0, 0, 0];
    this.hud = '';
    let head = (A.old || 0) * 4, fwd = (A.old || 0) * 5;

    if (task === 'fnt') {
      // 검사자 손가락 ↔ 자기 코. 한쪽 손으로 3번 → 반대 손
      const brady = Math.max(p.R.brady, p.L.brady), per = 1.8 * (1 + 0.7 * brady);
      const s = Math.floor(t / (per * 3)) % 2 ? 'L' : 'R', q = p[s], k = Math.floor(t / per), u = (t % per) / per;
      this.hud = nm(s) + '손 검지로 제 손가락 → 코';
      const fp = [0.36 * Hh, seat + 0.31 * Hh + (hr(k) - 0.5) * 0.08 * Hh, sgOf(s) * 0.03 * Hh + (hr(k + 7) - 0.5) * 0.12 * Hh];
      let w, appr, atF = 0, atN = 0;           // w: 코 쪽 비중(1 = 코), appr: 목표에 가까운 정도
      if (u < 0.4) { const e = ease(u / 0.4); w = 1 - e; appr = e * e; atF = clamp((u - 0.28) / 0.12, 0, 1); }
      else if (u < 0.55) { w = 0; appr = 1; atF = 1 - (u - 0.4) / 0.15; }
      else if (u < 0.92) { const e = ease((u - 0.55) / 0.37); w = e; appr = e * e; atN = clamp((u - 0.8) / 0.12, 0, 1); }
      else { w = 1; appr = 1; atN = 1 - (u - 0.92) / 0.08; }
      // 의도 떨림(3~4 Hz, 목표에 가까울수록) + 겨냥이상(목표를 지나치거나 빗나갔다 고침) + 본태떨림
      const iA = q.inten * 0.032 * U * appr, sgn = hr(k + 3) < 0.5 ? -1 : 1, sgn2 = hr(k + 5) < 0.5 ? -1 : 1;
      let err = [0, Math.sin(t * 22) * iA, Math.cos(t * 22 + 0.6) * iA];
      const dF = q.dysm * 0.07 * U * Math.sin(Math.PI * atF * 0.999), dN = q.dysm * 0.035 * U * Math.sin(Math.PI * atN * 0.999);
      err = add(err, [dF * 0.4, dF * 0.5 * sgn2, dF * 0.8 * sgn]);
      err = add(err, [dN * 0.3, dN * 0.6 * sgn2, dN * 0.9 * sgn]);
      err = add(err, trem(q, 0));
      out.legs[s].arm = { tgt: fp, nose: w, err, pole: pole(s) };
      out.legs[oth(s)].arm = { tgt: onThigh(oth(s)), pole: pole(oth(s)), rot: 0 };
      out.exam = { fp };
    } else if (task === 'hts') {
      // 한쪽 발뒤꿈치를 반대쪽 무릎에 올리고 정강이를 따라 내림. 2번씩 번갈아
      const q0 = Math.max(p.R.brady, p.L.brady), per = 3.4 * (1 + 0.5 * q0);
      const s = Math.floor(t / (per * 2)) % 2 ? 'L' : 'R', o = oth(s), q = p[s], k = Math.floor(t / per), u = (t % per) / per;
      this.hud = `${nm(s)}쪽 발뒤꿈치 → ${nm(o)}쪽 무릎·정강이`;
      const atx = Math.max(q.dysm, q.legDysm), zo = out.legs[o].lat, z0 = out.legs[s].lat;
      const rest = [L.th, -L.sh - L.ank], knee = [L.th + 0.035 * Hh, 0.035 * Hh], low = [L.th + 0.035 * Hh, -L.sh + 0.07 * Hh];
      let hp, z, on = 0;                         // hp: 발뒤꿈치 목표(엉덩관절 기준)
      const sgn = hr(k + 1) < 0.5 ? -1 : 1;
      if (u < 0.25) { const e = ease(u / 0.25); hp = [lerp(rest[0], knee[0], e) + Math.sin(Math.PI * e) * 0.04 * Hh, lerp(rest[1], knee[1], e) + Math.sin(Math.PI * e) * 0.1 * Hh]; z = lerp(z0, zo, e); }
      else if (u < 0.78) {
        const e = (u - 0.25) / 0.53; on = 1;
        hp = [knee[0], lerp(knee[1], low[1], ease(e))];
        // 실조: 놓을 때 빗나갔다 고침 + 내려가는 동안 좌우로 흔들림, 심하면 정강이에서 미끄러짐
        const miss = atx * 0.07 * U * Math.max(0, 1 - e * 4) * sgn;
        const wob = (atx * 0.6 + q.inten) * 0.03 * U * (Math.sin(t * 15) * 0.7 + Math.sin(t * 6.3 + k) * 0.5);
        const slip = atx > 0.55 && hr(k + 9) < atx * 0.8 ? atx * 0.08 * U * clamp((e - 0.45) * 4, 0, 1) * sgn : 0;
        z = zo + miss + wob + slip; hp[0] += Math.abs(miss) * 0.5 + Math.abs(slip) * 0.3;
      } else { const e = ease((u - 0.78) / 0.22); hp = [lerp(low[0], rest[0], e) + Math.sin(Math.PI * e) * 0.05 * Hh, lerp(low[1], rest[1], e) + Math.sin(Math.PI * e) * 0.06 * Hh]; z = lerp(zo, z0, e); }
      const tr = trem(q, 1); z += tr[2]; hp[1] += tr[1];
      // 발뒤꿈치 → 발목 목표, 발은 발등을 약간 굽힌 채
      const [hip, kn] = ik2(L.th, L.sh, hp[0] - 0.012 * Hh, hp[1] + L.ank + 0.01 * Hh);
      out.legs[s] = Object.assign(out.legs[s], { hip, knee: kn, ank: clamp(-(hip - kn) + (on ? 12 : 4), -30, 30), lat: z });
      for (const a of ['R', 'L']) out.legs[a].arm = { tgt: onBed(a), pole: [-0.3, -0.4, sgOf(a)] };
      head = 18; fwd = 4;
    } else if (task === 'ram') {
      // 양손으로 허벅지를 손바닥 → 손등 → 손바닥… 번갈아 치기
      this.hud = '손바닥·손등으로 허벅지를 번갈아 빠르게';
      for (const s of ['R', 'L']) {
        const q = p[s], st = this.ram[s];
        st.ph += dt / st.per;
        while (st.ph >= 1) {
          st.ph -= 1; st.k++;
          const r = () => this.rnd() - 0.5;
          st.per = 0.4 * (1 + q.brady * 0.8 + q.ddk * r() * 1.1) * (1 + q.brady * Math.min(st.k, 20) / 40);
          st.amp = Math.max(0.15, (1 + q.ddk * r() * 1.2) * (1 - q.brady * Math.min(st.k, 24) / 32));    // 파킨슨: 점점 작아짐
          st.r0 = st.r1; st.r1 = (st.k % 2 ? 0 : Math.PI) + q.ddk * r() * 1.4;                            // 소뇌: 덜·더 뒤집힘
          st.off = [q.ddk * r() * 0.06 * U, q.ddk * r() * 0.05 * U];
        }
        const u = st.ph, e = ease(u);
        const tg = add(onThigh(s), [st.off[0], Math.sin(Math.PI * u) * 0.055 * Hh * st.amp, st.off[1]]);
        out.legs[s].arm = { tgt: add(tg, trem(q, s === 'R' ? 0 : 2)), pole: pole(s), rot: lerp(st.r0, st.r1, e) };
      }
    } else {
      // pronator drift: 양팔을 앞으로 뻗고 손바닥 위로 → 눈 감고 10초
      const tt = t % 15;
      out.eyes = tt < 2.5 ? 1 : 0;
      this.hud = tt < 2.5 ? '양팔을 앞으로 뻗고 손바닥을 위로' : '눈 감고 ' + Math.floor(tt - 2.5) + '초';
      for (const s of ['R', 'L']) {
        const q = p[s], d = q.drift * ease(clamp((tt - 3) / 6, 0, 1)), ph = s === 'R' ? 0 : 1.3;
        const tw = p.pTrem * Math.sin(t * 40 + ph) + 0.25 * Math.sin(t * 1.3 + ph * 3);     // 자세 떨림 + 미세한 흔들림
        out.legs[s].arm = { sh: 88 - 30 * d + tw * 2.2, el: 3 + 22 * d, abd: 6 - 5 * d, rot: Math.PI - 1.3 * d + tw * 0.12 };
      }
    }
    const chains = {};
    for (const s of ['R', 'L']) chains[s] = chainOf(L, out.legs[s]);
    out.chains = chains;
    out.pelvis = { x: 0, y: seat, z: 0, tilt: 0 };
    out.trunk = { fwd, lat: 0, head, headLat: 0 };
    this.dist = 0;
    return out;
  };

  // ------------------------------------------------------------------ 그리기
  // 가까이 보는 검사의 카메라: 옆에서 = 오른쪽 앞 비스듬히(38°), 앞에서 = 정면
  P.camPhi = function () { return (this.view === 'side' ? 38 : 90) * D2R; };
  P.depth = function (q) { const f = this.camPhi(); return -q[0] * Math.sin(f) + q[2] * Math.cos(f); };   // 클수록 멂
  // 가까이 앞에서 볼 때는 원근 카메라(어깨 높이, 환자 앞 약 4 m): 앞으로 뻗은 팔이 아래로 처져 보이지 않게
  P.frontCam = function () { const Hh = AV[this.av].h; return { X: 2.4 * Hh, Y: 0.6 * Hh, F: 620 }; };
  P.camDir = function (q) {                      // 점 q 에서 보는 사람 쪽 방향
    if (CLOSE[this.task]) {
      if (this.view !== 'side') { const c = this.frontCam(); return norm([c.X - q[0], c.Y - q[1], -q[2]]); }
      const f = this.camPhi(); return norm([Math.sin(f), 0.3, -Math.cos(f)]);
    }
    return this.view === 'side' ? [0, 0.2, -1] : [1, 0.2, 0];
  };
  P.project = function (x, y, z) {               // 세계 좌표(m) → 화면
    const Hh = AV[this.av].h;
    if (CLOSE[this.task] && this.view !== 'side') {
      const c = this.frontCam(), sc = c.F / Hh * c.X / Math.max(0.15 * Hh, c.X - x);
      return [600 + z * sc, 230 - (y - c.Y) * sc, sc];
    }
    if (CLOSE[this.task]) {
      const S = 700 / Hh, f = this.camPhi(), c = Math.cos(f), s = Math.sin(f);
      const h = x * c + z * s, dep = -x * s + z * c;
      return [600 + (h - 0.12 * Hh * c) * S, 578 - (y + dep * 0.3) * S, S];
    }
    if (this.view === 'side') {
      const S = 225;                                   // 1 m = 225 px (아이는 실제 키대로 작게)
      return [70 + x * S, 505 - y * S - z * S * 0.2, S];
    }
    const F = 760, d = Math.max(1.2, 7.0 - x), CAMH = Hh * 0.62;           // 7 m 앞에서 출발해 다가옴
    const sc = F / d;
    return [600 + z * sc, 225 + (CAMH - y) * sc, sc];
  };

  P.draw = function () {
    const g = this.g, dpr = this.c.width / W;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRoom(g);
    this.drawPrints(g);
    this.drawBody(g, this.pose);
    if (this.hud) {
      g.font = '600 15px "IBM Plex Sans KR", sans-serif'; const w = g.measureText(this.hud).width + 24;
      g.fillStyle = 'rgba(15,20,22,0.78)'; g.beginPath(); g.roundRect(14, 14, w, 32, 8); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(this.hud, 26, 30);
    }
    g.font = '12px "IBM Plex Sans KR", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(40,50,55,0.75)'; g.textAlign = 'right'; g.fillText(this.view === 'side' ? (CLOSE[this.task] ? '오른쪽 앞에서 비스듬히 봄' : '옆에서 봄 · 환자 오른쪽이 보임') : '앞에서 봄 · 환자 오른쪽 = 화면 왼쪽', W - 14, 22);
    if (this.fade > 0) { g.fillStyle = `rgba(233,238,236,${this.fade})`; g.fillRect(0, 0, W, H); }
  };

  P.drawRoom = function (g) {
    if (CLOSE[this.task]) {
      const Hh = AV[this.av].h, seat = 0.285 * Hh, top = seat - 0.045 * Hh;
      const gw = g.createLinearGradient(0, 0, 0, H); gw.addColorStop(0, '#e6ebe9'); gw.addColorStop(1, '#d3dad8');
      g.fillStyle = gw; g.fillRect(0, 0, W, H);
      const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach((q, i) => { const r = this.project(q[0], q[1], q[2]); i ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1]); }); g.closePath(); g.fill(); };
      const fx = this.view === 'side' ? 3 : 0.75 * Hh;                                                   // 원근(앞)일 때 카메라 뒤는 그리지 않음
      poly([[-3, 0, -3], [fx, 0, -3], [fx, 0, 3], [-3, 0, 3]], '#cbc2b4');                                   // 바닥
      const x0 = -0.3 * Hh, x1 = 0.16 * Hh, z0 = -0.24 * Hh, z1 = 0.24 * Hh;                              // 진찰대
      poly([[x1, 0, z0], [x1, top, z0], [x1, top, z1], [x1, 0, z1]], '#8a9ea4');
      if (this.view === 'side') poly([[x0, 0, z0], [x1, 0, z0], [x1, top, z0], [x0, top, z0]], '#a7b8bc');
      poly([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], '#eef1f1');
      return;
    }
    if (this.view === 'side') {
      const gw = g.createLinearGradient(0, 0, 0, 505); gw.addColorStop(0, '#e6ebe9'); gw.addColorStop(1, '#d5dcda');
      g.fillStyle = gw; g.fillRect(0, 0, W, 505);
      g.fillStyle = '#c3ccc9'; g.fillRect(0, 300, W, 8);                                  // 손잡이
      g.fillStyle = '#b7c1be'; g.fillRect(0, 488, W, 17);                                 // 걸레받이
      const gf = g.createLinearGradient(0, 505, 0, H); gf.addColorStop(0, '#cfc6b8'); gf.addColorStop(1, '#bdb3a4');
      g.fillStyle = gf; g.fillRect(0, 505, W, H - 505);
      // 바닥 줄자(0.5 m 눈금)
      g.strokeStyle = 'rgba(70,60,50,0.45)'; g.lineWidth = 1; g.fillStyle = 'rgba(70,60,50,0.6)'; g.font = '11px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.beginPath(); g.moveTo(0, 560.5); g.lineTo(W, 560.5); g.stroke();
      for (let m = 0; m <= 5.5; m += 0.5) { const [x] = this.project(m, 0, 0); g.beginPath(); g.moveTo(x + 0.5, 553); g.lineTo(x + 0.5, m % 1 ? 560 : 567); g.stroke(); if (!(m % 1)) g.fillText(m + ' m', x, 580); }
      return;
    }
    // 복도: 뒷벽(16 m 앞) · 양쪽 벽 · 바닥 타일 · 가운데 테이프. x = 7 - 거리
    const X = (d) => 7 - d, WZ = 1.7, CH = 2.7, FAR = 16, NEAR = 1.25;
    const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach((q, i) => { const r = this.project(q[0], q[1], q[2]); i ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1]); }); g.closePath(); g.fill(); };
    g.fillStyle = '#dfe5e3'; g.fillRect(0, 0, W, H);
    poly([[X(FAR), 0, -WZ], [X(FAR), 0, WZ], [X(NEAR), 0, WZ], [X(NEAR), 0, -WZ]], '#cbc2b4');               // 바닥
    poly([[X(FAR), 0, -WZ], [X(NEAR), 0, -WZ], [X(NEAR), CH, -WZ], [X(FAR), CH, -WZ]], '#d3dad8');          // 오른쪽 벽(화면 왼쪽)
    poly([[X(FAR), 0, WZ], [X(NEAR), 0, WZ], [X(NEAR), CH, WZ], [X(FAR), CH, WZ]], '#d3dad8');
    poly([[X(FAR), CH, -WZ], [X(FAR), CH, WZ], [X(NEAR), CH, WZ], [X(NEAR), CH, -WZ]], '#eef1f0');          // 천장
    poly([[X(FAR), 0, -WZ], [X(FAR), 0, WZ], [X(FAR), CH, WZ], [X(FAR), CH, -WZ]], '#e7ecea');              // 뒷벽
    g.strokeStyle = 'rgba(90,80,70,0.18)'; g.lineWidth = 1;
    const line = (a, b) => { const r1 = this.project(...a), r2 = this.project(...b); g.beginPath(); g.moveTo(r1[0], r1[1]); g.lineTo(r2[0], r2[1]); g.stroke(); };
    for (let z = -WZ; z <= WZ + 1e-6; z += WZ / 3) line([X(FAR), 0, z], [X(NEAR), 0, z]);
    for (let d = 2; d <= FAR; d += 1) line([X(d), 0, -WZ], [X(d), 0, WZ]);
    for (const z of [-WZ, WZ]) { g.strokeStyle = 'rgba(150,160,158,0.8)'; g.lineWidth = 3; line([X(FAR), 0.9, z], [X(NEAR), 0.9, z]); g.lineWidth = 1; }   // 손잡이
    g.strokeStyle = 'rgba(225,190,80,0.85)'; g.lineWidth = 2; line([X(FAR), 0, 0], [X(NEAR), 0, 0]);
  };

  P.drawPrints = function (g) {
    if (CLOSE[this.task]) return;
    for (const f of this.prints) {
      const age = clamp((this.t - f.t) / 9, 0, 1), al = 0.42 * (1 - age);
      if (al <= 0.01) continue;
      const a = this.project(f.x - f.len / 2, 0, f.z), b = this.project(f.x + f.len / 2, 0, f.z + (f.out ? (f.s === 'R' ? -0.05 : 0.05) : 0));
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      g.save(); g.translate(cx, cy);
      g.fillStyle = `rgba(80,62,48,${al})`;
      if (this.view === 'side') { g.beginPath(); g.ellipse(0, 3, Math.abs(b[0] - a[0]) / 2, 3, 0, 0, 7); g.fill(); }
      else { const sc = a[2] / 760; g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2 + Math.PI / 2); g.beginPath(); g.ellipse(0, 0, 0.045 * a[2], Math.max(2, Math.abs(b[1] - a[1]) / 2), 0, 0, 7); g.fill(); void sc; }
      g.restore();
    }
  };

  // 몸 그리기: 관절 위치를 세계 좌표로 바꿔 투영하고, 먼 쪽부터
  P.drawBody = function (g, o) {
    if (!o) return;
    const A = AV[this.av], Hh = o.H, L = o.L, pv = o.pelvis, side = this.view === 'side';
    const skin = A.skin, sk = (k) => `rgb(${skin[0] * k | 0},${skin[1] * k | 0},${skin[2] * k | 0})`;
    const W3 = (x, y, z) => this.project(pv.x + x, y, z);
    const tilt = pv.tilt * D2R;
    // 골반 좌우 기울기: 엉덩관절 높이가 좌우로 다름
    // 골반 좌우 기울기(tilt +: 오른쪽 엉덩이가 내려감)
    const hipP = (s) => { const z = o.legs[s].hipZ; return [0, pv.y + (s === 'R' ? -1 : 1) * Math.sin(tilt) * Math.abs(z), pv.z + z]; };
    const leg = (s) => {
      const c = o.chains[s], l = o.legs[s], h = hipP(s), fs = (o.footShift && o.footShift[s]) || 0;
      const fz = l.lat + (o.standing ? 0 : pv.z * 0.15);
      const kz = lerp(h[2], fz, 0.5);
      return { hip: h, knee: [c.knee[0], h[1] + c.knee[1], kz], ankle: [c.ankle[0] + fs, h[1] + c.ankle[1], fz], heel: [c.heel[0] + fs, h[1] + c.heel[1], fz], toe: [c.toe[0] + fs, h[1] + c.toe[1], fz + (l.outToe ? (s === 'R' ? -1 : 1) * 0.04 : 0)] };
    };
    const legs = { R: leg('R'), L: leg('L') };
    // 몸통: 골반 위로 앞·옆 기울기
    const tf = o.trunk.fwd * D2R, tl = o.trunk.lat * D2R, TL = 0.29 * Hh, NK = 0.045 * Hh, HR = (A.child ? 0.078 : 0.064) * Hh;
    const up = [Math.sin(tf), Math.cos(tf) * Math.cos(tl), Math.sin(tl)];
    const hipC = [0, pv.y, pv.z];
    const shC = [hipC[0] + up[0] * TL, hipC[1] + up[1] * TL, hipC[2] + up[2] * TL];
    const SHW = (A.child ? 0.11 : 0.125) * Hh;
    const shoulder = (s) => [shC[0], shC[1] - (s === 'R' ? 1 : -1) * Math.sin(tl) * SHW * 0.3, shC[2] + (s === 'R' ? -1 : 1) * SHW];
    const hd = (o.trunk.head) * D2R + tf * 0.4, hl = o.trunk.headLat * D2R + tl;
    const neckTop = [shC[0] + up[0] * NK, shC[1] + up[1] * NK, shC[2] + up[2] * NK];
    const headC = [neckTop[0] + Math.sin(hd) * HR * 0.9, neckTop[1] + Math.cos(hd) * HR * 1.05, neckTop[2] + Math.sin(hl) * HR * 0.8];
    const nose = [headC[0] + HR * 1.05, headC[1] - HR * 0.12, headC[2]];
    const arm = (s) => {
      const a = o.legs[s].arm, S0 = shoulder(s), sg = s === 'R' ? -1 : 1, UA = 0.186 * Hh, FA = 0.146 * Hh, HD = 0.07 * Hh;
      if (a.tgt) {                // 손끝을 목표로(코 비중 a.nose 만큼 코 쪽으로)
        let T = a.tgt.slice();
        if (a.nose) T = [lerp(T[0], nose[0] + 0.012 * Hh, a.nose), lerp(T[1], nose[1], a.nose), lerp(T[2], nose[2], a.nose)];
        if (a.nose != null) { const m = Math.sin(Math.PI * clamp(a.nose, 0, 1)); T[0] += m * 0.05 * Hh; T[1] -= m * 0.03 * Hh; }   // 가운데에서 조금 앞으로 돌아감
        if (a.err) T = add(T, a.err);
        const r = ik3(S0, [T[0], T[1], T[2]], UA, FA + HD, a.pole || [-0.5, -1, sg * 0.6]);
        return { S: S0, E: r.E, Wr: add(r.E, mul(sub(r.T, r.E), FA / (FA + HD))), Hn: r.T };
      }
      const sh = a.sh * D2R, ab = a.abd * D2R, el = a.el * D2R;
      const ud = [Math.sin(sh) * Math.cos(ab), -Math.cos(sh) * Math.cos(ab), sg * Math.sin(ab)];
      const E = [S0[0] + ud[0] * UA, S0[1] + ud[1] * UA, S0[2] + ud[2] * UA];
      const fa = sh + el, fd = [Math.sin(fa) * Math.cos(ab * 0.6), -Math.cos(fa) * Math.cos(ab * 0.6), sg * Math.sin(ab * 0.6) - (o.legs[s].arm.el > 60 ? sg * 0.5 : 0)];
      const n = Math.hypot(...fd); const Wr = [E[0] + fd[0] / n * FA, E[1] + fd[1] / n * FA, E[2] + fd[2] / n * FA];
      return { S: S0, E, Wr, Hn: [Wr[0] + fd[0] / n * HD, Wr[1] + fd[1] / n * HD, Wr[2] + fd[2] / n * HD] };
    };
    const arms = { R: arm('R'), L: arm('L') };
    const PJ = (p3) => W3(p3[0], p3[1], p3[2]);
    const cap = (a, b, w, col, outline) => {   // 둥근 막대(팔다리)
      const A2 = PJ(a), B2 = PJ(b), sc = (A2[2] + B2[2]) / 2;
      g.lineCap = 'round';
      if (outline !== false) { g.strokeStyle = 'rgba(40,28,22,0.35)'; g.lineWidth = w * sc + 2; g.beginPath(); g.moveTo(A2[0], A2[1]); g.lineTo(B2[0], B2[1]); g.stroke(); }
      g.strokeStyle = col; g.lineWidth = w * sc; g.beginPath(); g.moveTo(A2[0], A2[1]); g.lineTo(B2[0], B2[1]); g.stroke();
    };
    const drawLeg = (s, dim) => {
      const l = legs[s], k = dim ? 0.86 : 1;
      cap(l.knee, l.ankle, 0.062 * Hh, sk(k));
      // 발: 뒤꿈치~발끝 다각형
      const he = PJ(l.heel), to = PJ(l.toe), an = PJ(l.ankle), sc = an[2];
      g.fillStyle = sk(k * 0.97); g.strokeStyle = 'rgba(40,28,22,0.4)'; g.lineWidth = 1;
      g.beginPath();
      if (side) { g.moveTo(he[0], he[1]); g.lineTo(to[0], to[1]); g.lineTo(to[0] - (to[0] - an[0]) * 0.35, to[1] - 0.035 * Hh * sc); g.lineTo(an[0] - 0.02 * Hh * sc, an[1]); }
      else { const w = 0.042 * Hh * sc, cy = Math.max(he[1], to[1]) - w * 0.3; g.ellipse((he[0] + to[0]) / 2, cy, w, w * 0.42 + Math.abs(to[1] - he[1]) * 0.35, 0, 0, 7); }   // 앞에서 본 발: 납작하게
      g.closePath(); g.fill(); g.stroke();
      cap(l.hip, l.knee, 0.085 * Hh, sk(k));
      // 반바지(넓적다리 윗부분)
      const mid = [lerp(l.hip[0], l.knee[0], 0.34), lerp(l.hip[1], l.knee[1], 0.34), lerp(l.hip[2], l.knee[2], 0.34)];
      cap(l.hip, mid, 0.094 * Hh, dim ? '#6d90c2' : SHORTS, false);
      // 쿵쿵 걸음: 발이 닿을 때 먼지 표시
      if (this.lastStamp && this.lastStamp.s === s && this.t - this.lastStamp.t < 0.25) {
        g.strokeStyle = `rgba(120,100,80,${0.6 - (this.t - this.lastStamp.t) * 2})`; g.lineWidth = 1.5;
        for (const d of [-1, 1]) { g.beginPath(); g.moveTo(he[0] + d * 8, he[1] + 2); g.lineTo(he[0] + d * 18, he[1] - 4); g.stroke(); }
      }
    };
    const drawHand = (Wr, Hn, rot, k) => {
      const f = norm(sub(Hn, Wr));
      let w0 = cross(f, [0, 1, 0]); if (Math.hypot(...w0) < 0.2) w0 = [0, 0, 1]; w0 = norm(w0);
      const fw = cross(f, w0), w = add(mul(w0, Math.cos(rot)), mul(fw, Math.sin(rot)));
      const palm = dot(cross(f, w), this.camDir(lerp3(Wr, Hn, 0.5))) > 0, hw = 0.027 * Hh, tip = add(Hn, mul(f, 0.012 * Hh));
      cap(Wr, tip, 0.024 * Hh, sk(k * 0.95));                                  // 옆으로 서도 손이 사라지지 않게
      const q = [add(Wr, mul(w, hw * 0.75)), add(tip, mul(w, hw)), add(tip, mul(w, -hw)), add(Wr, mul(w, -hw * 0.75))].map(PJ);
      g.fillStyle = palm ? `rgb(${Math.min(255, skin[0] * k * 1.04 + 8) | 0},${skin[1] * k * 0.93 | 0},${skin[2] * k * 0.95 | 0})` : sk(k);
      g.strokeStyle = 'rgba(40,28,22,0.45)'; g.lineWidth = 1; g.lineJoin = 'round';
      g.beginPath(); q.forEach((r, i) => i ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1])); g.closePath(); g.fill(); g.stroke();
      if (palm) {                                                              // 손바닥 주름
        const c1 = PJ(add(lerp3(Wr, tip, 0.45), mul(w, hw * 0.5))), c2 = PJ(add(lerp3(Wr, tip, 0.6), mul(w, -hw * 0.5)));
        g.strokeStyle = 'rgba(150,80,70,0.35)'; g.beginPath(); g.moveTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      }
    };
    const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    const drawArm = (s, dim) => {
      const a = arms[s], k = dim ? 0.86 : 1, rot = o.legs[s].arm.rot;
      cap(a.E, a.Wr, 0.042 * Hh, sk(k));
      if (rot != null) drawHand(a.Wr, a.Hn, rot, k); else cap(a.Wr, a.Hn, 0.046 * Hh, sk(k * 0.98));
      cap(a.S, a.E, 0.052 * Hh, sk(k));
      const mid = [lerp(a.S[0], a.E[0], 0.5), lerp(a.S[1], a.E[1], 0.5), lerp(a.S[2], a.E[2], 0.5)];
      cap(a.S, mid, 0.064 * Hh, dim ? GOWN_D : GOWN, false);   // 소매
    };
    const drawTrunk = () => {
      const hw = (A.child ? 0.1 : 0.115) * Hh, dp = 0.075 * Hh;
      const pts = side
        ? [[-dp * 0.9, 0, 0], [dp * 0.95, 0, 0], [shC[0] + dp * 0.8, shC[1], 0], [shC[0] - dp * 0.9, shC[1] - 0.01 * Hh, 0]]
        : [[0, 0, -hw], [0, 0, hw], [shC[0], shC[1], shC[2] + SHW * 1.05], [shC[0], shC[1], shC[2] - SHW * 1.05]];
      const P2 = pts.map((q, i) => side ? PJ([q[0] + (i < 2 ? 0 : 0), i < 2 ? pv.y + q[1] - 0.02 * Hh : q[1], pv.z]) : PJ([q[0], i < 2 ? pv.y - 0.03 * Hh : q[1], i < 2 ? pv.z + q[2] : q[2]]));
      g.fillStyle = GOWN; g.strokeStyle = 'rgba(40,60,90,0.45)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(P2[0][0], P2[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(P2[i][0], P2[i][1]);
      g.closePath(); g.fill(); g.stroke();
      // 반바지 허리
      const w1 = PJ(side ? [-dp, pv.y - 0.03 * Hh, pv.z] : [0, pv.y - 0.03 * Hh, pv.z - hw]), w2 = PJ(side ? [dp, pv.y - 0.03 * Hh, pv.z] : [0, pv.y - 0.03 * Hh, pv.z + hw]);
      const w3 = PJ(side ? [dp, pv.y - 0.09 * Hh, pv.z] : [0, pv.y - 0.1 * Hh, pv.z + hw]), w4 = PJ(side ? [-dp, pv.y - 0.09 * Hh, pv.z] : [0, pv.y - 0.1 * Hh, pv.z - hw]);
      g.fillStyle = SHORTS; g.beginPath(); g.moveTo(w1[0], w1[1]); g.lineTo(w2[0], w2[1]); g.lineTo(w3[0], w3[1]); g.lineTo(w4[0], w4[1]); g.closePath(); g.fill();
      cap(shC, neckTop, 0.05 * Hh, sk(0.97), false);
    };
    const drawHead = () => {
      const c = PJ(headC), r = HR * c[2];
      g.fillStyle = sk(1); g.strokeStyle = 'rgba(40,28,22,0.4)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(c[0], c[1], r * 0.92, r * 1.08, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = A.hair;
      if (side) {           // 옆얼굴: 오른쪽을 봄
        const hd2 = o.trunk.head * D2R;
        g.beginPath(); g.ellipse(c[0] - r * 0.12, c[1] - r * 0.3, r * 0.95, r * 0.82, 0, Math.PI * 0.95, Math.PI * 2.08); g.fill();
        if (A.long) { g.beginPath(); g.ellipse(c[0] - r * 0.75, c[1] + r * 0.05, r * 0.35, r * 0.55, 0, 0, 7); g.fill(); }
        g.fillStyle = sk(0.93); g.beginPath(); g.moveTo(c[0] + r * 0.86, c[1] - r * 0.05 + hd2 * r * 0.4); g.lineTo(c[0] + r * 1.08, c[1] + r * 0.18 + hd2 * r * 0.4); g.lineTo(c[0] + r * 0.86, c[1] + r * 0.28 + hd2 * r * 0.4); g.fill();
        g.fillStyle = '#2a1e18';
        if (o.eyes) { g.beginPath(); g.arc(c[0] + r * 0.6, c[1] - r * 0.08 + hd2 * r * 0.4, Math.max(1.2, r * 0.07), 0, 7); g.fill(); }
        else { g.strokeStyle = '#2a1e18'; g.lineWidth = Math.max(1, r * 0.05); g.beginPath(); g.moveTo(c[0] + r * 0.5, c[1] - r * 0.06 + hd2 * r * 0.4); g.lineTo(c[0] + r * 0.7, c[1] - r * 0.04 + hd2 * r * 0.4); g.stroke(); }
        g.fillStyle = sk(0.88); g.beginPath(); g.ellipse(c[0] - r * 0.1, c[1] + r * 0.05, r * 0.14, r * 0.2, 0, 0, 7); g.fill();
      } else {
        g.beginPath(); g.ellipse(c[0], c[1] - r * 0.42, r * 0.97, r * 0.7, 0, Math.PI * 1.02, Math.PI * 1.98); g.fill();
        g.beginPath(); g.ellipse(c[0], c[1] - r * 0.55, r * 0.9, r * 0.5, 0, 0, Math.PI, true); g.fill();
        if (A.long) { g.beginPath(); g.ellipse(c[0] - r * 0.9, c[1] + r * 0.1, r * 0.22, r * 0.6, 0, 0, 7); g.ellipse(c[0] + r * 0.9, c[1] + r * 0.1, r * 0.22, r * 0.6, 0, 0, 7); g.fill(); }
        g.fillStyle = '#2a1e18'; g.strokeStyle = '#2a1e18'; g.lineWidth = Math.max(1, r * 0.05);
        for (const d of [-1, 1]) {
          if (o.eyes) { g.beginPath(); g.arc(c[0] + d * r * 0.36, c[1] - r * 0.02 + o.trunk.head * 0.01 * r, Math.max(1.2, r * 0.075), 0, 7); g.fill(); }
          else { g.beginPath(); g.moveTo(c[0] + d * r * 0.24, c[1]); g.lineTo(c[0] + d * r * 0.48, c[1]); g.stroke(); }
        }
        g.beginPath(); g.moveTo(c[0] - r * 0.18, c[1] + r * 0.48); g.lineTo(c[0] + r * 0.18, c[1] + r * 0.48); g.stroke();
      }
    };
    // 그림자
    if (CLOSE[this.task]) {
      if (o.exam) {             // 검사자 손(흰 가운 소매)
        const f = o.exam.fp, fr = !side;          // 앞에서 볼 때는 검사자 팔이 화면 오른쪽 옆에서 들어옴
        const el = add(f, fr ? [0.05 * Hh, -0.1 * Hh, 0.22 * Hh] : [0.2 * Hh, -0.1 * Hh, 0.04 * Hh]), sl = add(el, fr ? [0.03 * Hh, -0.05 * Hh, 0.12 * Hh] : [0.12 * Hh, -0.05 * Hh, 0.02 * Hh]);
        cap(sl, el, 0.07 * Hh, '#f3f5f6'); cap(el, add(f, [0.03 * Hh, -0.01 * Hh, 0]), 0.045 * Hh, '#e2b996');
        cap(add(f, [0.03 * Hh, -0.01 * Hh, 0]), f, 0.016 * Hh, '#e2b996');
      }
      const byDepth = (a, b) => this.depth(legs[b].ankle) - this.depth(legs[a].ankle);
      const lo = ['R', 'L'].sort(byDepth);
      if (side) { drawArm('L', true); drawTrunk(); drawHead(); lo.forEach((s) => drawLeg(s, s === 'L')); drawArm('R', false); }
      else { lo.forEach((s) => drawLeg(s, false)); drawTrunk(); drawHead(); drawArm('R', false); drawArm('L', false); }
      return;
    }
    const sh0 = PJ([0, 0, pv.z]);
    g.fillStyle = 'rgba(60,50,40,0.18)'; g.beginPath(); g.ellipse(sh0[0], side ? 507 : sh0[1] + 2, 0.22 * Hh * sh0[2], 0.03 * Hh * sh0[2] + 3, 0, 0, 7); g.fill();
    if (side) {              // 왼쪽(먼 쪽) → 몸통 → 오른쪽(가까운 쪽)
      drawArm('L', true); drawLeg('L', true); drawTrunk(); drawHead(); drawLeg('R', false); drawArm('R', false);
    } else {                 // 앞: 다리(더 앞에 있는 다리를 나중에) → 몸통 → 머리 → 팔
      const order = legs.R.ankle[0] > legs.L.ankle[0] ? ['L', 'R'] : ['R', 'L'];
      drawLeg(order[0], false); drawLeg(order[1], false); drawTrunk(); drawArm('R', false); drawArm('L', false); drawHead();
    }
  };

  // 화면에 적을 관찰값(학생에게도 보이는 객관적 측정): 분당 걸음 수, 평균 보폭, 발 간격
  P.measure = function () {
    if (this.task === 'romberg' || CLOSE[this.task] || this.p.unable) return null;
    const pr = this.prints, st = this.stepTimes;
    if (pr.length < 4 || st.length < 4) return null;
    const cad = 60 * (st.length - 1) / (st[st.length - 1] - st[0]);
    let len = 0, n = 0, wid = 0;
    for (let i = 1; i < pr.length; i++) if (pr[i].s !== pr[i - 1].s) { len += Math.abs(pr[i].x - pr[i - 1].x); wid += Math.abs(pr[i].z - pr[i - 1].z); n++; }
    return n ? { cadence: Math.round(cad), step: len / n, width: wid / n } : null;
  };
  // 정해진 시간만큼 진행(스냅샷·일괄 생성용)
  P.run = function (sec) { for (let t = 0; t < sec; t += 1 / 60) this.advance(1 / 60); };
  P.snap = function () { this.draw(); return this.c.toDataURL('image/jpeg', 0.9); };
  GaitEngine.AV = AV;
  window.GaitEngine = GaitEngine;
})();
