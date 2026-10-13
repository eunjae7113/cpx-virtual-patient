/* 보행 진찰 엔진 (Canvas 2D, 외부 라이브러리 없음)
 * 환자 몸을 간단한 3D 뼈대(x 앞, y 위, z 좌우: 환자 왼쪽 +)로 계산하고, '옆에서 보기'(환자 오른쪽이 보임)와
 * '앞에서 보기'(환자가 다가옴, 환자 오른쪽 = 화면 왼쪽)로 그린다.
 * 걸음: 정상 보행의 엉덩·무릎·발목 각도 곡선(보행 주기 10% 간격)에 질환별 파라미터를 입힘. 디딘 발을 바닥에 고정해 몸을 앞으로 옮김(미끄러짐 없음)
 * 검사: walk 걸음걸이 / heel 발뒤꿈치 보행 / toe 발끝 보행 / romberg (발 모으고 눈 뜨고 → 눈 감고)
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
    R: {}, L: {},
    rom: { open: 0.4, closed: 0.6, dir: 0, fall: 0, wide: 0 },
  };
  // 다리별: stanceShort 아픈 쪽 디딤 짧게(절뚝임), kneeStiff 흔들 때 무릎 덜 굽힘, footDrop 발처짐, steppage 발 높이 들기,
  // circum 휘돌림, hipDrop 반대쪽 골반 처짐(트렌델렌버그), noPush 발끝 밀기 없음, outToe 발끝 바깥, heelWeak/toeWeak 발뒤꿈치·발끝 보행 못 함, armHeld 팔 굽혀 붙임
  const SIDE = { stanceShort: 0, kneeStiff: 0, footDrop: 0, steppage: 0, circum: 0, hipDrop: 0, noPush: 0, outToe: 0, heelWeak: 0, toeWeak: 0, armHeld: 0, stride: 1, equinus: 0 };

  function GaitEngine(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.view = 'side'; this.task = 'walk'; this.av = 'm_m'; this.sev = 1;
    this.setGait({});
    this.reset();
  }
  GaitEngine.VIEWS = { side: '옆에서', front: '앞에서' };
  GaitEngine.TASKS = { walk: '걸음걸이', heel: '발뒤꿈치 보행', toe: '발끝 보행', romberg: 'Romberg' };
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
    this.fallen = 0;
    this.pose = this.solve(0);
  };
  P.say = function (line) { this.sayQ.push(line); };
  P.takeSay = function () { return this.sayQ.shift() || null; };

  // ------------------------------------------------------------------ 한 프레임 진행
  P.advance = function (dt) {
    this.t += dt;
    const p = this.p;
    if (this.task === 'romberg' || p.unable) { this.pose = this.solve(dt); return; }
    // 주기 속도: 기본 1.05초/주기. 아픈 쪽 디딤(입박)이 짧으면 그동안 빨리 지나감(절뚝임)
    let T = 1.05 / p.cadence * (AV[this.av].child ? 0.85 : 1) * (this.task === 'walk' ? 1 : 1.15);
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

    if (rom || p.unable) return this.solveStand(dt, L);

    for (const s of ['R', 'L']) {
      const q = p[s], ph = this.legPhase(s), sg = s === 'R' ? -1 : 1;
      const sw = ph > 0.6 ? Math.sin(Math.PI * (ph - 0.6) / 0.4) : 0;            // 흔듦 정도 0~1
      // 한 걸음마다 바뀌는 흔들림(실조): 발이 공중에 있을 때(흔듦 중간) 새로 뽑음 — 닿는 순간 바꾸면 발이 튐
      if (this.prevPh[s] < 0.72 && ph >= 0.72) {
        this.vr[s] = { lat: (this.rnd() * 2 - 1) * p.var, str: 1 + (this.rnd() * 2 - 1) * p.var * 0.45 };
      }
      this.prevPh[s] = ph;
      const strideK = p.stride * q.stride * this.vr[s].str * (1 - p.shuffle * 0.6) * (task === 'walk' ? 1 : 0.75);
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
    const swayZ = side * (0.018 + p.waddle * 0.05 + p.sway * 0.03) * Hh / 1.7 + (p.var ? Math.sin(t * 1.7) * p.var * 0.05 : 0) + cn(0, 1.9) * 0.05;
    let drop = side * p.waddle * 7 + cn(1, 2.2) * 6;                     // 골반 기울기(도): 흔드는 쪽이 처짐
    if (wR && !wL) drop += -p.R.hipDrop * 9; if (wL && !wR) drop += p.L.hipDrop * 9;
    const hike = -(out.legs.R.sw * p.R.circum - out.legs.L.sw * p.L.circum) * 5;     // 휘돌리는 쪽 골반을 들어 올림
    const trunkLat = side * (p.waddle * 10 + (p.R.hipDrop + p.L.hipDrop) * 7) + cn(2, 1.6) * 9 + (p.var ? Math.sin(t * 1.3 + 1) * p.var * 6 : 0);
    const trunkFwd = p.trunkFwd * 32 + (A.old || 0) * 6 - p.lordosis * 9 + cn(3, 1.4) * 6 + (p.var ? Math.sin(t * 2.1) * p.var * 4 : 0);
    out.pelvis = { x: this.dist, y: pelY, z: swayZ, tilt: drop + hike };
    out.trunk = { fwd: trunkFwd, lat: trunkLat, head: p.headDown * 25 + (A.old || 0) * 6 + cn(4, 2.5) * 10, headLat: cn(5, 1.8) * 12 };
    out.chains = chains;
    // 팔: 반대쪽 다리와 함께 흔듦
    for (const s of ['R', 'L']) {
      const o = s === 'R' ? 'L' : 'R', q = p[s];
      const swing = (out.legs[o].hip + 2) * 0.75 * p.armSwing * (1 - q.armHeld);      // 반대쪽 다리와 같은 방향
      out.legs[s].arm = { sh: swing + cn(s === 'R' ? 1 : 3, 2) * 25, el: p.elbow + q.armHeld * 80 + (p.armSwing < 0.5 ? 15 : 0), abd: q.armHeld * 10 + p.var * 14 + p.stamp * 8 + Math.abs(cn(s === 'R' ? 2 : 4, 2.4)) * 25 };
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

  // ------------------------------------------------------------------ 그리기
  P.project = function (x, y, z) {               // 세계 좌표(m) → 화면
    const Hh = AV[this.av].h;
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
    g.fillStyle = 'rgba(40,50,55,0.75)'; g.textAlign = 'right'; g.fillText(this.view === 'side' ? '옆에서 봄 · 환자 오른쪽이 보임' : '앞에서 봄 · 환자 오른쪽 = 화면 왼쪽', W - 14, 22);
    if (this.fade > 0) { g.fillStyle = `rgba(233,238,236,${this.fade})`; g.fillRect(0, 0, W, H); }
  };

  P.drawRoom = function (g) {
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
    const arm = (s) => {
      const a = o.legs[s].arm, S0 = shoulder(s), sg = s === 'R' ? -1 : 1, UA = 0.186 * Hh, FA = 0.146 * Hh, HD = 0.07 * Hh;
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
    const drawArm = (s, dim) => {
      const a = arms[s], k = dim ? 0.86 : 1;
      cap(a.E, a.Wr, 0.042 * Hh, sk(k)); cap(a.Wr, a.Hn, 0.046 * Hh, sk(k * 0.98));
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
    if (this.task === 'romberg' || this.p.unable) return null;
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
