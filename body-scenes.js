/* 전신 진찰 장면 그림 (Canvas 2D) — 소리가 없는 진찰 항목(시진·촉진·신경·인지)을 파라미터대로 그리고 반응시킨다
 * BodyEngine.SCENES[장면] = { pts() 진찰 지점, draw(g) 그림, exam(q) 지점을 눌렀을 때 {say 환자 대사, felt 손끝·눈으로 확인한 것},
 *                            auto() '진찰하기' 단추, tick() 매 프레임, hint 첫 안내 }   (this = 엔진)
 * felt 에는 진단 이름을 쓰지 않는다(학생 모드에서도 보임). 숫자·등급처럼 학생이 판단할 것은 되도록 모양으로만 보여 줌.
 * 좌표: 앞에서 본 그림은 환자 오른쪽(R) = 화면 왼쪽. 뒤에서 본 그림(등·아킬레스건)은 반대이고 그림에 글자로 표시.
 * 파라미터 뜻은 tools/body_presets.py 의 프로필 참고. 모든 그림은 교육용 도식(실제 사진 아님).
 */
(function () {
  'use strict';
  const BE = window.BodyEngine, S = BE.SCENES, W = 1200, H = 600, CX = 600, mix = BE.mix;
  const FONT = '"IBM Plex Sans KR", sans-serif', LINE = 'rgba(0,0,0,.35)';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (k) => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const sideName = (d) => d < 0 ? '오른쪽' : '왼쪽';
  const SIDES = [['R', -1], ['L', 1]];

  function ell(g, x, y, rx, ry, fill, stroke, lw) {
    g.beginPath(); g.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, 7);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = lw || 2; g.strokeStyle = stroke; g.stroke(); }
  }
  function txt(g, s, x, y, o = {}) { g.font = `${o.w || 400} ${o.size || 15}px ${FONT}`; g.fillStyle = o.c || '#cfe0dc'; g.textAlign = o.al || 'left'; g.fillText(s, x, y); }
  function limb(g, pts, w, col) {
    g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = w + 4; g.stroke(); g.strokeStyle = col; g.lineWidth = w; g.stroke();
  }
  function rrect(g, x, y, w, h, r, fill, stroke) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } }
  function floor(g, y) { g.fillStyle = '#18242a'; g.fillRect(0, y, W, H - y); }
  function note(g, s, x, y) { txt(g, s, x, y, { size: 13, c: '#7f918d', al: 'center' }); }
  function inset(g, x, y, r, title) { ell(g, x, y, r, r, '#1a2529', 'rgba(150,200,190,.35)', 2); if (title) note(g, title, x, y + r + 18); }
  function dots(g, rnd, n, x, y, rx, ry, r, col) { g.fillStyle = col; for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()); g.beginPath(); g.arc(x + Math.cos(a) * d * rx, y + Math.sin(a) * d * ry, r * (0.6 + rnd() * 0.6), 0, 7); g.fill(); } }
  // 검사자 손가락(장갑) / 소리굽쇠 / 솜 — 진찰 동작 표시
  function finger(g, x, y, k) { g.save(); g.translate(x, y); g.rotate(-0.6); rrect(g, -9, -4 - 60 * (1 - k), 18, 60, 9, '#a9cbe6', 'rgba(0,0,0,.3)'); g.restore(); }
  function fork(g, x, y, t) { g.save(); g.translate(x, y); g.strokeStyle = '#c9ced3'; g.lineWidth = 4; const v = Math.sin(t * 60) * 2; g.beginPath(); g.moveTo(-6 + v, -50); g.lineTo(-6, -10); g.moveTo(6 - v, -50); g.lineTo(6, -10); g.moveTo(-6, -10); g.quadraticCurveTo(0, 0, 6, -10); g.moveTo(0, -4); g.lineTo(0, 30); g.stroke(); g.strokeStyle = 'rgba(232,215,166,.6)'; g.lineWidth = 1.5; for (const r of [14, 22]) { g.beginPath(); g.arc(0, -40, r + (t * 20 % 8), -0.6, 0.6); g.stroke(); g.beginPath(); g.arc(0, -40, r + (t * 20 % 8), Math.PI - 0.6, Math.PI + 0.6); g.stroke(); } g.restore(); }
  function ring(g, x, y, k, col) { if (k > 1.5) return; g.strokeStyle = col || `rgba(232,215,166,${clamp(1 - k / 1.5, 0, 1)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 16 + k * 30, 0, 7); g.stroke(); }

  // ---- 얼굴(앞모습). o: eR/eL 눈 뜬 정도 0~1, bR/bL 눈썹 올림, mR/mL 입꼬리(+위), open 입 벌림, teeth, pursed, gx/gy 시선,
  //      wide 얼굴 폭, cyan 입술 청색, puffy 눈 부기, parR/parL 이하선 부기, flatR/flatL 코입술 주름 없음, flare 콧볼 벌렁임
  function face(e, g, cx, cy, s, o = {}) {
    const sk = o.skin || e.skin(), wide = o.wide || 1;
    for (const d of [-1, 1]) ell(g, cx + d * 0.79 * s * wide, cy + 0.02 * s, 0.12 * s, 0.21 * s, sk, LINE);
    for (const d of [-1, 1]) { const v = d < 0 ? o.parR : o.parL; if (v) ell(g, cx + d * 0.7 * s * wide, cy + 0.34 * s, 0.22 * s * v, 0.27 * s * v, mix(sk, '#c98a7a', 0.15), LINE); }
    ell(g, cx, cy, 0.78 * s * wide, s, sk, LINE);
    if (o.hair !== false) {
      g.save(); g.beginPath(); g.ellipse(cx, cy, 0.78 * s * wide, s, 0, 0, 7); g.clip();
      g.fillStyle = o.hairC || '#2b221d'; g.beginPath(); g.ellipse(cx, cy - 0.86 * s, 0.95 * s * wide, 0.44 * s, 0, 0, 7); g.fill(); g.restore();
    }
    for (const d of [-1, 1]) {
      const r = d < 0 ? (o.bR || 0) : (o.bL || 0);
      if (r > 0.4) { g.strokeStyle = `rgba(90,50,30,${0.4 * r})`; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx + d * 0.04 * s, cy - (0.38 + i * 0.05) * s); g.quadraticCurveTo(cx + d * 0.25 * s, cy - (0.41 + i * 0.05) * s, cx + d * 0.46 * s, cy - (0.37 + i * 0.05) * s); g.stroke(); } }
    }
    for (const d of [-1, 1]) {
      const op = clamp(d < 0 ? (o.eR == null ? 1 : o.eR) : (o.eL == null ? 1 : o.eL), 0, 1), ex = cx + d * 0.31 * s * wide, ey = cy - 0.08 * s, rx = 0.16 * s, ry = 0.075 * s * op;
      if (o.puffy) ell(g, ex, ey + 0.085 * s, 0.17 * s, 0.05 * s * o.puffy, mix(sk, '#c98a7a', 0.3), null);
      if (op < 0.08) { g.strokeStyle = '#3a2a22'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ex - rx, ey); g.quadraticCurveTo(ex, ey + 0.03 * s, ex + rx, ey); g.stroke(); }
      else {
        g.save(); g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, 7); g.fillStyle = o.sclera || '#f3efe8'; g.fill(); g.clip();
        const gx = ex + (o.gx || 0) * 0.07 * s, gy = ey + (d < 0 ? (o.gyR == null ? o.gy || 0 : o.gyR) : (o.gyL == null ? o.gy || 0 : o.gyL)) * 0.09 * s;
        ell(g, gx, gy, 0.065 * s, 0.065 * s, '#4a3326'); ell(g, gx, gy, 0.03 * s, 0.03 * s, '#111'); ell(g, gx - 0.02 * s, gy - 0.02 * s, 0.012 * s, 0.012 * s, '#fff');
        g.restore(); g.strokeStyle = '#3a2a22'; g.lineWidth = 2; g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, Math.PI, 2 * Math.PI); g.stroke();
      }
      const br = d < 0 ? (o.bR || 0) : (o.bL || 0), by = ey - 0.17 * s - br * 0.07 * s;
      g.strokeStyle = o.hairC || '#2b221d'; g.lineWidth = 0.035 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(ex - d * 0.15 * s, by + 0.02 * s); g.quadraticCurveTo(ex, by - 0.04 * s, ex + d * 0.17 * s, by + 0.01 * s); g.stroke();
    }
    g.strokeStyle = 'rgba(90,50,30,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 0.02 * s, cy - 0.02 * s); g.quadraticCurveTo(cx - 0.1 * s, cy + 0.2 * s, cx - 0.06 * s, cy + 0.24 * s); g.quadraticCurveTo(cx, cy + 0.27 * s, cx + 0.07 * s, cy + 0.24 * s); g.stroke();
    for (const d of [-1, 1]) ell(g, cx + d * 0.055 * s, cy + 0.235 * s, 0.025 * s * (1 + (o.flare || 0)), 0.014 * s, 'rgba(60,30,20,.55)');
    const my = cy + 0.47 * s, mw = 0.24 * s * (o.pursed ? 0.45 : 1) * (1 + 0.12 * Math.max(o.mR || 0, o.mL || 0, 0));
    const yR = my - (o.mR || 0) * 0.07 * s, yL = my - (o.mL || 0) * 0.07 * s, op = o.open || 0;
    const lip = o.lip || (o.cyan ? '#7a6f9a' : mix(sk, '#b24a4a', 0.45));
    for (const d of [-1, 1]) {
      if (d < 0 ? o.flatR : o.flatL) continue;
      const m = d < 0 ? (o.mR || 0) : (o.mL || 0);
      g.strokeStyle = `rgba(90,50,30,${(0.2 + 0.35 * Math.max(0, m))})`; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + d * 0.12 * s, cy + 0.22 * s); g.quadraticCurveTo(cx + d * 0.27 * s, cy + 0.32 * s, cx + d * (mw / s + 0.05) * s, (d < 0 ? yR : yL) + 0.02 * s); g.stroke();
    }
    g.beginPath(); g.moveTo(cx - mw, yR); g.quadraticCurveTo(cx, my - 0.05 * s, cx + mw, yL); g.quadraticCurveTo(cx, my + 0.07 * s + op * 0.3 * s, cx - mw, yR); g.closePath(); g.fillStyle = lip; g.fill();
    if (op > 0.05 || o.teeth) {
      g.save(); g.beginPath(); g.moveTo(cx - mw * 0.85, yR + 0.01 * s); g.quadraticCurveTo(cx, my - 0.02 * s, cx + mw * 0.85, yL + 0.01 * s); g.quadraticCurveTo(cx, my + 0.035 * s + op * 0.26 * s, cx - mw * 0.85, yR + 0.01 * s); g.fillStyle = '#3a1414'; g.fill();
      if (o.teeth) { g.clip(); g.fillStyle = '#f2ede2'; g.fillRect(cx - mw, my - 0.05 * s, 2 * mw, 0.06 * s); }
      g.restore();
    }
    g.strokeStyle = 'rgba(80,30,30,.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx - mw, yR); g.quadraticCurveTo(cx, my + 0.01 * s, cx + mw, yL); g.stroke();
    if (o.drool) { g.fillStyle = 'rgba(220,235,245,.7)'; g.beginPath(); g.moveTo(cx + 0.1 * s, my + 0.04 * s); g.quadraticCurveTo(cx + 0.14 * s, my + 0.25 * s, cx + 0.1 * s, my + 0.3 * s); g.quadraticCurveTo(cx + 0.06 * s, my + 0.22 * s, cx + 0.08 * s, my + 0.04 * s); g.fill(); }
  }

  // ---- 서 있는 몸 전체(앞모습). 관절 위치를 돌려줌. o: legR 다리 짧음, varus 무릎 휨, footOutR 발 바깥돌림, armOut 팔 벌림
  function figure(e, g, cx, top, h, o = {}) {
    const sk = e.skin(), u = h / 100, J = {};
    for (const [k, d] of SIDES) {
      const sx = cx + d * 13 * u, sy = top + 18 * u, ao = o.armOut || 0;
      J['shoulder_' + k] = [sx, sy]; J['elbow_' + k] = [cx + d * (16 + ao * 5) * u, top + 34 * u]; J['wrist_' + k] = [cx + d * (18 + ao * 9) * u, top + 48 * u]; J['hand_' + k] = [cx + d * (19 + ao * 10) * u, top + 53 * u];
      const short = k === 'R' && o.legR ? o.legR * u : 0, vr = o.varus ? 2.2 * u : 0;
      J['hip_' + k] = [cx + d * 7 * u, top + 52 * u]; J['knee_' + k] = [cx + d * (7.5 * u + vr), top + 73 * u - short * 0.5]; J['ankle_' + k] = [cx + d * 7 * u, top + 94 * u - short]; J['foot_' + k] = [cx + d * (7 + (k === 'R' && o.footOutR ? 4 : 1.5)) * u, top + 98 * u - short];
    }
    for (const [k] of SIDES) { limb(g, [J['hip_' + k], J['knee_' + k], J['ankle_' + k]], 8 * u, sk); limb(g, [J['ankle_' + k], J['foot_' + k]], 4.5 * u, sk); }
    g.fillStyle = '#5f7f9a'; g.beginPath(); g.moveTo(cx - 12 * u, top + 47 * u); g.lineTo(cx + 12 * u, top + 47 * u); g.lineTo(cx + 13 * u, top + 60 * u); g.lineTo(cx + 1.5 * u, top + 60 * u); g.lineTo(cx, top + 56 * u); g.lineTo(cx - 1.5 * u, top + 60 * u); g.lineTo(cx - 13 * u, top + 60 * u); g.closePath(); g.fill();
    g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 14 * u, top + 17 * u); g.quadraticCurveTo(cx, top + 15 * u, cx + 14 * u, top + 17 * u); g.lineTo(cx + 11 * u, top + 48 * u); g.lineTo(cx - 11 * u, top + 48 * u); g.closePath(); g.fill(); g.stroke();
    for (const [k] of SIDES) { limb(g, [J['shoulder_' + k], J['elbow_' + k], J['wrist_' + k]], 6 * u, sk); ell(g, J['hand_' + k][0], J['hand_' + k][1], 2.6 * u, 3.6 * u, sk, LINE); }
    g.fillStyle = sk; g.fillRect(cx - 3 * u, top + 11 * u, 6 * u, 6 * u);
    ell(g, cx, top + 6.5 * u, 6 * u, 7 * u, sk, LINE);
    g.fillStyle = '#2b221d'; g.beginPath(); g.ellipse(cx, top + 3.5 * u, 6.2 * u, 4.2 * u, 0, Math.PI, 2 * Math.PI); g.fill();
    J.top = top; J.u = u; J.cx = cx;
    return J;
  }
  // 손(손등 또는 손바닥). side -1 = 환자 오른손(화면 왼쪽). 관절 부기 sw 0~1, red, ulnar 척측 편위, palm 손바닥
  function hand(e, g, x, y, s, side, o = {}) {
    const sk = e.skin(), pos = {};
    ell(g, x, y + 0.15 * s, 0.42 * s, 0.5 * s, sk, LINE);
    g.fillStyle = sk; g.fillRect(x - 0.3 * s, y + 0.5 * s, 0.6 * s, 0.45 * s);
    const fingers = [[-0.27, 0.55], [-0.09, 0.62], [0.09, 0.6], [0.26, 0.5]];
    const thumbSide = o.palm ? -side : side; // 손등에서 엄지는 몸 가운데 쪽(오른손이면 화면 오른쪽)
    fingers.forEach(([fx, len], i) => {
      const bx = x - thumbSide * fx * s, by = y - 0.3 * s, ang = (o.ulnar ? -thumbSide * 0.28 : 0) - thumbSide * (i - 1.5) * 0.04;
      const tip = [bx + Math.sin(ang) * len * s, by - Math.cos(ang) * len * s], mid = [bx + Math.sin(ang) * len * 0.5 * s, by - Math.cos(ang) * len * 0.5 * s];
      limb(g, [[bx, by], tip], 0.15 * s, sk);
      const n = ['index', 'middle', 'ring', 'little'][i]; pos['mcp_' + n] = [bx, by]; pos['pip_' + n] = mid; pos['tip_' + n] = tip;
    });
    const tb = [x + thumbSide * 0.36 * s, y + 0.1 * s], tt = [x + thumbSide * 0.7 * s, y - 0.32 * s];
    limb(g, [tb, tt], 0.17 * s, sk); pos.tip_thumb = tt; pos.web = [x + thumbSide * 0.3 * s, y - 0.1 * s]; pos.palm = [x, y + 0.15 * s];
    for (const key of ['mcp', 'pip']) {
      const v = o[key]; if (!v || !v.sw) continue;
      for (const n of ['index', 'middle', 'ring', 'little']) { const p = pos[key + '_' + n]; ell(g, p[0], p[1], 0.1 * s * (0.8 + v.sw), 0.1 * s * (0.8 + v.sw), mix(sk, '#c0504a', clamp((v.red || 0) * 0.8, 0, 0.6)), LINE); }
    }
    if (!o.palm) for (const n of ['index', 'middle', 'ring', 'little']) { const p = pos['mcp_' + n]; g.strokeStyle = 'rgba(90,50,30,.3)'; g.lineWidth = 1.5; g.beginPath(); g.arc(p[0], p[1], 0.05 * s, 0, 7); g.stroke(); }
    return pos;
  }
  // 누운 몸 옆모습(머리 왼쪽). a: neck 목 굽힘(도), hipN/kneeN 가까운 다리 고관절·무릎 굽힘, hipF/kneeF 먼 다리
  function lying(e, g, a) {
    const sk = e.skin(), by = 400, hip = [600, by - 45];
    rrect(g, 120, by, 960, 26, 6, '#3b4a52'); g.fillStyle = '#2f3c43'; g.fillRect(150, by + 26, 20, 120); g.fillRect(1030, by + 26, 20, 120);
    const leg = (hf, kf, far) => {
      const th = hf * Math.PI / 180, kn = [hip[0] + Math.cos(th) * 200, hip[1] - Math.sin(th) * 200];
      const t2 = th - kf * Math.PI / 180, an = [kn[0] + Math.cos(t2) * 190, kn[1] - Math.sin(t2) * 190];
      const ft = [an[0] + Math.cos(t2 + Math.PI / 2) * 40, an[1] - Math.sin(t2 + Math.PI / 2) * 40];
      limb(g, [hip, kn, an], far ? 40 : 44, far ? mix(sk, '#1a2529', 0.35) : sk); limb(g, [an, ft], 18, far ? mix(sk, '#1a2529', 0.35) : sk);
      return { kn, an };
    };
    leg(a.hipF || 0, a.kneeF || 0, true);
    g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2; rrect(g, 300, by - 95, 320, 90, 40, sk, LINE);
    g.fillStyle = '#5f7f9a'; rrect(g, 520, by - 95, 120, 90, 30, '#5f7f9a');
    const nk = (a.neck || 0) * Math.PI / 180, nb = [305, by - 55], hc = [nb[0] - Math.cos(nk) * 70, nb[1] - Math.sin(nk) * 70];
    limb(g, [nb, [nb[0] - Math.cos(nk) * 30, nb[1] - Math.sin(nk) * 30]], 34, sk);
    ell(g, hc[0], hc[1], 52, 46, sk, LINE); g.fillStyle = '#2b221d'; g.beginPath(); g.arc(hc[0] - 8, hc[1] + 4, 46, Math.PI * 0.45 + nk, Math.PI * 1.3 + nk); g.fill();
    ell(g, hc[0] + Math.cos(nk) * 14 - Math.sin(nk) * 22, hc[1] - 22 + Math.sin(nk) * 14, 5, 3, '#3a2a22');
    const near = leg(a.hipN || 0, a.kneeN || 0, false);
    return { hip, hc, ...near };
  }
  // 각도기
  function protractor(g, x, y, r, deg, from, col) {
    g.strokeStyle = 'rgba(150,200,190,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, -Math.PI / 2 - (from || 0), 0 - (from || 0), false); g.stroke();
    g.strokeStyle = col || '#e8d7a6'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r, -deg * Math.PI / 180 - (from || 0), -(from || 0)); g.stroke();
    txt(g, Math.round(deg) + '°', x + r + 10, y - r * 0.4, { size: 18, w: 600, c: col || '#e8d7a6' });
  }

  // 공용으로 다른 장면에서도 씀
  BE.draw = { ell, txt, limb, rrect, face, figure, hand, lying, inset, note, dots, finger, fork, ring, protractor, floor };

  // ================================================================ 의식
  const EYE0 = { alert: 1, confused: 1, drowsy: 0.3, stupor: 0, coma: 0 };
  function bodyTop(e, g, cx, motor, k) {
    const sk = e.skin();
    rrect(g, cx - 80, 230, 160, 230, 30, '#5f7f9a', LINE); txt(g, '몸(위에서 본 모습)', cx, 490, { size: 13, c: '#7f918d', al: 'center' });
    const rest = (d) => ({ e: [cx + d * 100, 340], h: [cx + d * 104, 430] });
    const tg = {
      localize: (d) => d < 0 ? { e: [cx - 110, 300], h: [cx - 15, 290] } : rest(d),
      withdraw: (d) => d < 0 ? { e: [cx - 150, 300], h: [cx - 165, 230] } : rest(d),
      extension: (d) => ({ e: [cx + d * 95, 365], h: [cx + d * 70, 460] }),
      obey: (d) => d < 0 ? { e: [cx - 130, 205], h: [cx - 130, 125] } : rest(d),
    }[motor] || rest;
    const pr = ease(k < 4 ? k / 0.8 : (5 - k));
    for (const d of [-1, 1]) {
      const r = rest(d), t = tg(d), E = lerp(r.e, t.e, clamp(pr, 0, 1)), Hh = lerp(r.h, t.h, clamp(pr, 0, 1));
      limb(g, [[cx + d * 78, 255], E, Hh], 30, sk); ell(g, Hh[0], Hh[1], 17, 15, sk, LINE);
    }
  }
  function locDraw(pain) {
    return function (g) {
      const p = this.p, lvl = p.lvl || 'alert', k = this.since();
      floor(g, 420); ell(g, 330, 300, 230, 110, '#cfd7da');
      let op = EYE0[lvl] == null ? 1 : EYE0[lvl];
      if (k < 5) {
        if (!pain && ['alert', 'confused', 'drowsy'].includes(lvl)) op = 1;
        if (pain && (lvl === 'drowsy' || lvl === 'confused' || lvl === 'alert')) op = 1;
        if (pain && lvl === 'stupor') op = k < 3.5 ? 0.5 : 0;
      }
      if (op > 0.5 && this.t % 4 < 0.12) op = 0.05;
      face(this, g, 330, 250, 140, { eR: op, eL: op, gx: lvl === 'confused' || lvl === 'drowsy' ? Math.sin(this.t * 0.8) * 0.8 : 0 });
      bodyTop(this, g, 860, pain ? p.motor : 'rest', pain ? k : 99);
      if (!pain && k < 3) { rrect(g, 470, 90, 250, 54, 14, 'rgba(232,215,166,.92)'); txt(g, '○○ 씨! 눈 떠 보세요!', 595, 124, { size: 18, w: 600, c: '#1a2529', al: 'center' }); }
      if (pain && k < 3) { const x = 860 + Math.sin(k * 14) * 10; finger(g, x, 300, 1); note(g, '흉골 문지르기', 860, 215); }
    };
  }
  const LOC_SAY = { confused: '아! 왜 그래요… 여기가 어디예요?', drowsy: '으… 아파요…', stupor: '으으…', coma: '' };
  S.loc_call = { pts() { return [{ k: 'call', x: 330, y: 120, n: '이름을 크게 불러 보기' }]; }, draw: locDraw(false), exam() { this.act = { k: 'act', t0: this.t }; return {}; }, auto() { return {}; }, hint: '이마 위 동그라미를 누르거나 진찰하기 — 이름을 불러 봅니다' };
  S.loc_pain = {
    pts() { return [{ k: 'rub', x: 860, y: 300, n: '흉골 문지르기(통증 자극)' }]; }, draw: locDraw(true),
    exam() { this.act = { k: 'act', t0: this.t }; return { say: LOC_SAY[this.p.lvl] || '' }; },
    auto() { return { say: LOC_SAY[this.p.lvl] || '' }; }, hint: '가슴 동그라미를 누르면 통증 자극을 줍니다',
  };

  // ================================================================ 피부: 황색종(아킬레스건)·흑색극세포증
  S.xan = {
    pts() { return [{ k: 'R', x: 780, y: 360, n: '오른쪽 아킬레스건 만지기' }, { k: 'L', x: 420, y: 360, n: '왼쪽 아킬레스건 만지기' }]; },
    draw(g) {
      floor(g, 500); const sk = this.skin();
      for (const [k, x] of [['L', 420], ['R', 780]]) {
        g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 85, 60); g.quadraticCurveTo(x - 105, 200, x - 45, 330); g.lineTo(x - 45, 470); g.quadraticCurveTo(x, 520, x + 45, 470); g.lineTo(x + 45, 330); g.quadraticCurveTo(x + 105, 200, x + 85, 60); g.closePath(); g.fill(); g.stroke();
        const v = this.p[k] || 0;
        g.fillStyle = mix(sk, '#b98a5a', 0.25); rrect(g, x - 12 - v * 14, 280, 24 + v * 28, 180, 12, mix(sk, '#c99a6a', 0.2 + v * 0.3));
        if (v) { const rnd = BE.mulberry(k === 'R' ? 3 : 5); for (let i = 0; i < 5; i++) ell(g, x + (rnd() - 0.5) * 30, 300 + i * 32, 14, 12, mix(sk, '#e0c070', 0.5), 'rgba(0,0,0,.15)'); }
        note(g, k === 'R' ? '환자 오른쪽' : '환자 왼쪽', x, 560);
      }
      note(g, '뒤에서 본 모습(엎드리거나 서서)', 600, 40);
    },
    exam(q) { return { felt: (this.p[q.k] ? '힘줄이 두껍고, 울퉁불퉁한 단단한 결절이 만져짐. 누르면 아프지 않음.' : '힘줄이 가늘고 고르며 결절이 없음.') }; },
  };
  S.akn = {
    pts() { return [{ k: 'neck', x: 600, y: 255, n: '목 뒤 피부 만지기' }, { k: 'ax', x: 960, y: 330, n: '겨드랑이 피부 보기' }]; },
    draw(g) {
      const sk = this.skin(), a = this.p.g || 0;
      floor(g, 520); g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2;
      g.beginPath(); g.moveTo(300, 600); g.quadraticCurveTo(320, 330, 520, 300); g.lineTo(680, 300); g.quadraticCurveTo(880, 330, 900, 600); g.closePath(); g.fill(); g.stroke();
      g.fillRect(530, 200, 140, 120); ell(g, 600, 150, 110, 120, '#2b221d', LINE);
      if (a) { const grd = g.createLinearGradient(0, 220, 0, 320); grd.addColorStop(0, 'rgba(60,40,30,0)'); grd.addColorStop(0.4, `rgba(60,40,30,${0.6 * a})`); grd.addColorStop(1, `rgba(60,40,30,${0.3 * a})`); g.fillStyle = grd; g.fillRect(530, 220, 140, 100); g.strokeStyle = `rgba(40,25,20,${0.4 * a})`; g.lineWidth = 1; for (let y = 240; y < 315; y += 7) { g.beginPath(); g.moveTo(535, y); g.quadraticCurveTo(600, y + 3, 665, y); g.stroke(); } }
      inset(g, 960, 330, 110, '겨드랑이 확대');
      g.save(); g.beginPath(); g.arc(960, 330, 108, 0, 7); g.clip(); g.fillStyle = sk; g.fillRect(850, 220, 220, 220); g.strokeStyle = LINE; g.beginPath(); g.moveTo(880, 260); g.quadraticCurveTo(960, 360, 1040, 260); g.stroke();
      if (a) { ell(g, 960, 320, 70, 45, `rgba(60,40,30,${0.55 * a})`); g.strokeStyle = `rgba(40,25,20,${0.35 * a})`; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(905, 295 + i * 6); g.lineTo(1015, 300 + i * 6); g.stroke(); } }
      g.restore(); note(g, '뒤에서 본 목', 600, 580);
    },
    exam(q) { const a = this.p.g || 0; return { felt: a ? (q.k === 'neck' ? '목 뒤 피부가 검게 변하고 벨벳처럼 도톰하며 약간 거침.' : '겨드랑이 피부가 검고 두꺼워 주름이 깊음.') : '피부가 매끈하고 색 변화가 없음.' }; },
  };

  // ================================================================ 머리
  function headBase(e, g, extra) {
    const p = e.p, big = p.big ? 1.12 : 1;
    floor(g, 520); face(e, g, 430, 290, 190 * big, Object.assign({ wide: p.big ? 1.08 : 1 }, extra || {}));
    const rnd = BE.mulberry(11);
    for (const [k, d] of SIDES) {
      if (p.bruise === k) { ell(g, 430 + d * 150 * big, 210, 46, 34, 'rgba(90,50,110,.45)'); if (p.old) ell(g, 430 + d * 140 * big, 330, 34, 26, 'rgba(150,150,60,.45)'); }
      if (p.lac === k) { g.strokeStyle = '#9b2a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(430 + d * 40, 170); g.lineTo(430 + d * 110, 155); g.stroke(); }
    }
    inset(g, 930, 190, 120, '머리카락·두피 확대');
    g.save(); g.beginPath(); g.arc(930, 190, 118, 0, 7); g.clip(); g.fillStyle = mix(e.skin(), '#f0e0d0', 0.3); g.fillRect(800, 60, 260, 260);
    g.strokeStyle = '#2b221d'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { const x = 820 + i * 17; g.beginPath(); g.moveTo(x, 320); g.quadraticCurveTo(x + 20, 190, x - 5, 60); g.stroke(); }
    if (p.lice) { for (let i = 0; i < 16; i++) { const x = 825 + rnd() * 230, y = 90 + rnd() * 200; ell(g, x, y, 5, 3, '#ece6d6', 'rgba(0,0,0,.3)', 1); } }
    if (p.scratch) { g.strokeStyle = 'rgba(170,40,40,.7)'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { const x = 850 + rnd() * 150, y = 120 + rnd() * 150; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30, y + 22); g.stroke(); } }
    g.restore();
    inset(g, 930, 450, 80, '위에서 본 머리 모양');
    g.fillStyle = '#2b221d'; g.beginPath(); if (p.flat) { g.moveTo(870, 420); g.quadraticCurveTo(930, 340, 990, 420); g.lineTo(985, 490); g.lineTo(875, 490); g.closePath(); } else g.ellipse(930, 452, 52 * big, 64 * big, 0, 0, 7); g.fill();
    note(g, '앞', 930, 380);
  }
  S.head = { pts() { return []; }, draw(g) { headBase(this, g); }, hint: '머리·얼굴·두피를 살펴보세요' };
  S.headp = {
    pts() { return [{ k: 'R', x: 280, y: 230, n: '오른쪽 옆머리 누르기' }, { k: 'L', x: 580, y: 230, n: '왼쪽 옆머리 누르기' }, { k: 'top', x: 430, y: 110, n: '정수리 누르기' }]; },
    draw(g) { headBase(this, g); const p = this.p; for (const [k, d] of SIDES) if (p.swell === k) ell(g, 430 + d * 140, 215, 38, 30, 'rgba(255,255,255,.12)', 'rgba(0,0,0,.25)'); },
    exam(q) { const p = this.p, hit = p.tender === q.k; return { say: hit ? '아야! 거기 누르면 아파요.' : '', felt: [p.swell === q.k ? '말랑하게 부어 있음' : '', p.warm ? '두피가 따뜻하게 느껴짐' : '', hit ? '누르면 아파함' : ''].filter(Boolean).join(', ') || '누를 때 아파하지 않고 종물·함몰이 없음.' }; },
  };

  // ================================================================ 귀·이경·코
  function auricle(e, g, x, y, s, d, o) {
    const sk = mix(e.skin(), '#c0504a', clamp((o.red || 0) * 0.6, 0, 0.6)), sc = 1 + (o.swell || 0) * 0.15;
    g.save(); g.translate(x, y); g.scale(d * sc, sc);
    if (o.bruise) ell(g, 95, 60, 60, 80, 'rgba(90,50,110,.5)');
    if (o.parotid) ell(g, -70, 120, 90, 80, mix(e.skin(), '#c98a7a', 0.2), LINE);
    g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-30, -150); g.bezierCurveTo(60, -190, 110, -90, 80, 0); g.bezierCurveTo(60, 60, 40, 90, 30, 140); g.bezierCurveTo(20, 190, -40, 190, -40, 140); g.bezierCurveTo(-40, 100, -60, 60, -55, 0); g.bezierCurveTo(-60, -80, -70, -130, -30, -150); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(90,50,30,.4)'; g.lineWidth = 6; g.beginPath(); g.moveTo(-20, -120); g.bezierCurveTo(40, -150, 75, -80, 55, -10); g.stroke();
    ell(g, 0, 20, 34, 46, mix(sk, '#7a4a3a', 0.25)); ell(g, -16, 26, 13, 15, '#2a1612');
    ell(g, -50, 20, 14, 20, sk, LINE);
    if (o.disch) { g.fillStyle = 'rgba(220,200,90,.85)'; g.beginPath(); g.moveTo(-20, 30); g.quadraticCurveTo(-10, 80, -18, 120); g.quadraticCurveTo(-28, 80, -22, 30); g.fill(); }
    g.restore();
  }
  S.ear = {
    pts() { return [{ k: 'R', x: 330, y: 300, n: '오른쪽 이주(귀 앞 돌기) 누르기' }, { k: 'L', x: 870, y: 300, n: '왼쪽 이주 누르기' }, { k: 'Rm', x: 470, y: 340, n: '오른쪽 귀 뒤(꼭지돌기) 누르기' }, { k: 'Lm', x: 730, y: 340, n: '왼쪽 귀 뒤 누르기' }]; },
    draw(g) { floor(g, 520); auricle(this, g, 400, 280, 1, -1, this.p.R || {}); auricle(this, g, 800, 280, 1, 1, this.p.L || {}); note(g, '오른쪽 귀', 400, 500); note(g, '왼쪽 귀', 800, 500); },
    exam(q) {
      const s = this.p[q.k[0]] || {}, back = q.k.length > 1;
      if (!back && s.tragus) return { say: '아악! 귀 앞을 누르니까 너무 아파요.', felt: '이주를 누르자 심하게 아파함.' };
      if (s.parotid && !back) return { say: '거기 부어서 아파요.', felt: '귀 앞·아래가 부어 단단하고 누르면 아파함.' };
      return { felt: back && s.bruise ? '귀 뒤에 멍이 있고 누르면 아파함.' : '누를 때 아파하지 않음.', say: back && s.bruise ? '아, 거기 아파요.' : '' };
    },
  };
  function tm(g, x, y, r, d, o) {
    ell(g, x, y, r + 16, r + 16, '#0b0f10'); const sw = o.canal === 'swollen';
    ell(g, x, y, r, r, sw ? '#c4605a' : '#d9a090');
    const tr = sw ? r * 0.45 : r * 0.75, st = o.tm || 'normal';
    const col = { normal: '#b8b2aa', red_bulge: '#c8504a', effusion: '#c9a25a' }[st] || '#b8b2aa';
    const gr = g.createRadialGradient(x - tr * 0.3, y - tr * 0.3, 2, x, y, tr); gr.addColorStop(0, st === 'red_bulge' ? '#e88a80' : '#e4e0da'); gr.addColorStop(1, col);
    ell(g, x, y, tr, tr * 0.92, gr, 'rgba(0,0,0,.25)');
    if (st !== 'red_bulge') { g.strokeStyle = 'rgba(240,235,225,.9)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - d * tr * 0.1, y - tr * 0.55); g.lineTo(x, y); g.stroke(); }
    if (st === 'normal' && !sw) { g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.moveTo(x + d * 6, y + 6); g.lineTo(x + d * tr * 0.75, y + tr * 0.5); g.lineTo(x + d * tr * 0.45, y + tr * 0.72); g.closePath(); g.fill(); }
    if (st === 'effusion') { g.strokeStyle = 'rgba(120,80,30,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - tr * 0.8, y + tr * 0.1); g.quadraticCurveTo(x, y + tr * 0.18, x + tr * 0.8, y + tr * 0.1); g.stroke(); for (const [bx, by] of [[-0.3, 0.35], [0.1, 0.45], [0.35, 0.3]]) ell(g, x + bx * tr, y + by * tr, 9, 9, null, 'rgba(255,255,255,.6)', 1.5); }
    if (st === 'red_bulge') { ell(g, x - tr * 0.25, y - tr * 0.3, tr * 0.25, tr * 0.15, 'rgba(255,255,255,.35)'); }
  }
  S.oto = { pts() { return []; }, draw(g) { floor(g, 520); tm(g, 380, 280, 170, -1, this.p.R || {}); tm(g, 820, 280, 170, 1, this.p.L || {}); note(g, '오른쪽 고막', 380, 490); note(g, '왼쪽 고막', 820, 490); }, hint: '이경으로 본 양쪽 고막' };
  function nostril(g, x, y, r, d, o, perf) {
    ell(g, x, y, r + 14, r + 14, '#0b0f10'); ell(g, x, y, r, r, '#3a1a18');
    const muc = { red: '#d0504a', bleed: '#c9605a', crust: '#d08a80', polyp: '#d08a80' }[o.muc] || '#d89a92';
    g.fillStyle = mix(muc, '#ffffff', 0.08); g.beginPath(); g.moveTo(x - d * r * 0.3, y - r); g.lineTo(x - d * r, y - r * 0.2); g.lineTo(x - d * r, y + r * 0.6); g.lineTo(x - d * r * 0.3, y + r); g.closePath(); g.fill();
    const tb = o.muc === 'red' ? 1.3 : 1; ell(g, x + d * r * 0.55, y + r * 0.2, r * 0.42 * tb, r * 0.6 * tb, muc, 'rgba(0,0,0,.2)');
    if (o.muc === 'polyp') for (const [px, py] of [[0.05, -0.1], [0.2, 0.25]]) { const gr = g.createRadialGradient(x + px * r - 8, y + py * r - 8, 2, x + px * r, y + py * r, r * 0.25); gr.addColorStop(0, '#f0ece4'); gr.addColorStop(1, '#a8a49a'); ell(g, x + px * r, y + py * r, r * 0.22, r * 0.26, gr, 'rgba(0,0,0,.2)'); }
    if (o.muc === 'crust') ell(g, x - d * r * 0.65, y - r * 0.1, r * 0.18, r * 0.12, '#a87a3a', 'rgba(0,0,0,.3)');
    if (o.muc === 'bleed') ell(g, x - d * r * 0.7, y + r * 0.1, r * 0.12, r * 0.12, '#a01818');
    if (perf) ell(g, x - d * r * 0.7, y - r * 0.15, r * 0.1, r * 0.13, '#1a0a08');
    if (o.disch === 'clear') { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - r * 0.2, y + r * 0.3); g.quadraticCurveTo(x, y + r * 0.6, x + r * 0.15, y + r * 0.9); g.stroke(); }
    if (o.disch === 'blood') ell(g, x, y + r * 0.75, r * 0.45, r * 0.18, '#8a1010');
  }
  S.nose = { pts() { return []; }, draw(g) { floor(g, 520); nostril(g, 380, 280, 160, -1, this.p.R || {}, this.p.perf); nostril(g, 820, 280, 160, 1, this.p.L || {}, this.p.perf); note(g, '오른쪽 콧속(비경)', 380, 490); note(g, '왼쪽 콧속', 820, 490); note(g, '안쪽 벽 = 비중격, 바깥 볼록한 것 = 하비갑개', 600, 540); }, hint: '비경으로 본 양쪽 콧속' };
})();

/* ---- 2부: 입·인후·림프절·갑상선·흉부·유방·맥박·부종 */
(function () {
  'use strict';
  const BE = window.BodyEngine, S = BE.SCENES, W = 1200, H = 600, CX = 600, mix = BE.mix;
  const { ell, txt, limb, rrect, face, note, dots, finger, floor } = BE.draw;
  const LINE = 'rgba(0,0,0,.35)', SIDES = [['R', -1], ['L', 1]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);

  // ================================================================ 구강
  S.mouth = {
    pts() { return []; }, hint: '입을 크게 벌리게 하고 혀·점막·잇몸을 살펴보세요',
    draw(g) {
      const p = this.p, sk = this.skin(), rnd = BE.mulberry(21);
      floor(g, 540); ell(g, 600, 300, 330, 250, sk, LINE);
      const lip = p.lips ? '#c0302a' : mix(sk, '#b24a4a', 0.5);
      ell(g, 600, 300, 290, 200, lip);
      if (p.lips || p.dry) { g.strokeStyle = 'rgba(80,20,20,.6)'; g.lineWidth = 1.5; for (let i = 0; i < 14; i++) { const a = rnd() * 6.28; g.beginPath(); g.moveTo(600 + Math.cos(a) * 285, 300 + Math.sin(a) * 196); g.lineTo(600 + Math.cos(a) * 265, 300 + Math.sin(a) * 178); g.stroke(); } }
      const muc = mix(p.erosion ? '#d05a5a' : '#d9737a', '#efd8d4', clamp(p.pale || 0, 0, 1) * 0.8);
      ell(g, 600, 300, 262, 172, muc);
      ell(g, 600, 205, 170, 70, mix(muc, '#ffffff', 0.12));
      if (p.petech) dots(g, rnd, 22, 600, 200, 140, 50, 3, '#a01818');
      ell(g, 600, 345, 120, 70, '#5a1c1e');
      for (let i = -5; i <= 5; i++) { const x = 600 + i * 34, y = 140 + Math.abs(i) * Math.abs(i) * 2.2; rrect(g, x - 15, y - 10, 30, 30, 6, '#f2ede2', 'rgba(0,0,0,.15)'); }
      if (p.gum) { g.strokeStyle = '#b02020'; g.lineWidth = 6; g.beginPath(); for (let i = -5; i <= 5; i++) { const x = 600 + i * 34, y = 132 + Math.abs(i) * Math.abs(i) * 2.2; i === -5 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
      if (p.pigment) { for (const [x, y] of [[400, 300], [800, 290], [560, 128]]) ell(g, x, y, 30, 16, 'rgba(90,60,50,.55)'); }
      const big = p.bigtongue ? 1 + 0.25 * p.bigtongue : 1, tc = p.glossitis ? mix('#d06a6a', '#e03a3a', p.glossitis) : p.straw ? '#d8343a' : mix('#d98585', '#efd2cc', clamp(p.pale || 0, 0, 1) * 0.6);
      g.save(); g.beginPath(); g.ellipse(600, 400, 150 * big, 95 * big, 0, Math.PI, 2 * Math.PI); g.lineTo(600 + 150 * big, 460); g.lineTo(600 - 150 * big, 460); g.closePath(); g.fillStyle = tc; g.fill(); g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 2; g.stroke(); g.clip();
      if (!p.glossitis) dots(g, rnd, p.straw ? 60 : 140, 600, 400, 140 * big, 80 * big, p.straw ? 4 : 1.6, p.straw ? '#a8101a' : 'rgba(255,255,255,.35)');
      if (p.tongue_fasc) { g.strokeStyle = 'rgba(120,40,40,.45)'; g.lineWidth = 2; for (let i = 0; i < 12; i++) { const x = 480 + rnd() * 240, y = 330 + rnd() * 100, ph = Math.sin(this.t * 9 + i * 1.7); if (ph > 0.3) { g.beginPath(); g.arc(x, y, 6 + ph * 4, 0, 3.1); g.stroke(); } } }
      if (!p.dry) { g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(560, 340, 40, 12, -0.2, 0, 7); g.fill(); }
      g.restore();
      g.strokeStyle = 'rgba(90,20,30,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(600, 320 - 10 * big); g.lineTo(600, 420); g.stroke();
      if (p.bigtongue) { g.strokeStyle = 'rgba(90,20,30,.4)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(600 - 140 * big + 6, 365 + i * 10, 6, -1.2, 1.2); g.stroke(); g.beginPath(); g.arc(600 + 140 * big - 6, 365 + i * 10, 6, 1.9, 4.4); g.stroke(); } }
      if (p.ulcer) for (const [x, y] of [[430, 360], [770, 330], [520, 465]]) { ell(g, x, y, 20, 15, '#b8303a'); ell(g, x, y, 13, 9, '#efe3b8'); }
      if (p.erosion) for (const [x, y] of [[420, 270], [790, 260]]) ell(g, x, y, 34, 22, 'rgba(200,30,40,.5)');
      if (p.koplik) for (const cx of [395, 805]) dots(g, rnd, 14, cx, 300, 22, 18, 2.6, '#f4f4ee');
      if (p.stensen) for (const cx of [395, 805]) { ell(g, cx, 230, 10, 8, '#c02a30'); ell(g, cx, 230, 3, 3, '#f0d0c0'); }
      if (p.blood) ell(g, 680, 470, 50, 16, 'rgba(140,10,10,.8)');
      if (p.saliva) ell(g, 600, 480, 160, 20, 'rgba(220,235,245,.5)');
      if (!p.dry) { g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.ellipse(430, 250, 30, 10, -0.5, 0, 7); g.fill(); }
      note(g, '입안(앞에서)', 600, 575);
    },
  };

  // ================================================================ 인후
  S.throat = {
    pts() { return []; }, hint: '설압자로 혀를 누르고 "아—" 하게 합니다',
    draw(g) {
      const p = this.p, sk = this.skin(), rnd = BE.mulberry(31);
      floor(g, 540);
      if (p.noexam) { face(this, g, 600, 280, 190, { drool: 1, open: 0.12, gy: 0.2 }); note(g, '앞으로 몸을 숙이고 앉아 있음 · 입을 벌려 보라고만 하고 설압자는 대지 않음', 600, 560); return; }
      const open = p.trismus ? 0.35 : 1;
      ell(g, 600, 300, 330, 250 * Math.max(open, 0.55), sk, LINE);
      ell(g, 600, 300, 290, 205 * open, mix(sk, '#b24a4a', 0.5));
      g.save(); g.beginPath(); g.ellipse(600, 300, 262, 178 * open, 0, 0, 7); g.clip();
      const red = clamp(p.red || 0, 0, 1), wall = mix('#d88a86', '#d0302a', red);
      g.fillStyle = mix('#c86a6a', '#c02a26', red * 0.8); g.fillRect(300, 100, 600, 420);
      g.fillStyle = '#3a1012'; g.beginPath(); g.moveTo(420, 420); g.quadraticCurveTo(420, 230, 600, 225); g.quadraticCurveTo(780, 230, 780, 420); g.closePath(); g.fill();
      ell(g, 600, 340, 120, 90, wall);
      if (p.blood) { g.strokeStyle = 'rgba(120,10,10,.8)'; g.lineWidth = 8; g.beginPath(); g.moveTo(560, 270); g.quadraticCurveTo(570, 340, 550, 420); g.stroke(); }
      g.fillStyle = mix('#e0989a', '#d8403a', red * 0.6); g.beginPath(); g.moveTo(300, 100); g.lineTo(900, 100); g.lineTo(900, 200); g.quadraticCurveTo(780, 200, 700, 250); g.quadraticCurveTo(600, 215, 500, 250); g.quadraticCurveTo(420, 200, 300, 200); g.closePath(); g.fill();
      if (p.palate_pet) dots(g, rnd, 26, 600, 175, 200, 30, 3, '#9a1010');
      const bulge = p.bulge === 'L' ? 1 : p.bulge === 'R' ? -1 : 0;
      if (bulge) ell(g, 600 + bulge * 120, 215, 110, 60, mix('#e0989a', '#d8403a', 0.7));
      const ux = 600 + (p.uvula === 'R' ? -40 : p.uvula === 'L' ? 40 : 0) - (p.uvula ? 0 : bulge * 35);
      g.fillStyle = mix('#e0989a', '#d8403a', red * 0.6); g.beginPath(); g.moveTo(ux - 22, 210); g.quadraticCurveTo(ux - 22, 285, ux, 290); g.quadraticCurveTo(ux + 22, 285, ux + 22, 210); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 2; g.stroke();
      const tons = clamp(p.tons || 1, 1, 4);
      for (const [, d] of SIDES) {
        const w = [0, 30, 60, 95, 125][tons], x = 600 + d * (190 - w * 0.55);
        g.strokeStyle = 'rgba(120,30,30,.5)'; g.lineWidth = 8; g.beginPath(); g.moveTo(600 + d * 230, 210); g.quadraticCurveTo(600 + d * 210, 330, 600 + d * 230, 430); g.stroke();
        if (tons > 1) {
          ell(g, x, 330, w * 0.75, 70, mix('#d27a76', '#c8302a', red), 'rgba(0,0,0,.2)');
          g.fillStyle = 'rgba(80,10,10,.35)'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + (rnd() - 0.5) * w * 0.8, 300 + rnd() * 60, 3, 0, 7); g.fill(); }
          if (p.exud) for (let i = 0; i < 4; i++) ell(g, x + (rnd() - 0.5) * w * 0.8, 300 + rnd() * 60, 12 + rnd() * 8, 8, '#efe6c6');
        }
      }
      rrect(g, 470, 430, 260, 40, 10, '#d8cba8');
      g.restore();
      if (p.drool) { g.fillStyle = 'rgba(220,235,245,.6)'; g.beginPath(); g.ellipse(700, 520, 22, 40, 0, 0, 7); g.fill(); }
      note(g, '입안 뒤쪽(인두) · 아래 = 설압자', 600, 575);
    },
  };

  // ================================================================ 림프절·갑상선 — 목·윗몸 그림
  const NODE = { occ: [520, 150, '뒤통수·귀 뒤'], cerv_R: [552, 215, '오른쪽 앞목'], cerv_L: [648, 215, '왼쪽 앞목'], post_R: [528, 245, '오른쪽 뒷목'], post_L: [672, 245, '왼쪽 뒷목'], supra_R: [505, 292, '오른쪽 쇄골 위'], supra_L: [695, 292, '왼쪽 쇄골 위'], ax_R: [395, 370, '오른쪽 겨드랑이'], ax_L: [805, 370, '왼쪽 겨드랑이'], ing_R: [530, 520, '오른쪽 서혜부'], ing_L: [670, 520, '왼쪽 서혜부'] };
  function upper(e, g, o = {}) {
    const sk = e.skin();
    floor(g, 590); g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2;
    g.beginPath(); g.moveTo(370, 600); g.lineTo(360, 330); g.quadraticCurveTo(370, 280, 470, 272); g.lineTo(730, 272); g.quadraticCurveTo(830, 280, 840, 330); g.lineTo(830, 600); g.closePath(); g.fill(); g.stroke();
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(600 + d * 240, 320); g.quadraticCurveTo(600 + d * 300, 420, 600 + d * 305, 600); g.lineTo(600 + d * 245, 600); g.lineTo(600 + d * 225, 390); g.closePath(); g.fill(); g.stroke(); }
    g.fillRect(548, 170, 104, 105); g.beginPath(); g.moveTo(548, 175); g.lineTo(548, 274); g.moveTo(652, 175); g.lineTo(652, 274); g.stroke();
    g.strokeStyle = 'rgba(90,50,30,.25)'; for (const d of [-1, 1]) { g.beginPath(); g.moveTo(600 + d * 48, 190); g.lineTo(600 + d * 12, 274); g.stroke(); g.beginPath(); g.moveTo(600 + d * 20, 286); g.quadraticCurveTo(600 + d * 90, 276, 600 + d * 150, 292); g.stroke(); }
    face(e, g, 600, 100, 92, o.face || {});
    g.fillStyle = '#5f7f9a'; g.fillRect(360, 500, 480, 100);
    g.fillStyle = sk; g.strokeStyle = LINE; for (const d of [-1, 1]) { g.beginPath(); g.moveTo(600 + d * 4, 600); g.lineTo(600 + d * 4, 540); g.lineTo(600 + d * 110, 500); g.lineTo(600 + d * 160, 600); g.closePath(); g.fill(); }
    g.fillStyle = '#5f7f9a'; g.beginPath(); g.moveTo(360, 500); g.lineTo(840, 500); g.lineTo(840, 520); g.lineTo(600, 545); g.lineTo(360, 520); g.closePath(); g.fill();
  }
  S.lymph = {
    pts() { return Object.entries(NODE).map(([k, v]) => ({ k, x: v[0], y: v[1], n: v[2] + ' 림프절 만지기' })); },
    draw(g) { upper(this, g); for (const n of this.p.nodes || []) { const v = NODE[n.site]; if (v && n.cm >= 1.5) ell(g, v[0], v[1], 7 * n.cm, 6 * n.cm, 'rgba(255,255,255,.12)', 'rgba(0,0,0,.25)'); } },
    exam(q) {
      const n = (this.p.nodes || []).find(x => x.site === q.k);
      if (!n) return { felt: '만져지는 림프절이 없음(또는 콩알보다 작고 말랑함).' };
      const feel = n.hard ? '돌처럼 단단하고' : n.rubbery ? '고무처럼 탄력 있고' : '말랑하고';
      return { felt: `약 ${n.cm} cm 크기, ${feel} ${n.fixed ? '주변 조직에 붙어 잘 움직이지 않음' : '손가락 아래에서 잘 움직임'}${n.tender ? ', 누르면 아파함' : ', 누를 때 아프지 않음'}.`, say: n.tender ? '아, 거기 누르니까 아파요.' : '' };
    },
  };
  S.thyroid = {
    pts() { return [{ k: 'R', x: 568, y: 245, n: '갑상선 오른쪽 엽 (침을 삼키게 하며)' }, { k: 'I', x: 600, y: 258, n: '갑상선 협부' }, { k: 'L', x: 632, y: 245, n: '갑상선 왼쪽 엽' }]; },
    hint: '동그라미를 누르면 침을 삼키게 하며 만집니다',
    draw(g) {
      const k = this.since(), up = k < 2 ? Math.sin(Math.PI * k / 2) * 14 : 0, sz = this.p.size || 0;
      upper(this, g);
      g.save(); g.translate(0, -up);
      if (this.av[0] === 'm' || this.av === 't_m') ell(g, 600, 212, 12, 9, 'rgba(255,255,255,.12)', 'rgba(0,0,0,.2)');
      if (sz >= 0.3) for (const d of [-1, 1]) ell(g, 600 + d * (20 + sz * 14), 248, 15 + sz * 20, 20 + sz * 20, 'rgba(255,255,255,.1)', 'rgba(0,0,0,.22)');
      g.restore();
      if (k < 2) note(g, '꿀꺽 — 침 삼키기', 600, 330);
    },
    exam() {
      const p = this.p, sz = p.size || 0;
      if (!sz && !p.nodule) return { felt: '작고 부드러우며 삼킬 때 부드럽게 올라감. 결절·압통 없음.', say: '(꿀꺽)' };
      const s = sz >= 0.7 ? '눈에 띄게 커져 있고' : sz >= 0.5 ? '양쪽 엽이 커져 만져지고' : '약간 커진 느낌이고';
      return { felt: `${s} ${p.nodule === 'multi' ? '울퉁불퉁한 결절이 여러 개 만져짐' : '표면은 고름'}${p.firm ? ', 단단함' : ', 부드러움'}. 삼킬 때 함께 올라감.`, say: '(꿀꺽)' };
    },
  };

  // ================================================================ 흉부 시진·촉진 — 숨쉬기 애니메이션
  function breath(e) {
    const p = e.p, rr = p.rr || 14, ph = (e.t * rr / 60) % 1, a = ph < 0.4 ? ease(ph / 0.4) : 1 - ease((ph - 0.4) / 0.6);
    const A = p.pattern === 'kussmaul' ? 1.9 : p.pattern === 'shallow' ? 0.45 : p.exp || 1;
    return { a, ph, R: a * A * (p.lag === 'R' ? 0.35 : 1), L: a * A * (p.lag === 'L' ? 0.35 : 1) };
  }
  function chestBody(e, g, b) {
    floor(g, 470);
    for (const [k, d] of SIDES) {
      g.save(); g.beginPath(); d < 0 ? g.rect(0, 0, CX, H) : g.rect(CX, 0, W - CX, H); g.clip();
      g.translate(CX, 470); g.scale(1 + b[k] * 0.035, 1 + b[k] * 0.012); g.translate(-CX, -470); e.body(g); g.restore();
    }
    const p = e.p;
    if (p.access) { g.strokeStyle = `rgba(90,50,30,${0.15 + 0.55 * b.a})`; g.lineWidth = 3; for (const d of [-1, 1]) { g.beginPath(); g.moveTo(CX + d * 22, 132); g.lineTo(CX + d * 6, 172); g.stroke(); } }
    if (p.retract && b.a > 0.2) {
      g.strokeStyle = `rgba(70,30,20,${0.5 * b.a})`; g.lineWidth = 2.5;
      for (const d of [-1, 1]) { for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(CX + d * 30, 225 + i * 28); g.quadraticCurveTo(CX + d * 75, 235 + i * 28, CX + d * 115, 228 + i * 28); g.stroke(); } g.beginPath(); g.moveTo(CX + d * 15, 352); g.quadraticCurveTo(CX + d * 70, 395, CX + d * 118, 372); g.stroke(); }
      ell(g, CX, 176, 14, 7 * b.a, `rgba(70,30,20,${0.45 * b.a})`);
    }
    const tx = CX + (p.trachea === 'L' ? 9 : p.trachea === 'R' ? -9 : 0);
    g.strokeStyle = 'rgba(90,50,30,.3)'; g.lineWidth = 2; g.beginPath(); g.moveTo(tx - 9, 140); g.lineTo(tx - 9, 172); g.moveTo(tx + 9, 140); g.lineTo(tx + 9, 172); g.stroke();
    face(e, g, CX, 80, 60, { cyan: p.cyan, pursed: p.pursed && b.ph > 0.4, flare: p.nasal ? b.a * 1.2 : 0, open: p.pattern === 'kussmaul' ? b.a * 0.3 : 0 });
  }
  function stopwatch(g, t) { const s = Math.floor(t % 60); ell(g, 1110, 70, 34, 34, '#1a2529', 'rgba(150,200,190,.5)'); g.strokeStyle = '#e8d7a6'; g.lineWidth = 3; g.beginPath(); g.moveTo(1110, 70); g.lineTo(1110 + Math.sin(s / 60 * 6.283) * 26, 70 - Math.cos(s / 60 * 6.283) * 26); g.stroke(); txt(g, s + '초', 1110, 125, { al: 'center', size: 14, c: '#93a8a3' }); }
  BE.draw.stopwatch = stopwatch;
  S.chest = {
    pts() { return []; }, hint: '숨 쉬는 모양과 횟수를 보세요(초시계로 30초 세기)',
    draw(g) {
      const p = this.p, b = breath(this); chestBody(this, g, b);
      stopwatch(g, this.t);
      ell(g, 1050, 320, 70, 70, '#1a2529', 'rgba(150,200,190,.35)'); note(g, '옆에서 본 가슴(앞뒤 두께)', 1050, 412);
      const ap = (p.barrel ? 46 : 30) * (1 + 0.04 * b.a);
      ell(g, 1050, 320, ap, 52, this.skin(), LINE);
      if (p.orthopnea) note(g, '침대를 세워 앉아 있음', 1050, 440);
    },
  };
  S.cpalp = {
    pts() { return Object.entries(BE.LUNG).map(([k, v]) => ({ k, x: v[0], y: v[1], n: { RU: '오른쪽 위', LU: '왼쪽 위', RM: '오른쪽 가운데', LM: '왼쪽 가운데', RL: '오른쪽 아래', LL: '왼쪽 아래' }[k] + ' — 촉각 진탕음("일, 이, 삼" 하게 하며)' })); },
    hint: '아래 가슴에 댄 양손 엄지가 숨쉴 때 벌어집니다 · 동그라미 = 촉각 진탕음',
    draw(g) {
      const b = breath(this); chestBody(this, g, b);
      for (const [k, d] of SIDES) { const x = CX + d * (8 + b[k] * 14); g.save(); g.translate(x, 395); g.scale(d, 1); rrect(g, 0, -30, 110, 60, 26, '#a9cbe6', 'rgba(0,0,0,.3)'); rrect(g, -6, -10, 46, 18, 9, '#b8d6ee', 'rgba(0,0,0,.3)'); g.restore(); }
      g.strokeStyle = 'rgba(232,215,166,.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(CX, 360); g.lineTo(CX, 430); g.stroke(); g.setLineDash([]);
    },
    exam(q) { const z = (this.p.zones || {})[q.k]; return { say: '일, 이, 삼…', felt: z === 'up' ? '손바닥에 울리는 진동이 반대쪽보다 크게 느껴짐.' : z === 'down' ? '손바닥에 울리는 진동이 약하게 느껴짐.' : '진동이 반대쪽과 같게 느껴짐.' }; },
  };

  // ================================================================ 유방(도식)
  function breastDiagram(e, g) {
    const p = e.p, sk = e.skin(); floor(g, 540);
    for (const [k, d] of SIDES) {
      const x = CX + d * 190, y = 290, s = p[k] || {}, male = p.gyneco || e.av[0] === 'm';
      ell(g, x, y, 140, 140, mix(sk, '#c0504a', s.skin === 'red' ? 0.35 : 0), LINE);
      g.strokeStyle = 'rgba(150,200,190,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 140, y); g.lineTo(x + 140, y); g.moveTo(x, y - 140); g.lineTo(x, y + 140); g.stroke();
      if (s.skin === 'peau') { const rnd = BE.mulberry(41); g.save(); g.beginPath(); g.arc(x, y, 138, 0, 7); g.clip(); dots(g, rnd, 160, x + d * 40, y + 30, 90, 80, 2, 'rgba(90,50,30,.4)'); g.restore(); }
      if (p.gyneco) ell(g, x, y, 50, 46, 'rgba(255,255,255,.1)', 'rgba(0,0,0,.18)');
      ell(g, x, y, male ? 18 : 26, male ? 18 : 26, mix(sk, '#7a4a3a', 0.5));
      if (s.nipple === 'retract') { g.strokeStyle = '#3a1a12'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.stroke(); } else ell(g, x, y, 7, 7, mix(sk, '#5a3020', 0.6));
      note(g, k === 'R' ? '오른쪽' : '왼쪽', x, 460); note(g, '12시', x, y - 150); note(g, d < 0 ? '9시(바깥)' : '3시(바깥)', x + d * 175, y + 4);
    }
    note(g, '도식(실제 사진 아님) · 시계 방향 = 검사자가 보는 방향', CX, 520);
  }
  const Q = [['uo', '위 바깥'], ['ui', '위 안쪽'], ['lo', '아래 바깥'], ['li', '아래 안쪽'], ['c', '젖꼭지 아래']];
  S.breast = { pts() { return []; }, draw(g) { breastDiagram(this, g); }, hint: '팔을 내리고 → 머리 위로 → 허리에 손을 짚게 하며 좌우를 비교합니다' };
  S.breastp = {
    pts() {
      const out = [];
      for (const [k, d] of SIDES) {
        const x = CX + d * 190;
        for (const [q, n] of Q) { const ox = q === 'c' ? 0 : (q[1] === 'o' ? d : -d) * 70, oy = q === 'c' ? 0 : (q[0] === 'u' ? -70 : 70); out.push({ k: k + '.' + q, x: x + ox, y: 290 + oy, n: `${k === 'R' ? '오른쪽' : '왼쪽'} 유방 ${n}` }); }
        out.push({ k: k + '.ax', x: CX + d * 380, y: 200, n: `${k === 'R' ? '오른쪽' : '왼쪽'} 겨드랑이` });
      }
      return out;
    },
    draw(g) { breastDiagram(this, g); },
    exam(q) {
      const [k, part] = q.k.split('.'), s = this.p[k] || {}, d = k === 'R' ? -1 : 1;
      if (part === 'ax') return { felt: k === 'R' && this.p.axR ? '단단한 림프절(약 1.5 cm)이 만져짐.' : '만져지는 림프절 없음.' };
      let hit = '';
      if (s.mass) {
        const a = s.mass.clock / 12 * 6.283, mx = Math.sin(a), my = -Math.cos(a), qq = (my < 0 ? 'u' : 'l') + (mx * d > 0 ? 'o' : 'i');
        if (qq === part) hit = `약 ${s.mass.cm} cm 덩어리가 만져짐 — ${{ hard: '돌처럼 단단하고 경계가 불분명하며 잘 움직이지 않음', cystic: '말랑하고 경계가 뚜렷하며 잘 움직임', rubbery: '고무처럼 탄력 있고 경계가 뚜렷하며 잘 움직임' }[s.mass.kind] || '단단함'}.`;
      }
      if (this.p.gyneco && part === 'c') hit = '젖꼭지 아래에 단추 같은 말랑한 조직이 만져짐.';
      return { felt: (hit || '덩어리가 만져지지 않음.') + (s.warm ? ' 피부가 따뜻함.' : ''), say: s.tender ? '아, 거기 아파요.' : '' };
    },
  };

  // ================================================================ 맥박 — 누른 곳이 맥박에 맞춰 뛰고, 둥 소리
  function beats(p) {
    if (p._beats) return p._beats;
    const rnd = BE.mulberry(9), hr = p.hr || 72, arr = []; let t = 0;
    while (t < 60) { arr.push(t); t += 60 / hr * (p.irr ? 0.6 + rnd() * 0.8 : 1); }
    Object.defineProperty(p, '_beats', { value: arr, enumerable: false, configurable: true });
    return arr;
  }
  function sinceBeat(e) { const arr = beats(e.p), tt = e.t % 60; let last = arr[0]; for (const b of arr) { if (b > tt) break; last = b; } return tt - last; }
  const PULSE = { 'R.rad': [440, 215, '오른쪽 요골동맥(손목)'], 'L.rad': [760, 215, '왼쪽 요골동맥(손목)'], 'R.dp': [430, 455, '오른쪽 족배동맥(발등)'], 'L.dp': [770, 455, '왼쪽 족배동맥(발등)'] };
  BE.prototype.strength = function (k) { const [side, w] = k.split('.'), p = this.p; return ((p[side] || {})[w] == null ? 1 : p[side][w]) * (p.amp || 1); };
  S.pulse = {
    pts() { return Object.entries(PULSE).map(([k, v]) => ({ k, x: v[0], y: v[1], n: v[2] + ' — 맥박 세기' })); },
    hint: '손목·발등 동그라미를 누르고 초시계로 맥박을 세어 보세요',
    draw(g) {
      const sk = this.skin(); floor(g, 560);
      for (const d of [-1, 1]) {
        limb(g, [[CX + d * 560, 200], [CX + d * 130, 200]], 70, sk); ell(g, CX + d * 95, 200, 48, 40, sk, LINE);
        g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2; g.beginPath(); g.moveTo(CX + d * 130, 330); g.quadraticCurveTo(CX + d * 230, 330, CX + d * 230, 420); g.lineTo(CX + d * 215, 540); g.quadraticCurveTo(CX + d * 170, 560, CX + d * 125, 540); g.lineTo(CX + d * 115, 420); g.closePath(); g.fill(); g.stroke();
      }
      note(g, '손바닥을 위로 한 양 손목(엄지 쪽 = 안쪽)', CX, 290); note(g, '양 발등', CX, 590);
      stopwatch(g, this.t);
      if (this.sel && PULSE[this.sel.k]) {
        const v = PULSE[this.sel.k], s = this.strength(this.sel.k), kb = sinceBeat(this);
        if (s > 0.05) { const sz = kb < 0.25 ? Math.sin(kb / 0.25 * Math.PI) : 0, m = Math.min(s, 1.6); ell(g, v[0], v[1], 14 + sz * 16 * m, 14 + sz * 16 * m, `rgba(232,120,110,${0.2 + 0.5 * sz})`); }
        finger(g, v[0], v[1], 1);
      }
    },
    exam(q) {
      const s = this.strength(q.k), p = this.p;
      if (s <= 0.05) return { felt: '맥박이 만져지지 않음.' };
      const kind = p.kind === 'bounding' ? '세게 튀어 올랐다가 빨리 꺼짐' : p.kind === 'slow_rising' ? '천천히 약하게 올라옴' : '';
      return { felt: `맥박이 ${s < 0.55 ? '약하게' : s > 1.3 ? '세게' : '보통 세기로'} 만져짐${kind ? ' — ' + kind : ''}. 리듬과 횟수는 초시계로 직접 세어 보세요.` };
    },
    tick() {
      if (!this.sel || !PULSE[this.sel.k] || this.strength(this.sel.k) <= 0.05 || !this.raf) return;
      const kb = sinceBeat(this);
      if (kb < 0.034 && this._lastBeat !== Math.round((this.t - kb) * 100)) {
        this._lastBeat = Math.round((this.t - kb) * 100);
        try { const ac = this.ctx(), o = ac.createOscillator(), gn = ac.createGain(); o.frequency.value = 70; gn.gain.setValueAtTime(0.3, ac.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12); o.connect(gn).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.13); } catch (er) { /* 소리 못 내도 그림은 계속 */ }
      }
    },
  };

  // ================================================================ 부종 — 누르면 자국(함요)이 남았다가 회복
  const EDEMA = { 'R.shin': [430, 330, '오른쪽 정강이'], 'L.shin': [770, 330, '왼쪽 정강이'], 'R.foot': [440, 500, '오른쪽 발등'], 'L.foot': [760, 500, '왼쪽 발등'] };
  const REC = { 0: 0, 1: 4, 2: 15, 3: 40, 4: 90 };
  S.edema = {
    pts() { return Object.entries(EDEMA).map(([k, v]) => ({ k, x: v[0], y: v[1], n: v[2] + ' — 5초 눌렀다 떼기' })); },
    hint: '정강이·발등 동그라미를 눌러 자국이 남는지 보세요',
    draw(g) {
      const p = this.p, sk = this.skin(); floor(g, 560);
      for (const [k, d] of SIDES) {
        const x = CX + d * 170, gr = p[k] || 0, sw = gr * 7, calf = p.calf === k ? 18 : 0;
        g.fillStyle = p.tense === k ? mix(sk, '#d04a40', 0.4) : sk; g.strokeStyle = LINE; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 60 - sw, 40); g.quadraticCurveTo(x - 85 - sw - calf, 180, x - 40 - sw, 420); g.lineTo(x - 45 - sw, 470); g.quadraticCurveTo(x - 60 - sw, 540, x + d * 10, 545); g.quadraticCurveTo(x + 80 + sw, 540, x + 50 + sw, 470); g.lineTo(x + 40 + sw, 420); g.quadraticCurveTo(x + 85 + sw + calf, 180, x + 60 + sw, 40); g.closePath(); g.fill(); g.stroke();
        if (p.stasis) { const gg = g.createLinearGradient(0, 320, 0, 470); gg.addColorStop(0, 'rgba(120,70,40,0)'); gg.addColorStop(1, 'rgba(120,70,40,.5)'); g.fillStyle = gg; g.fillRect(x - 90 - sw, 320, 180 + sw * 2, 150); }
        if (p.tense === k) { g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(x - 20, 220, 18, 90, 0, 0, 7); g.fill(); }
        note(g, k === 'R' ? '오른쪽 다리' : '왼쪽 다리', x, 585);
      }
      if (this.act && EDEMA[this.act.k]) {
        const side = this.act.k.split('.')[0], v = EDEMA[this.act.k], kk = this.since(), gr = p.nonpit || p.tense === side ? 0 : p[side] || 0;
        if (kk < 2) finger(g, v[0], v[1], ease(kk / 0.5));
        else if (gr) { const fade = clamp(1 - (kk - 2) / REC[Math.min(4, gr)], 0, 1); if (fade > 0) ell(g, v[0], v[1], 10 + gr * 4, 7 + gr * 3, `rgba(70,30,20,${0.45 * fade})`); }
      }
      if (p.face) { ell(g, 1080, 120, 80, 80, '#1a2529', 'rgba(150,200,190,.35)'); face(this, g, 1080, 125, 55, { puffy: 1.2 }); note(g, '얼굴', 1080, 222); }
    },
    exam(q) {
      const p = this.p, side = q.k.split('.')[0], gr = p[side] || 0;
      if (p.tense === side) return { felt: '다리가 팽팽하고 단단하며 뜨거움, 누르면 아파함.', say: '아, 다리가 터질 것처럼 아파요.' };
      if (!gr) return { felt: '5초 눌렀다 떼어도 자국이 남지 않음.' };
      if (p.nonpit) return { felt: '단단하게 부어 있고 눌러도 자국이 남지 않음.' };
      return { felt: `누른 자리가 움푹 들어감(깊이 약 ${gr * 2} mm) — 자국이 ${REC[Math.min(4, gr)]}초쯤 남았다가 서서히 사라짐.` };
    },
  };
})();

/* ---- 3부: 복부·간·비장·항문·직장·부인과·관절·허리·SLR */
(function () {
  'use strict';
  const BE = window.BodyEngine, S = BE.SCENES, W = 1200, H = 600, CX = 600, mix = BE.mix;
  const { ell, txt, limb, rrect, figure, hand, lying, note, dots, finger, protractor, floor } = BE.draw;
  const LINE = 'rgba(0,0,0,.35)', SIDES = [['R', -1], ['L', 1]], ABD = BE.ABD;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);

  // ================================================================ 복부 시진
  function abdBody(e, g, p) {
    floor(g, 470);
    e.tint = p.jaundice ? ['#e8c84a', 0.35] : null;
    e.body(g);
    const sk = e.skin();
    const d = p.dist || 0, pr = p.preg || 0;
    if (d || p.flank) { ell(g, CX, 450, 135 + d * 30 + (p.flank || 0) * 20, 95 + d * 25, sk, LINE); const gr = g.createRadialGradient(CX - 30, 410, 10, CX, 450, 150); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(CX, 450, 135 + d * 30, 95 + d * 25, 0, 0, 7); g.fill(); }
    if (pr) { ell(g, CX, 440, 110 * pr + 20, 100 * pr + 10, sk, LINE); ell(g, CX - 30, 405, 40, 26, 'rgba(255,255,255,.15)'); g.strokeStyle = 'rgba(90,50,30,.25)'; g.beginPath(); g.moveTo(CX, 380); g.lineTo(CX, 520); g.stroke(); }
    if (p.scaphoid) { const gr = g.createRadialGradient(CX, 440, 10, CX, 440, 110); gr.addColorStop(0, `rgba(40,20,10,${0.3 * p.scaphoid})`); gr.addColorStop(1, 'rgba(40,20,10,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(CX, 440, 120, 80, 0, 0, 7); g.fill(); }
    if (p.mass && ABD[p.mass]) { const [x, y] = ABD[p.mass]; ell(g, x, y + (p.mass === 'Supra' ? 10 : 0), 46, 38, 'rgba(255,255,255,.14)', 'rgba(0,0,0,.2)'); }
    if (p.bladder) ell(g, CX, 500, 70, 45, 'rgba(255,255,255,.14)', 'rgba(0,0,0,.2)');
    if (p.ing) { const x = CX + (p.ing === 'R' ? -70 : 70); ell(g, x, 528, 26, 16, 'rgba(255,255,255,.18)', 'rgba(0,0,0,.25)'); }
    if (p.caput) { g.strokeStyle = 'rgba(60,80,140,.55)'; g.lineWidth = 3; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; g.beginPath(); g.moveTo(CX + Math.cos(a) * 14, 450 + Math.sin(a) * 14); g.bezierCurveTo(CX + Math.cos(a + 0.4) * 40, 450 + Math.sin(a + 0.4) * 40, CX + Math.cos(a - 0.3) * 60, 450 + Math.sin(a - 0.3) * 60, CX + Math.cos(a) * 85, 450 + Math.sin(a) * 75); g.stroke(); } }
    if (p.umb) ell(g, CX, 448, 11, 10, mix(sk, '#ffffff', 0.15), 'rgba(0,0,0,.35)');
    if (p.scar === 'pfann') { g.strokeStyle = 'rgba(160,90,80,.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(CX - 70, 515); g.quadraticCurveTo(CX, 528, CX + 70, 515); g.stroke(); }
    if (p.wound) rrect(g, CX + 40, 470, 60, 40, 5, '#efefe8', 'rgba(0,0,0,.25)');
    if (p.pulsatile) { const k = (e.t * 72 / 60) % 1, s = k < 0.2 ? Math.sin(k / 0.2 * Math.PI) : 0; ell(g, CX, 405, 30 + s * 6, 22 + s * 5, `rgba(255,255,255,${0.08 + 0.12 * s})`, 'rgba(0,0,0,.15)'); }
    if (p.peri) { const k = (e.t / 4) % 1, x = CX - 130 + k * 260; const gr = g.createRadialGradient(x, 420, 5, x, 420, 60); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, 420, 60, 40, 0, 0, 7); g.fill(); }
    e.tint = null;
  }
  S.abd = {
    pts() { return []; }, hint: '누운 환자의 배 모양·대칭·피부·움직임을 보세요(옆에서도)',
    draw(g) {
      const p = this.p; abdBody(this, g, p);
      ell(g, 1050, 330, 110, 70, '#1a2529', 'rgba(150,200,190,.35)'); note(g, '옆에서 본 배 높이', 1050, 420);
      const h = 18 + (p.dist || 0) * 28 + (p.preg || 0) * 38 - (p.scaphoid || 0) * 16;
      g.fillStyle = this.skin(); g.beginPath(); g.moveTo(960, 350); g.quadraticCurveTo(1050, 350 - h * 2, 1140, 350); g.closePath(); g.fill(); g.strokeStyle = LINE; g.stroke();
      g.strokeStyle = 'rgba(150,200,190,.4)'; g.beginPath(); g.moveTo(950, 350); g.lineTo(1150, 350); g.stroke();
    },
  };
  // ================================================================ 복부 촉진 — 누른 곳에 따라 아파하고, 덩어리가 느껴짐
  const APTS = Object.assign({}, ...Object.entries(ABD).map(([k, v]) => ({ [k]: v })), { CVA_R: [455, 400, '오른쪽 늑척추각(등 쪽, 주먹으로 두드림)'], CVA_L: [745, 400, '왼쪽 늑척추각(등 쪽)'], ing_R: [535, 535, '오른쪽 서혜부(기침하게 하며)'], ing_L: [665, 535, '왼쪽 서혜부'] });
  S.apalp = {
    pts() { return Object.entries(APTS).map(([k, v]) => ({ k, x: v[0], y: v[1], n: v[2] })); },
    draw(g) { abdBody(this, g, {}); if (this.sel && !this.sel.k.startsWith('CVA')) { const kk = this.since(); finger(g, this.sel.x, this.sel.y, ease(kk / 0.4)); } },
    exam(q) {
      const p = this.p, k = q.k;
      if (k.startsWith('CVA')) { const hit = p.cva === k.slice(4); return { say: hit ? '아야! 등이 울려요!' : '', felt: hit ? '주먹으로 두드리자 움찔하며 아파함.' : '두드려도 아파하지 않음.' }; }
      const v = (p.tender || {})[k] || 0, m = p.mass && p.mass.at === k ? p.mass.desc + '.' : '';
      let say = v >= 0.9 ? '아야! 거기 너무 아파요!' : v >= 0.5 ? '아, 거기 좀 아파요.' : v >= 0.3 ? '음… 거기 조금 불편해요.' : '';
      if (k === 'RUQ' && p.murphy) say = '아! (숨을 들이쉬다가 멈춤)';
      if (k === 'LLQ' && p.rovsing) say = '왼쪽을 누르는데 오른쪽 아래가 아파요!';
      if (v >= 0.5 && p.rebound) say += ' 손을 뗄 때 더 아파요!';
      const felt = [m, p.rigid ? '배 전체가 판자처럼 단단함.' : p.guard && v >= 0.5 ? '누를 때 배에 힘이 들어가 단단해짐.' : '',
        k === 'Supra' && p.hard_uterus ? '치골 위로 자궁이 단단하게 만져짐.' : '', k === 'Supra' && p.soft_uterus ? '치골 위로 자궁이 말랑하게 만져짐.' : '',
        k === 'RLQ' && p.psoas && v >= 0.5 ? '오른쪽 다리를 뒤로 펴게 하면 아파함.' : '', v >= 0.3 ? '' : !m ? '부드럽고 아파하지 않음.' : ''].filter(Boolean).join(' ');
      return { say, felt };
    },
  };
  // ================================================================ 간·비장 — 눌러 보면 끝이 만져지는 위치를 선으로
  function organ(e, g, side) {
    abdBody(e, g, {});
    g.strokeStyle = 'rgba(232,215,166,.5)'; g.lineWidth = 2; g.setLineDash([6, 5]);
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(CX + d * 12, 345); g.quadraticCurveTo(CX + d * 80, 380, CX + d * 125, 360); g.stroke(); }
    g.setLineDash([]); note(g, '갈비뼈 아래 끝', CX + side * 165, 352);
    const p = e.p;
    if (e.act && p.below) {
      const y = 365 + p.below * 11, x0 = side < 0 ? 470 : 620, x1 = side < 0 ? 610 : 730;
      g.strokeStyle = '#e8a87a'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y + (side < 0 ? 0 : 6)); g.quadraticCurveTo((x0 + x1) / 2, y + 20, x1, y + (side < 0 ? -30 : 0)); g.stroke();
      if (p.edge === 'hard_nodular') for (let i = 0; i < 5; i++) ell(g, x0 + (x1 - x0) * i / 4, y + 8, 5, 5, '#e8a87a');
      note(g, '손끝에 닿은 끝', (x0 + x1) / 2, y + 40);
    }
  }
  S.liver = {
    pts() { return [{ k: 'RUQ', x: 535, y: 420, n: '오른쪽 갈비뼈 아래 — 숨을 들이쉬게 하며 손끝으로' }, { k: 'span', x: 535, y: 300, n: '오른쪽 쇄골중앙선 — 위아래로 타진해 간 크기 재기' }]; },
    draw(g) { organ(this, g, -1); },
    exam(q) {
      const p = this.p;
      if (q.k === 'span') return { felt: `타진상 간 탁음 범위 약 ${p.span || 10} cm.` };
      const e = { firm: '단단하고', hard_nodular: '돌처럼 단단하고 울퉁불퉁하며', smooth: '부드럽고 매끈하며' }[p.edge] || '부드럽고';
      return { felt: p.below ? `숨을 들이쉴 때 갈비뼈 아래 약 ${p.below} cm에서 간 끝이 만져짐 — ${e} ${p.tender ? '누르면 아파함' : '아파하지 않음'}.` : '숨을 들이쉬어도 간 끝이 만져지지 않음.', say: p.tender ? '아, 거기 누르니까 아파요.' : '' };
    },
  };
  S.spleen = {
    pts() { return [{ k: 'LUQ', x: 665, y: 420, n: '왼쪽 갈비뼈 아래 — 오른쪽으로 비스듬히 눕혀 숨을 들이쉬게 하며' }]; },
    draw(g) { organ(this, g, 1); },
    exam() { const p = this.p; return { felt: p.below ? `갈비뼈 아래 약 ${p.below} cm까지 비장 끝(가장자리에 패인 홈)이 만져짐${p.tender ? ', 누르면 아파함' : ''}.` : '오른쪽으로 비스듬히 눕혀도 비장이 만져지지 않음.', say: p.tender ? '아, 왼쪽 갈비 밑이 아파요.' : '' }; },
  };

  // ================================================================ 항문·직장·부인과(도식)
  function clockFace(g, cx, cy, r, lab) {
    floor(g, 560); ell(g, cx, cy, r, r, '#c99a86', LINE);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; note(g, String(i || 12), cx + Math.sin(a) * (r + 22), cy - Math.cos(a) * (r + 22) + 5); }
    note(g, lab || '12시 = 앞(회음 쪽) · 6시 = 뒤(꼬리뼈 쪽) · 똑바로 누운 자세 기준 도식', cx, 585);
  }
  const at = (cx, cy, c, r) => { const a = c / 12 * 6.283; return [cx + Math.sin(a) * r, cy - Math.cos(a) * r]; };
  S.anal = {
    pts() { return []; }, hint: '항문 주위를 벌려 살펴봅니다(도식)',
    draw(g) {
      const cx = 600, cy = 290; clockFace(g, cx, cy, 200);
      g.strokeStyle = 'rgba(90,40,30,.4)'; g.lineWidth = 2; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26); g.lineTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70); g.stroke(); }
      ell(g, cx, cy, 22, 22, '#3a1612');
      const rnd = BE.mulberry(51);
      for (const m of this.p.marks || []) {
        const [x, y] = at(cx, cy, m.clock, m.kind === 'fistula' || m.kind === 'abscess' ? 130 : 55);
        if (m.kind === 'hemorrhoid') ell(g, x, y, 34, 28, '#7a3a6a', 'rgba(0,0,0,.3)');
        if (m.kind === 'fissure') { const [x2, y2] = at(cx, cy, m.clock, 95); g.strokeStyle = '#b01818'; g.lineWidth = 7; g.beginPath(); g.moveTo(...at(cx, cy, m.clock, 24)); g.lineTo(x2, y2); g.stroke(); }
        if (m.kind === 'fistula') { ell(g, x, y, 10, 10, '#b03030'); ell(g, x, y, 4, 4, '#3a1010'); }
        if (m.kind === 'abscess') { const gr = g.createRadialGradient(x, y, 4, x, y, 55); gr.addColorStop(0, '#e05040'); gr.addColorStop(1, 'rgba(200,60,50,0)'); ell(g, x, y, 55, 50, gr); }
        if (m.kind === 'wart') dots(g, rnd, 18, x, y, 30, 26, 7, '#c8b0a0');
        if (m.kind === 'prolapse') { for (let r = 70; r > 20; r -= 12) ell(g, cx, cy, r, r, r % 24 ? '#d04a4a' : '#b83838', 'rgba(0,0,0,.2)'); ell(g, cx, cy, 10, 10, '#3a1010'); }
      }
    },
  };
  S.dre = {
    pts() { return [{ k: 'in', x: 600, y: 290, n: '장갑 낀 검지에 윤활제를 바르고 천천히 넣기' }]; }, hint: '가운데 동그라미 = 손가락 넣기(도식)',
    draw(g) {
      const cx = 600, cy = 290, p = this.p; clockFace(g, cx, cy, 200);
      ell(g, cx, cy, 22, 22, '#3a1612');
      if (this.act) {
        if (p.prostate || this.av[0] === 'm') { const big = p.prostate === 'enlarged' ? 1.4 : p.prostate === 'boggy' ? 1.2 : 1; ell(g, cx, cy - 110, 60 * big, 40 * big, p.prostate === 'boggy' ? 'rgba(220,90,80,.35)' : 'rgba(255,255,255,.12)', 'rgba(232,215,166,.6)'); if (p.prostate === 'hard') dots(g, BE.mulberry(3), 6, cx, cy - 110, 40, 25, 6, 'rgba(232,215,166,.6)'); note(g, '전립선(남성)', cx, cy - 165); }
        if (p.mass) { const [x, y] = at(cx, cy, p.mass, 90); ell(g, x, y, 30, 24, 'rgba(255,255,255,.18)', 'rgba(232,215,166,.7)'); }
        const gc = { fresh: '#b01818', melena: '#1a1410', jelly: '#a02a3a' }[p.blood];
        g.save(); g.translate(1000, 300); g.rotate(-0.4); rrect(g, -30, -120, 60, 200, 30, '#a9cbe6', 'rgba(0,0,0,.3)'); if (gc) { g.beginPath(); g.arc(0, -90, 30, Math.PI, 0); g.lineTo(30, -60); g.lineTo(-30, -60); g.closePath(); g.fillStyle = gc; g.fill(); } if (p.stool) ell(g, 0, -95, 22, 14, '#5a3a20'); g.restore();
        note(g, '뺀 장갑 끝', 1000, 440);
      }
    },
    exam() {
      const p = this.p, f = [];
      f.push(p.tone === 'lax' ? '괄약근 조임이 약함.' : '괄약근 조임 정상.');
      if (p.stool === 'impacted') f.push('딱딱한 대변 덩어리가 꽉 차 있음.');
      if (p.prostate) f.push({ enlarged: '전립선이 고르게 커지고 고무처럼 탄력 있음, 가운데 고랑이 얕아짐.', hard: '전립선이 돌처럼 단단하고 울퉁불퉁하며 고랑이 만져지지 않음.', boggy: '전립선이 물렁하고 뜨거우며 누르면 몹시 아파함.' }[p.prostate]);
      else if (this.av[0] === 'm') f.push('전립선 크기·단단함 정상, 가운데 고랑 만져짐.');
      if (p.mass) f.push(`${p.mass}시 방향에 단단한 덩어리가 만져짐.`);
      f.push({ fresh: '장갑에 선홍색 피가 묻어 나옴.', melena: '장갑에 검고 끈적한 변이 묻어 나옴.', jelly: '장갑에 피 섞인 젤리 같은 점액이 묻어 나옴.' }[p.blood] || '장갑에 피가 묻어 나오지 않음.');
      const say = p.prostate === 'boggy' ? '아악! 너무 아파요!' : p.tender === 'R' ? '아! 오른쪽이 아파요.' : p.tender || p.pain ? '아파요…' : '';
      return { felt: f.join(' '), say };
    },
  };
  S.pelvic = {
    pts() { return [{ k: 'spec', x: 600, y: 290, n: '질경으로 자궁경부 보기' }, { k: 'cmt', x: 600, y: 470, n: '양손 진찰 — 자궁경부 흔들기' }, { k: 'adR', x: 420, y: 470, n: '양손 진찰 — 오른쪽 부속기' }, { k: 'adL', x: 780, y: 470, n: '양손 진찰 — 왼쪽 부속기' }, { k: 'ut', x: 600, y: 130, n: '양손 진찰 — 자궁 크기·모양' }]; },
    hint: '동그라미를 눌러 질경 진찰·양손 진찰을 합니다(도식)',
    draw(g) {
      const p = this.p, cx = 600, cy = 290; floor(g, 560);
      if (p.noexam && !this.act) { note(g, '진찰 전에 환자 상태를 먼저 확인하세요', cx, cy); return; }
      ell(g, cx, cy, 190, 150, '#0b0f10'); ell(g, cx, cy, 170, 130, p.atrophy ? '#e0b0a8' : '#d48a86');
      const big = p.prolapse ? 1.5 : 1; ell(g, cx, cy, 70 * big, 60 * big, p.atrophy ? '#e8c0b8' : '#e0a09a', 'rgba(0,0,0,.2)');
      if (p.ectropion) ell(g, cx, cy, 34 * big, 26 * big, '#c0403a');
      if (p.strawberry) dots(g, BE.mulberry(6), 40, cx, cy, 60, 50, 3, '#b01818');
      if (p.lesion) ell(g, cx + 30, cy - 20, 18, 12, '#9a3030', '#efe3b8');
      if (p.os === 'open') ell(g, cx, cy, 16, 9, '#3a1010'); else ell(g, cx, cy, 6, 4, '#5a2020');
      if (p.blood) { g.fillStyle = '#9a1010'; g.beginPath(); g.moveTo(cx - 6, cy + 4); g.quadraticCurveTo(cx - 10, cy + 80, cx, cy + 110); g.quadraticCurveTo(cx + 10, cy + 80, cx + 6, cy + 4); g.fill(); }
      const dc = { curd: '#f4f0e0', frothy: '#c8c860', grey: '#b8b8b0', pus: '#d8c060', foul: '#a89060' }[p.disch];
      if (dc) { ell(g, cx, cy + 105, 110, 24, dc); if (p.disch === 'curd') dots(g, BE.mulberry(8), 14, cx, cy + 100, 100, 18, 7, '#ffffff'); if (p.disch === 'frothy') for (let i = 0; i < 12; i++) ell(g, cx - 90 + i * 16, cy + 100 + (i % 3) * 5, 5, 5, null, 'rgba(255,255,255,.7)', 1.5); }
      note(g, '질경으로 본 자궁경부(도식, 실제 사진 아님)', cx, 585);
    },
    exam(q) {
      const p = this.p, k = q.k;
      if (p.noexam) return { felt: '이 환자는 지금 질 내진을 하지 않습니다(먼저 다른 검사로 확인).' };
      if (k === 'spec') return { felt: '자궁경부와 분비물을 위 그림처럼 확인함.' };
      if (k === 'cmt') return p.cmt ? { say: p.cmt >= 1 ? '아악! 너무 아파요!' : '아, 아파요.', felt: '자궁경부를 움직이자 몹시 아파함.' } : { felt: '자궁경부를 움직여도 아파하지 않음.' };
      if (k === 'ut') return { felt: p.uterus === 'bulky' ? '자궁이 커지고 울퉁불퉁하게 만져짐.' : p.uterus === 'tender' ? '자궁을 누르면 아파함.' : p.fixed_uterus ? '자궁이 잘 움직이지 않고 고정되어 있음.' : '자궁 크기·모양 정상, 잘 움직임.', say: p.uterus === 'tender' ? '아, 거기 아파요.' : '' };
      const side = k === 'adR' ? 'R' : 'L', hit = p.adnexa === side || p.adnexa === 'both', mass = p.mass === side;
      return { felt: [mass ? `덩어리가 만져짐${p.fixed ? '(잘 움직이지 않음)' : ''}.` : '', hit ? '누르면 아파함.' : '', !hit && !mass ? '덩어리·압통 없음.' : ''].join(' ').trim(), say: hit ? '아, 그쪽이 아파요.' : '' };
    },
  };

  // ================================================================ 관절 — 서 있는 몸 + 손·발 확대
  const NORM = { shoulder: [180, '어깨 벌리기'], elbow: [150, '팔꿈치 굽히기'], wrist: [70, '손목 젖히기'], hip: [120, '고관절 굽히기'], knee: [135, '무릎 굽히기'], ankle: [50, '발목 움직이기'], mcp: [90, '손가락 마디 굽히기'], pip: [100, '손가락 가운데 마디 굽히기'], mtp1: [70, '엄지발가락 젖히기'] };
  const JN = { shoulder: '어깨', elbow: '팔꿈치', wrist: '손목', hip: '엉덩이(고관절)', knee: '무릎', ankle: '발목', mcp: '손가락 첫마디(MCP)', pip: '손가락 가운데 마디(PIP)', mtp1: '엄지발가락 뿌리' };
  function jointsOf(e) { return e.p.joints || {}; }
  function jointScene(e, g) {
    const p = e.p, J = jointsOf(e), sk = e.skin(); floor(g, 575);
    const F = figure(e, g, 300, 40, 520, { legR: p.leg === 'short_ext_R' ? 5 : 0, footOutR: p.leg === 'short_ext_R', varus: (J.knee_R || {}).deform === 'varus' || (J.knee_L || {}).deform === 'varus' });
    for (const [jk, v] of Object.entries(J)) {
      const pos = F[jk]; if (!pos || !(v.sw || v.red || v.bursa)) continue;
      const r = (jk.startsWith('knee') ? 28 : jk.startsWith('shoulder') || jk.startsWith('hip') ? 26 : 18) * (0.8 + (v.sw || 0) * 0.5);
      ell(g, pos[0], pos[1], r, r * 0.9, mix(sk, '#c8483e', clamp((v.red || 0) * 0.8, 0, 0.65)), LINE);
      if (v.bursa) ell(g, pos[0] + (jk.endsWith('R') ? -14 : 14), pos[1] + 6, 16, 14, mix(sk, '#c8483e', 0.4), LINE);
      if (v.deform === 'fork') { g.strokeStyle = LINE; g.lineWidth = 3; g.beginPath(); g.arc(pos[0], pos[1] - 4, 16, 3.6, 5.8); g.stroke(); }
    }
    const hp = {};
    for (const [k, d] of SIDES) hp[k] = hand(e, g, 820 + (d < 0 ? 0 : 240), 200, 110, d, { mcp: J['mcp_' + k], pip: J['pip_' + k], ulnar: (J['mcp_' + k] || {}).deform === 'ulnar' });
    note(g, '오른손(손등)', 820, 300); note(g, '왼손(손등)', 1060, 300);
    for (const [k, d] of SIDES) {
      const x = 820 + (d < 0 ? 0 : 240), y = 450, v = J['mtp1_' + k] || {};
      ell(g, x, y, 55, 90, sk, LINE);
      for (let i = 0; i < 5; i++) ell(g, x - d * (30 - i * 15), y - 90 - (i === 0 ? 8 : 0), i === 0 ? 15 : 10, i === 0 ? 18 : 12, sk, LINE);
      if (v.sw || v.red) ell(g, x - d * 30, y - 60, 20 * (0.8 + (v.sw || 0) * 0.5), 18, mix(sk, '#c8483e', clamp((v.red || 0) * 0.8, 0, 0.7)), LINE);
      note(g, k === 'R' ? '오른발(위에서)' : '왼발(위에서)', x, 562);
    }
    return { F, hp };
  }
  function jointPts(e) {
    const out = [];
    const pos = { shoulder: [[300 - 67.6, 133.6], [300 + 67.6, 133.6]], elbow: [[300 - 83.2, 216.8], [300 + 83.2, 216.8]], wrist: [[300 - 93.6, 289.6], [300 + 93.6, 289.6]], hip: [[300 - 36.4, 310.4], [300 + 36.4, 310.4]], knee: [[300 - 39, 419.6], [300 + 39, 419.6]], ankle: [[300 - 36.4, 528.8], [300 + 36.4, 528.8]] };
    for (const [j, xy] of Object.entries(pos)) SIDES.forEach(([k], i) => out.push({ k: j + '_' + k, x: xy[i][0], y: xy[i][1], n: `${k === 'R' ? '오른쪽' : '왼쪽'} ${JN[j]}` }));
    SIDES.forEach(([k, d]) => { const x = 820 + (d < 0 ? 0 : 240); out.push({ k: 'mcp_' + k, x: x + d * 5, y: 168, n: `${k === 'R' ? '오른손' : '왼손'} ${JN.mcp}` }, { k: 'pip_' + k, x: x + d * 5, y: 134, n: `${k === 'R' ? '오른손' : '왼손'} ${JN.pip}` }, { k: 'mtp1_' + k, x: x - d * 30, y: 390, n: `${k === 'R' ? '오른발' : '왼발'} ${JN.mtp1}` }); });
    return out;
  }
  const jname = (k) => k.split('_')[0];
  S.joint = { pts() { return []; }, draw(g) { jointScene(this, g); }, hint: '관절의 부기·붉은 기·변형을 좌우 비교하세요' };
  S.jpalp = {
    pts() { const o = jointPts(this); if (this.p.heel || this.p.achilles_gap) SIDES.forEach(([k, d]) => o.push({ k: 'heel_' + k, x: 820 + (d < 0 ? 0 : 240), y: 530, n: `${k === 'R' ? '오른쪽' : '왼쪽'} 발뒤꿈치·아킬레스건` })); return o; },
    draw(g) { jointScene(this, g); if (this.sel) finger(g, this.sel.x, this.sel.y, ease(this.since() / 0.4)); },
    exam(q) {
      const p = this.p, v = jointsOf(this)[q.k] || {}, j = jname(q.k), side = q.k.slice(-1);
      if (j === 'heel') return { felt: p.achilles_gap === side ? '아킬레스건 중간에 움푹 꺼진 틈이 만져짐.' : p.heel === side ? '발뒤꿈치 바닥 안쪽을 누르면 아파함.' : '압통 없음.', say: p.heel === side || p.achilles_gap === side ? '아, 거기 아파요.' : '' };
      const tp = p.tender_points && ['shoulder', 'elbow', 'hip', 'knee'].includes(j), sh = p.sh_tender && j === 'shoulder';
      const tender = v.tender || tp || sh || (p.bone_tender && j === 'wrist');
      const f = [v.sw ? '부어 있고' : '', v.warm ? '따뜻하며' : '', v.eff ? '관절 안에 물이 차 출렁임(무릎뼈를 누르면 톡 부딪힘)' : '', v.crep ? '움직일 때 뽀득거림' : '', tender ? '누르면 아파함' : ''].filter(Boolean).join(', ');
      return { felt: f ? f + '.' : '부기·열감·압통 없음.', say: tender ? '아야, 거기 아파요.' : '' };
    },
  };
  S.jrom = {
    pts() { return jointPts(this); },
    draw(g) {
      jointScene(this, g);
      if (this.sel && this.act) {
        const v = jointsOf(this)[this.sel.k] || {}, n = NORM[jname(this.sel.k)] || [90], kk = this.since(), deg = n[0] * (v.rom == null ? 1 : v.rom) * ease(kk / 2.2);
        rrect(g, 470, 70, 230, 170, 14, 'rgba(8,14,16,.85)', 'rgba(150,200,190,.3)');
        g.strokeStyle = 'rgba(150,200,190,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(500, 210, 110, -Math.PI / 2, 0); g.stroke();
        g.strokeStyle = '#e8d7a6'; g.lineWidth = 6; g.beginPath(); g.arc(500, 210, 110, -Math.PI / 2 * Math.min(1, deg / n[0]), 0); g.stroke();
        txt(g, Math.round(deg) + '°', 520, 200, { size: 26, w: 700, c: '#e8d7a6' }); txt(g, '움직인 범위', 520, 228, { size: 13, c: '#93a8a3' });
      }
    },
    exam(q) {
      const v = jointsOf(this)[q.k] || {}, n = NORM[jname(q.k)] || [90, '움직이기'], deg = Math.round(n[0] * (v.rom == null ? 1 : v.rom));
      const say = v.lock ? '무릎이 걸려서 끝까지 안 펴져요!' : v.tender && v.rom < 1 ? '아, 더 움직이면 아파요.' : '';
      return { felt: `${n[1]}: 약 ${deg}°까지 움직임 (보통 약 ${n[0]}°).${v.tender && v.rom < 1 ? ' 끝에서 아파함.' : ''}`, say };
    },
  };

  // ================================================================ 허리 — 뒤에서 본 몸(환자 오른쪽 = 화면 오른쪽)
  const LV = { T8: 250, T12: 325, L2: 360, L3: 385, 'L4-5': 415, 'L5-S1': 440 };
  function backView(e, g, tilt, rot) {
    const sk = e.skin(); floor(g, 560);
    g.save(); g.translate(CX, 470); g.rotate((tilt || 0) * Math.PI / 180); g.translate(-CX, -470);
    const sw = 150 * Math.cos((rot || 0) * Math.PI / 180);
    g.fillStyle = sk; g.strokeStyle = LINE; g.lineWidth = 2;
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(CX + d * sw, 185); g.quadraticCurveTo(CX + d * (sw + 50), 300, CX + d * (sw + 50), 460); g.lineTo(CX + d * (sw + 18), 465); g.quadraticCurveTo(CX + d * (sw + 15), 320, CX + d * (sw - 20), 250); g.closePath(); g.fill(); g.stroke(); }
    g.beginPath(); g.moveTo(CX - sw, 180); g.quadraticCurveTo(CX, 155, CX + sw, 180); g.lineTo(CX + 120, 360); g.quadraticCurveTo(CX + 115, 440, CX + 130, 480); g.lineTo(CX - 130, 480); g.quadraticCurveTo(CX - 115, 440, CX - 120, 360); g.closePath(); g.fill(); g.stroke();
    g.fillRect(CX - 26, 125, 52, 50); ell(g, CX, 85, 54, 62, '#2b221d', LINE);
    g.strokeStyle = 'rgba(80,40,20,.25)'; for (const d of [-1, 1]) { g.beginPath(); g.moveTo(CX + d * 30, 205); g.lineTo(CX + d * 90, 215); g.lineTo(CX + d * 70, 290); g.stroke(); }
    g.strokeStyle = 'rgba(80,40,20,.35)'; g.setLineDash([3, 7]); g.lineWidth = 3; g.beginPath(); g.moveTo(CX, 180); g.lineTo(CX, 455); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#5f7f9a'; g.fillRect(CX - 131, 460, 262, 100);
    g.restore();
    note(g, '환자 왼쪽', CX - 260, 590); note(g, '환자 오른쪽', CX + 260, 590); note(g, '뒤에서 본 모습', CX, 30);
  }
  S.back = {
    pts() { return []; }, hint: '뒤에서 척추 정렬과 피부를 보세요(옆모습 작은 그림 포함)',
    draw(g) {
      const p = this.p; backView(this, g, p.curve === 'list_R' ? 4 : 0);
      if (p.ulcer) { ell(g, CX, 455, 34, 24, '#8a2a3a', 'rgba(0,0,0,.3)'); ell(g, CX, 455, 16, 10, '#d8c8a0'); }
      ell(g, 1040, 300, 100, 140, '#1a2529', 'rgba(150,200,190,.35)'); note(g, '옆에서 본 등', 1040, 460);
      const k = p.curve === 'kyphosis' ? 40 : 15, l = p.curve === 'flat' ? 0 : 18;
      g.strokeStyle = this.skin(); g.lineWidth = 14; g.lineCap = 'round'; g.beginPath(); g.moveTo(1045, 180); g.bezierCurveTo(1045 + k, 250, 1045 + k * 0.4, 330, 1040 - l, 370); g.quadraticCurveTo(1035 - l * 0.6, 400, 1045, 425); g.stroke();
      ell(g, 1030 - (p.curve === 'kyphosis' ? 10 : 0), 168, 22, 22, '#2b221d');
    },
  };
  S.backp = {
    pts() { const o = Object.entries(LV).map(([k, y]) => ({ k, x: CX, y, n: `${k} 극돌기 누르기` })); o.push({ k: 'SI_L', x: CX - 45, y: 455, n: '왼쪽 엉치엉덩관절' }, { k: 'SI_R', x: CX + 45, y: 455, n: '오른쪽 엉치엉덩관절' }, { k: 'cva_L', x: CX - 75, y: 335, n: '왼쪽 늑척추각(주먹으로 두드림)' }, { k: 'cva_R', x: CX + 75, y: 335, n: '오른쪽 늑척추각' }, { k: 'para_L', x: CX - 45, y: 400, n: '왼쪽 허리 근육' }, { k: 'para_R', x: CX + 45, y: 400, n: '오른쪽 허리 근육' }); return o; },
    draw(g) { backView(this, g, this.p.curve === 'list_R' ? 4 : 0); },
    exam(q) {
      const p = this.p, k = q.k, hit = (p.tender || []).includes(k) || (k.startsWith('cva') && p.cva === k.slice(-1)) || (k.startsWith('para') && p.para === k.slice(-1));
      return { say: hit ? (k.startsWith('cva') ? '아야! 옆구리가 울려요!' : '아야! 거기요, 거기 아파요.') : '', felt: hit ? '누르거나 두드리면 움찔하며 아파함.' : '아파하지 않음.' };
    },
  };
  const MOV = { flex: [80, '앞으로 굽히기'], ext: [25, '뒤로 젖히기'], latR: [30, '오른쪽으로 옆 굽히기'], latL: [30, '왼쪽으로 옆 굽히기'], rotR: [40, '오른쪽으로 돌리기'], rotL: [40, '왼쪽으로 돌리기'] };
  S.backrom = {
    pts() { return Object.keys(MOV).map((k, i) => ({ k, x: 560 + i * 110, y: 95, n: MOV[k][1] })); },
    hint: '아래 동그라미를 눌러 허리 움직임을 시켜 보세요',
    draw(g) {
      const p = this.p, m = this.act && MOV[this.act.k] ? this.act.k : null, kk = this.since();
      const deg = m ? MOV[m][0] * ((p.rom || {})[m] == null ? 1 : p.rom[m]) * ease(kk / 1.8) * (kk > 5 ? Math.max(0, 1 - (kk - 5)) : 1) : 0;
      floor(g, 520);
      const sk = this.skin(), hip = [330, 330], sgn = m === 'ext' ? 1 : -1, a = (m === 'flex' || m === 'ext' ? sgn * deg : 0) * Math.PI / 180;
      limb(g, [hip, [330, 420], [330, 510]], 34, sk);
      const top = [hip[0] + Math.sin(-a) * 190, hip[1] - Math.cos(a) * 190];
      limb(g, [hip, top], 60, sk); ell(g, top[0] + Math.sin(-a) * 45, top[1] - Math.cos(a) * 45, 36, 36, sk, LINE);
      limb(g, [[top[0] + Math.sin(-a) * -10, top[1] + 10], [top[0] + Math.sin(-a) * -10, top[1] + 150]], 20, sk);
      g.fillStyle = '#5f7f9a'; g.fillRect(300, 300, 62, 70);
      note(g, '옆에서(앞 = 오른쪽)', 330, 30);
      g.save(); g.translate(500, 0); g.scale(0.62, 0.62); g.translate(0, 80);
      backView(this, g, m === 'latR' ? deg : m === 'latL' ? -deg : 0, m === 'rotR' || m === 'rotL' ? deg : 0);
      g.restore();
      Object.keys(MOV).forEach((k, i) => note(g, MOV[k][1].replace('으로 ', ' ').replace('오른쪽', '오른').replace('왼쪽', '왼'), 560 + i * 110, 130));
      if (m) { txt(g, `${MOV[m][1]} 약 ${Math.round(deg)}°`, 880, 500, { size: 18, w: 600, c: '#e8d7a6', al: 'center' }); }
    },
    exam(q) {
      const p = this.p, r = (p.rom || {})[q.k] == null ? 1 : p.rom[q.k], deg = Math.round(MOV[q.k][0] * r), pain = (p.pain || []).includes(q.k);
      return { felt: `${MOV[q.k][1]}: 약 ${deg}° (보통 약 ${MOV[q.k][0]}°)${pain ? ', 움직일 때 아파함' : ''}.`, say: pain ? '아, 허리가 아파서 더는 못 하겠어요.' : r < 1 ? '이 이상은 안 돼요.' : '' };
    },
  };

  // ================================================================ SLR — 누운 다리를 올리다 아파하는 각도에서 멈춤
  S.slr = {
    pts() { return [{ k: 'R', x: 760, y: 370, n: '오른쪽 다리 곧게 들어 올리기' }, { k: 'L', x: 880, y: 370, n: '왼쪽 다리 곧게 들어 올리기' }]; },
    hint: '동그라미를 누르면 무릎을 편 채 다리를 천천히 올립니다',
    draw(g) {
      floor(g, 560);
      const k = this.act ? this.act.k : null, v = k ? this.p[k] || 0 : 0, tgt = v > 0 ? v : 80, kk = this.since();
      const ang = k ? tgt * ease(kk / 2.6) * (kk > 6 ? Math.max(0, 1 - (kk - 6) / 1.5) : 1) : 0;
      g.save(); g.translate(120, 130); g.scale(0.8, 0.8);
      const L = lying(this, g, { hipN: k === 'R' ? ang : 0, hipF: k === 'L' ? ang : 0 });
      if (k) { protractor(g, L.hip[0], L.hip[1], 120, ang, 0); if (k === 'R') finger(g, L.an[0], L.an[1] + 20, 1); }
      g.restore();
      note(g, '옆에서 본 누운 환자(가까운 다리 = 오른쪽)', 600, 590);
    },
    exam(q) {
      const v = this.p[q.k] || 0;
      return v > 0 ? { felt: `다리를 약 ${v}°쯤 올리자 엉덩이에서 다리 뒤쪽으로 뻗치는 통증을 호소함.`, say: '아악! 엉덩이에서 다리 뒤로 찌릿해요!' } : { felt: '80°까지 올려도 다리 뒤로 뻗치는 통증이 없음(허벅지 뒤가 당기는 정도).', say: '허벅지 뒤가 좀 당기기만 해요.' };
    },
  };
})();

/* ---- 4부: 신경(안면 감각·운동, 청력, 감각, 근력, 뇌막 자극) · 인지(기억·계산·지남력·명령·그리기) */
(function () {
  'use strict';
  const BE = window.BodyEngine, S = BE.SCENES, W = 1200, H = 600, CX = 600, mix = BE.mix;
  const { ell, txt, limb, rrect, face, figure, hand, lying, note, fork, finger, ring, protractor, floor } = BE.draw;
  const LINE = 'rgba(0,0,0,.35)', SIDES = [['R', -1], ['L', 1]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  const SN = (s) => s === 'R' ? '오른쪽' : '왼쪽';

  // ================================================================ 안면 감각 — 솜으로 V1·V2·V3 를 좌우 비교
  const FS = { V1: [-0.3, -0.36, '이마'], V2: [-0.42, 0.12, '뺨'], V3: [-0.32, 0.62, '턱'] };
  S.fsens = {
    pts() { const o = []; for (const [k, d] of SIDES) for (const [v, [x, y, n]] of Object.entries(FS)) o.push({ k: k + '.' + v, x: 600 + d * Math.abs(x) * 200, y: 290 + y * 200, n: `${SN(k)} ${n}(${v}) 솜으로 건드리기` }); return o; },
    hint: '이마·뺨·턱 동그라미를 좌우 번갈아 눌러 "똑같이 느껴지세요?" 물어봅니다',
    draw(g) { floor(g, 560); face(this, g, 600, 290, 200, { eR: 0.05, eL: 0.05 }); note(g, '눈을 감게 하고 검사', 600, 585); if (this.sel) { ring(g, this.sel.x, this.sel.y, this.since() * 1.5); } },
    exam(q) {
      const [s, v] = q.k.split('.'), val = (this.p[s] || {})[v];
      if (val === 'trigger') return { say: '아악! 거기 건드리면 전기 오듯이 찌릿해요!', felt: '살짝 건드리자 얼굴을 찡그리며 몹시 아파함.' };
      if (this.p.midline && val) return { say: '여기부터 딱 안 느껴져요. 가운데 선에서요.', felt: '' };
      if (val) return { say: val <= 0.5 ? '이쪽은 덜 느껴져요. 반대쪽의 반 정도요.' : '이쪽이 조금 덜 느껴지는 것 같아요.', felt: '' };
      return { say: '네, 느껴져요. 양쪽 똑같아요.', felt: '' };
    },
  };

  // ================================================================ 안면 운동 — 이마 주름 → 눈 꼭 감기 → 웃기 를 반복
  const STEPS = [['rest', '가만히 계세요'], ['brow', '눈썹을 올려 보세요(이마 주름)'], ['close', '눈을 꼭 감아 보세요'], ['smile', '이를 보이며 웃어 보세요'], ['puff', '볼을 부풀려 보세요']];
  function fexpr(e) {
    const p = e.p, k = e.since('act') < 1e8 ? e.since('act') : e.t, step = Math.floor(k / 2.2) % STEPS.length, ph = ease(((k / 2.2) % 1) / 0.35);
    const amp = p.masked ? 0.3 : 1, o = { eR: 1, eL: 1 }, st = STEPS[step][0];
    const weak = (s) => p[s] === 'lmn' || p[s] === 'weak' ? 'lmn' : p[s] === 'umn' ? 'umn' : '';
    for (const [s] of SIDES) {
      const w = weak(s), b = 'b' + s, m = 'm' + s, ey = 'e' + s;
      o[b] = st === 'brow' ? ph * amp * (w === 'lmn' ? 0.05 : 1) : 0;
      o[ey] = st === 'close' ? 1 - ph * (w === 'lmn' ? 0.7 : w === 'umn' ? 0.92 : 1) : 1;
      if (st === 'close' && w === 'lmn') o['gy' + s] = -1.2 * ph;
      o[m] = st === 'smile' ? ph * amp * (w ? 0.08 : 1) : w === 'lmn' ? -0.35 : w === 'umn' ? -0.15 : 0;
      if (w) o['flat' + s] = 1;
    }
    o.teeth = st === 'smile' && ph > 0.3; o.open = o.teeth ? 0.1 : 0;
    o.puff = st === 'puff' ? ph * amp : 0;
    if (st === 'rest' && (e.t % (p.masked ? 9 : 4)) < 0.15) { o.eR = 0.05; o.eL = 0.05; }
    return { o, step };
  }
  S.fmotor = {
    pts() { return [{ k: 'chv_R', x: 430, y: 300, n: '오른쪽 귀 앞 볼 두드리기(Chvostek)' }, { k: 'chv_L', x: 770, y: 300, n: '왼쪽 귀 앞 볼 두드리기' }]; },
    hint: '진찰하기를 누르면 표정 짓기를 차례로 시킵니다',
    draw(g) {
      floor(g, 560); const { o, step } = fexpr(this), p = this.p;
      if (this.act && this.act.k.startsWith('chv') && p.chvostek && this.since() < 0.6) { const s = this.act.k.slice(-1); o['m' + s] = 0.5 * Math.sin(this.since() * 40); }
      if (o.puff) for (const [s, d] of SIDES) { const w = p[s] === 'lmn' || p[s] === 'weak'; ell(g, 600 + d * 125, 380, 50 * o.puff * (w ? 0.4 : 1), 46 * o.puff * (w ? 0.4 : 1), this.skin()); }
      face(this, g, 600, 280, 210, o);
      if (o.puff) for (const [s, d] of SIDES) { const w = p[s] === 'lmn' || p[s] === 'weak'; ell(g, 600 + d * 110, 360, 55 * o.puff * (w ? 0.35 : 1), 45 * o.puff * (w ? 0.35 : 1), this.skin()); }
      rrect(g, 830, 40, 340, 46, 12, 'rgba(232,215,166,.92)'); txt(g, STEPS[step][1], 1000, 70, { size: 17, w: 600, c: '#1a2529', al: 'center' });
      if (this.act && this.act.k.startsWith('chv') && this.since() < 1) finger(g, this.act.k === 'chv_R' ? 430 : 770, 300, 1);
    },
    auto() { return {}; },
    exam(q) { this.act = { k: q.k, t0: this.t }; return { felt: this.p.chvostek ? '두드리자 같은 쪽 입꼬리가 씰룩 움직임.' : '두드려도 얼굴 근육이 움직이지 않음.' }; },
  };

  // ================================================================ 청력 — 속삭임·Weber·Rinne
  S.hear = {
    pts() { return [{ k: 'wR', x: 430, y: 290, n: '오른쪽 귀에 속삭이기(반대쪽 귀는 막고)' }, { k: 'wL', x: 770, y: 290, n: '왼쪽 귀에 속삭이기' }, { k: 'weber', x: 600, y: 140, n: 'Weber — 이마 가운데에 소리굽쇠' }, { k: 'rR', x: 430, y: 380, n: '오른쪽 Rinne — 귀 뒤 뼈 → 귀 앞' }, { k: 'rL', x: 770, y: 380, n: '왼쪽 Rinne' }]; },
    hint: '귀 옆(속삭임)·이마(Weber)·귀 뒤(Rinne) 동그라미를 눌러 보세요',
    draw(g) { floor(g, 560); face(this, g, 600, 290, 200, {}); if (this.sel) { const k = this.since(); if (this.sel.k.startsWith('w')) { rrect(g, this.sel.x + (this.sel.k === 'wR' ? -190 : 40), 220, 150, 44, 12, 'rgba(232,215,166,.9)'); txt(g, '"사과…"', this.sel.x + (this.sel.k === 'wR' ? -115 : 115), 249, { size: 17, c: '#1a2529', al: 'center' }); } else fork(g, this.sel.x, this.sel.y, k); } },
    exam(q) {
      const p = this.p, R = p.R == null ? 1 : p.R, L = p.L == null ? 1 : p.L, type = p.type || 'sn', k = q.k;
      if (k[0] === 'w') { const v = k === 'wR' ? R : L; return { say: v >= 0.9 ? '사과요.' : v >= 0.55 ? '네? …사과요?' : '뭐라고요? 잘 안 들려요.' }; }
      if (k === 'weber') {
        if (Math.abs(R - L) < 0.15) return { say: '가운데서 똑같이 들려요.' };
        const worse = R < L ? 'R' : 'L', better = worse === 'R' ? 'L' : 'R', side = type === 'sn' ? better : worse;
        return { say: `${SN(side)}에서 더 크게 들려요.` };
      }
      const s = k === 'rR' ? 'R' : 'L', v = s === 'R' ? R : L, bcBetter = v < 0.9 && (type === 'cond' || type === 'mixed');
      return { say: bcBetter ? '뼈에 댔을 때가 더 크게 들렸어요. 귀 앞에서는 잘 안 들려요.' : '귀 앞에 댔을 때가 더 오래 들려요.' };
    },
  };

  // ================================================================ 감각 — 몸 그림 + 손·발 확대, 누른 곳마다 환자가 대답
  function sensFig(e, g, legs) {
    floor(g, 575);
    const F = figure(e, g, 300, 40, 520, { armOut: legs ? 0 : 0.4 });
    const hp = {};
    if (!legs) for (const [k, d] of SIDES) { hp[k] = hand(e, g, 820 + (d < 0 ? 0 : 240), 270, 120, d, { palm: true }); note(g, k === 'R' ? '오른손(손바닥)' : '왼손(손바닥)', 820 + (d < 0 ? 0 : 240), 410); }
    else for (const [k, d] of SIDES) { const x = 820 + (d < 0 ? 0 : 240), sk = e.skin(); ell(g, x, 300, 60, 120, sk, LINE); for (let i = 0; i < 5; i++) ell(g, x + d * (34 - i * 16) * -1, 175 - (i === 0 ? 8 : 0), i === 0 ? 16 : 11, i === 0 ? 19 : 13, sk, LINE); note(g, k === 'R' ? '오른발 바닥' : '왼발 바닥', x, 450); }
    return { F, hp };
  }
  function sensPts(e, legs) {
    const u = 5.2, cx = 300, top = 40, o = [];
    if (!legs) {
      for (const [k, d] of SIDES) {
        const ao = 0.4;
        o.push({ k: k + '.uarm', x: cx + d * (14.5 + ao * 2.5) * u, y: top + 26 * u, n: `${SN(k)} 위팔` }, { k: k + '.farm', x: cx + d * (17 + ao * 7) * u, y: top + 41 * u, n: `${SN(k)} 아래팔` });
        const x = 820 + (d < 0 ? 0 : 240), ts = -d; // 손바닥에서 엄지는 바깥쪽
        o.push({ k: k + '.thumb', x: x + ts * 0.7 * 120, y: 270 - 0.32 * 120, n: `${SN(k)} 엄지 끝` }, { k: k + '.index', x: x + ts * 0.27 * 120, y: 270 - 0.3 * 120 - 0.55 * 120, n: `${SN(k)} 검지 끝` }, { k: k + '.little', x: x - ts * 0.26 * 120, y: 270 - 0.3 * 120 - 0.5 * 120, n: `${SN(k)} 새끼손가락 끝` }, { k: k + '.web', x: x + ts * 0.3 * 120, y: 270 - 0.1 * 120, n: `${SN(k)} 손등 엄지-검지 사이` });
      }
    } else {
      for (const [k, d] of SIDES) {
        o.push({ k: k + '.thigh', x: cx + d * 7.2 * u, y: top + 62 * u, n: `${SN(k)} 허벅지 앞` }, { k: k + '.shinM', x: cx + d * 5 * u, y: top + 84 * u, n: `${SN(k)} 정강이 안쪽` }, { k: k + '.calfL', x: cx + d * 10 * u, y: top + 82 * u, n: `${SN(k)} 종아리 바깥쪽` }, { k: k + '.dorsum', x: cx + d * 8.5 * u, y: top + 97 * u, n: `${SN(k)} 발등` });
        const x = 820 + (d < 0 ? 0 : 240);
        o.push({ k: k + '.sole', x: x - d * 40, y: 330, n: `${SN(k)} 발바닥 바깥쪽·새끼발가락` }, { k: k + '.vib', x: x, y: 520, n: `${SN(k)} 안쪽 복사뼈 — 소리굽쇠 진동` }, { k: k + '.propr', x: x - d * 34, y: 175, n: `${SN(k)} 엄지발가락 위치감각(위/아래)` });
      }
      o.push({ k: 'C.above', x: cx, y: top + 37 * u, n: '배꼽 위' }, { k: 'C.below', x: cx, y: top + 45 * u, n: '배꼽 아래' }, { k: 'C.saddle', x: cx, y: top + 57.5 * u, n: '엉덩이 안쪽·회음부(안장 부위)' });
    }
    return o;
  }
  function sensHit(p, key) {
    const [s, part] = key.split('.'), pat = p.pat;
    const handP = ['thumb', 'index', 'little', 'web'].includes(part), arm = handP || ['farm', 'uarm'].includes(part), leg = ['thigh', 'shinM', 'calfL', 'dorsum', 'sole'].includes(part);
    switch (pat) {
      case 'glove': return handP;
      case 'median_R': return s === 'R' && ['thumb', 'index'].includes(part);
      case 'radial_R': return s === 'R' && part === 'web';
      case 'hemi_R': return s === 'R' && (arm || leg);
      case 'stocking': return ['dorsum', 'sole'].includes(part);
      case 'L5_L': return s === 'L' && ['calfL', 'dorsum'].includes(part);
      case 'S1_L': return s === 'L' && part === 'sole';
      case 'foot_R': return s === 'R' && ['dorsum', 'sole'].includes(part);
      case 'peroneal_R': return s === 'R' && ['calfL', 'dorsum'].includes(part);
      case 'level_T10': return leg || part === 'below' || part === 'saddle';
      case 'saddle': return part === 'saddle';
      case 'nonanatomic': return s === 'L' && leg;
      default: return false;
    }
  }
  function sensExam(q) {
    const p = this.p, part = q.k.split('.')[1];
    if (part === 'vib') return { say: p.vib || p.pat === 'proprio' ? '울리는 것 같기도 하고… 잘 모르겠어요.' : '윙윙 울려요… 이제 멈췄어요.' };
    if (part === 'propr') return { say: p.propr || p.pat === 'proprio' ? '음… 아래요? (틀림)' : '위로요.' };
    if (!sensHit(p, q.k)) return { say: '네, 잘 느껴져요. 반대쪽이랑 똑같아요.' };
    return { say: p.kind === 'absent' ? '거기는 전혀 안 느껴져요.' : p.kind === 'tingle' ? '저릿저릿하고 좀 둔해요.' : '여기는 덜 느껴져요. 반대쪽의 반 정도요.' };
  }
  S.sarm = { pts() { return sensPts(this, false); }, draw(g) { sensFig(this, g, false); if (this.sel) ring(g, this.sel.x, this.sel.y, this.since() * 1.5); }, exam: sensExam, hint: '눈을 감게 하고 동그라미를 눌러 좌우를 비교합니다(솜·핀)' };
  S.sleg = { pts() { return sensPts(this, true); }, draw(g) { sensFig(this, g, true); if (this.sel) { if (this.sel.k.endsWith('vib')) fork(g, this.sel.x, this.sel.y, this.since()); else ring(g, this.sel.x, this.sel.y, this.since() * 1.5); } }, exam: sensExam, hint: '눈을 감게 하고 동그라미를 눌러 좌우를 비교합니다(솜·핀·소리굽쇠)' };

  // ================================================================ 근력 — 버티게 하고 힘 막대로 보여 줌(등급은 학생이 판단)
  const MUS_A = { sh_abd: '어깨 벌리기', el_flex: '팔꿈치 굽히기', wr_ext: '손목 펴기', grip: '손 쥐기', fing_ext: '손가락 펴기', fing: '손가락 벌리기', thumb: '엄지 벌리기' };
  const MUS_L = { hip_flex: '고관절 굽히기(허벅지 들기)', knee_ext: '무릎 펴기', ankle_df: '발목 위로 젖히기', ankle_pf: '발목 아래로 누르기', ehl: '엄지발가락 위로 젖히기', evert: '발 바깥으로 돌리기' };
  const DESC = { 5: '검사자가 세게 눌러도 끝까지 버팀', 4: '저항을 어느 정도 이기지만 세게 누르면 밀림', 3: '중력을 이기고 들어 올리지만 조금만 눌러도 밀림', 2: '중력이 없는 옆 방향으로만 움직임', 1: '근육이 움찔하는 것만 보이고 관절은 움직이지 않음', 0: '움직임도 근육 수축도 없음' };
  function grade(p, s, m) { const v = p[s] || {}; return v.all != null ? v.all : v[m] != null ? v[m] : 5; }
  function powPts(legs) {
    const u = 5.2, cx = 300, top = 40, o = [];
    for (const [k, d] of SIDES) {
      if (!legs) {
        o.push({ k: k + '.sh_abd', x: cx + d * 13 * u, y: top + 15 * u }, { k: k + '.el_flex', x: cx + d * 14.5 * u, y: top + 26 * u }, { k: k + '.wr_ext', x: cx + d * 17 * u, y: top + 41 * u }, { k: k + '.grip', x: cx + d * 19 * u, y: top + 53 * u });
        const x = 820 + (d < 0 ? 0 : 240);
        o.push({ k: k + '.fing_ext', x, y: 120 }, { k: k + '.fing', x: x - d * 40, y: 180 }, { k: k + '.thumb', x: x + d * 80, y: 230 });
      } else {
        o.push({ k: k + '.hip_flex', x: cx + d * 7 * u, y: top + 57 * u }, { k: k + '.knee_ext', x: cx + d * 7.3 * u, y: top + 67 * u }, { k: k + '.ankle_df', x: cx + d * 7.3 * u, y: top + 82 * u }, { k: k + '.ankle_pf', x: cx + d * 11 * u, y: top + 86 * u }, { k: k + '.ehl', x: cx + d * 9 * u, y: top + 99 * u }, { k: k + '.evert', x: cx + d * 12.5 * u, y: top + 96 * u });
      }
    }
    for (const q of o) { const [s, m] = q.k.split('.'); q.n = `${SN(s)} ${(legs ? MUS_L : MUS_A)[m]} — 버티게 하기`; }
    if (legs) o.push({ k: 'hoover', x: 600, y: 520, n: 'Hoover 검사 — 누워서 한쪽 다리를 들 때 반대쪽 발뒤꿈치 힘' });
    return o;
  }
  function powDraw(g, legs) {
    floor(g, 575); figure(this, g, 300, 40, 520, {});
    if (!legs) for (const [k, d] of SIDES) { hand(this, g, 820 + (d < 0 ? 0 : 240), 200, 110, d, {}); note(g, k === 'R' ? '오른손' : '왼손', 820 + (d < 0 ? 0 : 240), 300); }
    else rrect(g, 470, 480, 260, 80, 12, 'rgba(26,37,41,.9)', 'rgba(150,200,190,.3)');
    if (this.sel && this.sel.k !== 'hoover') {
      const [s, m] = this.sel.k.split('.'), gr = grade(this.p, s, m), kk = this.since(), x = this.sel.x + (s === 'R' ? -150 : 30), y = this.sel.y - 30;
      rrect(g, x, y, 120, 18, 9, '#1a2529', 'rgba(150,200,190,.4)');
      rrect(g, x, y, 120 * gr / 5 * ease(kk / 1.2), 18, 9, gr >= 5 ? '#7ec8a8' : gr >= 4 ? '#e8d7a6' : '#e88a70');
      txt(g, '버티는 힘', x + 60, y - 6, { size: 12, c: '#93a8a3', al: 'center' });
    }
  }
  function powExam(q) {
    const p = this.p;
    if (q.k === 'hoover') return { felt: p.hoover ? '약하다던 다리를 들게 하면 거의 들지 못하지만, 반대쪽 다리를 들 때는 약한 쪽 발뒤꿈치가 침대를 세게 누름.' : '한쪽 다리를 들 때 반대쪽 발뒤꿈치가 침대를 누르는 힘이 좌우 같음.' };
    const [s, m] = q.k.split('.'), gr = grade(p, s, m);
    let felt = DESC[gr] + '.';
    if (m === 'el_flex' && p.rigid === s) felt += ' 팔꿈치를 굽혔다 펴면 톱니바퀴처럼 툭툭 걸리는 뻣뻣함.';
    if (m === 'sh_abd' && p.fatigue) felt = '처음에는 잘 버티다가 여러 번 반복하면 점점 힘이 빠짐.';
    const say = m === 'sh_abd' && p.fatigue ? '자꾸 하니까 팔이 점점 무거워져요.' : gr <= 2 ? '…힘이 안 들어가요.' : gr === 3 ? '으… 이게 다예요.' : gr === 4 ? '이게 최선이에요.' : '';
    return { felt, say };
  }
  S.parm = { pts() { return powPts(false); }, draw(g) { powDraw.call(this, g, false); }, exam: powExam, hint: '동그라미를 누르면 그 근육으로 버티게 하고, 힘 막대로 보여 줍니다' };
  S.pleg = { pts() { return powPts(true); }, draw(g) { powDraw.call(this, g, true); }, exam: powExam, hint: '동그라미를 누르면 그 근육으로 버티게 하고, 힘 막대로 보여 줍니다' };

  // ================================================================ 뇌막 자극 — 목 굽히기(Brudzinski)·Kernig
  S.mening = {
    pts() { return [{ k: 'neck', x: 235, y: 290, n: '머리를 들어 턱을 가슴 쪽으로 굽히기' }, { k: 'kernig', x: 820, y: 300, n: 'Kernig — 고관절 90°로 굽힌 채 무릎 펴기' }]; },
    hint: '머리 동그라미 = 목 굽히기, 다리 동그라미 = Kernig 검사',
    draw(g) {
      floor(g, 560); const p = this.p, k = this.act ? this.act.k : null, kk = this.since(), back = kk > 5 ? Math.max(0, 1 - (kk - 5) / 1.2) : 1;
      if (k === 'neck') {
        const max = 45 * (1 - 0.8 * (p.stiff || 0)), pr = ease(kk / 2) * back, br = p.brudz ? pr : 0;
        lying(this, g, { neck: max * pr, hipN: 55 * br, kneeN: 100 * br, hipF: 55 * br, kneeF: 100 * br });
        protractor(g, 305, 345, 70, max * pr, Math.PI / 2);
      } else if (k === 'kernig') {
        const hp = ease(kk / 1.2) * back, ex = ease((kk - 1.4) / 2) * back, stop = p.kernig ? 50 : 0;
        lying(this, g, { hipN: 90 * hp, kneeN: 90 * hp - (90 - stop) * ex });
      } else lying(this, g, {});
      note(g, '옆에서 본 누운 환자', 600, 590);
    },
    exam(q) {
      const p = this.p;
      if (q.k === 'neck') return p.stiff ? { say: '아악, 목이 뻣뻣해서 안 숙여져요!', felt: `목을 굽히려 하면 뻣뻣하게 버팀${p.brudz ? ', 그때 양쪽 엉덩이·무릎이 저절로 굽음' : ''}.` } : { felt: '턱이 가슴에 닿을 만큼 부드럽게 굽혀짐, 다리는 움직이지 않음.' };
      return p.kernig ? { say: '아, 허벅지 뒤랑 허리가 당겨서 못 펴겠어요!', felt: '무릎을 펴려 하면 아파하며 135°쯤에서 더 펴지지 않음.' } : { felt: '고관절을 굽힌 채 무릎이 끝까지 펴짐, 통증 없음.' };
    },
  };

  // ================================================================ 인지 — 환자 얼굴 + 오른쪽 판에 대답·그림
  const today = () => { const d = new Date(); return [d.getMonth() + 1, d.getDate(), '일월화수목금토'[d.getDay()]]; };
  function cogFace(e, g) {
    const c = e.p.cog || 'normal';
    const o = { normal: { mR: 0.15, mL: 0.15 }, mci: { mR: 0.1, mL: 0.1 }, mild: {}, moderate: { gx: Math.sin(e.t * 0.5) * 0.5 }, severe: { eR: 0.55, eL: 0.55 }, delirium: { gx: Math.sin(e.t * 1.3) * 0.9 }, depress: { mR: -0.4, mL: -0.4, gy: 0.6 }, wernicke: { gx: Math.sin(e.t * 0.7) * 0.4 }, aphasia: { mR: -0.2 } }[c] || {};
    if (e.t % 4 < 0.12) { o.eR = 0.05; o.eL = 0.05; }
    floor(g, 560); face(e, g, 260, 290, 150, o);
    rrect(g, 520, 70, 650, 470, 16, '#eef2ef', null);
    return c;
  }
  const board = (g, s, y, o = {}) => txt(g, s, o.x || 545, y, Object.assign({ c: '#1a2529', size: 19 }, o));
  const WORDS = '사과 · 기차 · 소나무';
  S.recall = {
    pts() { return []; }, hint: '진찰하기 = 세 단어를 들려주고 5분 뒤 다시 물어봅니다',
    draw(g) { cogFace(this, g); board(g, '① 세 단어를 따라 말하게 하기', 120, { w: 700 }); board(g, WORDS, 175, { size: 30, w: 700, x: 845, al: 'center' }); board(g, '② 다른 검사를 하고 5분 뒤', 260, { w: 700 }); board(g, '"아까 말씀드린 세 단어를 말해 보세요."', 305); if (this.act) board(g, '→ 환자 대답은 말풍선으로', 380, { c: '#5a6a66', size: 16 }); },
    auto() { return this.p.cog === 'normal' || !this.p.cog ? { say: '사과, 기차, 소나무요.' } : {}; },
  };
  const SEQ = { normal: [93, 86, 79, 72, 65], mci: [93, 86, 79, 72, 66], mild: [93, 86, 80, 75, '…'], moderate: [93, '…'], severe: ['(시작하지 못함)'], delirium: [93, '…'], depress: [93, 86, 79, 72, 64], wernicke: [93, 86, 80, 70, '…'], aphasia: ['(말로 답하지 못함)'] };
  S.calc = {
    pts() { return []; }, hint: '진찰하기 = "100에서 7씩 빼 보세요"',
    draw(g) {
      const c = cogFace(this, g); board(g, '"100에서 7을 빼면? 거기서 또 7을 빼면?"', 120, { w: 700 });
      if (this.act) { const s = SEQ[c] || SEQ.normal, n = Math.min(s.length, Math.floor(this.since() / 1.3) + 1); s.slice(0, n).forEach((v, i) => board(g, String(v), 220 + i * 52, { size: 30, w: 700, x: 600 + (typeof v === 'number' ? 0 : 0) })); board(g, '(맞았는지는 직접 확인하세요)', 500, { c: '#5a6a66', size: 15 }); }
    },
    auto() { const s = SEQ[this.p.cog || 'normal'] || SEQ.normal; return this.p.cog === 'normal' || !this.p.cog ? { say: s.join(', ') + '.' } : {}; },
  };
  function orientAns(c) {
    const [m, d, w] = today();
    return ({ normal: [`${m}월 ${d}일이요.`, `${w}요일이요.`, '병원이요. 진료실이요.', '같이 온 우리 가족이요.'], mild: [`${m}월… 날짜는 잘 모르겠어요.`, '수요일인가?', '병원이요.', '우리 가족이요.'], moderate: ['…봄인가?', '모르겠어요.', '우리 동네 복지관 아니에요?', '가족이요.'], severe: ['…', '…', '…집이요.', '(쳐다보기만 함)'], delirium: ['지금 밤이에요? 몇 시예요?', '몰라요…', '여기 집 아니에요?', '엄마? …아니, 누구지?'], wernicke: ['아직 9월 아닌가요?', '월요일이요.', '회사 근처 병원이죠? 출근해야 하는데.', '직장 동료요.'], aphasia: ['어… 그… (말이 안 나옴)', '(고개를 젓는다)', '(병원 간판을 가리킨다)', '(가족을 보고 고개를 끄덕인다)'] })[c] || null;
  }
  S.orient = {
    pts() { return []; }, hint: '진찰하기 = 날짜·요일·장소·사람을 물어봅니다',
    draw(g) {
      const c = cogFace(this, g), Qs = ['오늘이 몇 월 며칠이에요?', '오늘 무슨 요일이에요?', '여기가 어디예요?', '(같이 온 분을 가리키며) 이분은 누구세요?'];
      const A = orientAns(c) || orientAns('normal'), n = this.act ? Math.floor(this.since() / 1.4) + 1 : 0;
      Qs.forEach((q, i) => { board(g, 'Q. ' + q, 125 + i * 100, { size: 17, c: '#3a4a46' }); if (i < n) board(g, 'A. ' + A[i], 160 + i * 100, { size: 19, w: 600 }); });
    },
    auto() { const c = this.p.cog || 'normal'; const A = orientAns(c); return c === 'normal' || c === 'mci' || c === 'depress' ? { say: (orientAns('normal')).slice(0, 3).join(' ') } : A ? {} : {}; },
  };
  const STEP_N = { normal: 3, mci: 3, mild: 2, moderate: 1, severe: 0, delirium: 1, depress: 3, wernicke: 2, aphasia: 1 };
  S.cmd = {
    pts() { return []; }, hint: '진찰하기 = "이 종이를 오른손으로 받아 → 반으로 접어 → 바닥에 놓으세요"',
    draw(g) {
      const c = cogFace(this, g), n = STEP_N[c] == null ? 3 : STEP_N[c], prog = this.act ? this.since() / 1.6 : -1;
      board(g, '"이 종이를 오른손으로 받아 반으로 접어서 바닥에 놓으세요."', 120, { size: 17, w: 700 });
      ['① 오른손으로 받기', '② 반으로 접기', '③ 바닥에 놓기'].forEach((s, i) => {
        const x = 560 + i * 205, done = prog > i + 1 && i < n, tried = prog > i + 1 && i >= n;
        rrect(g, x, 180, 180, 220, 14, done ? '#dfeee6' : '#f6f7f5', 'rgba(26,37,41,.2)'); board(g, s, 425, { x: x + 90, al: 'center', size: 16 });
        if (done) { if (i === 0) rrect(g, x + 50, 230, 80, 110, 4, '#ffffff', '#99a'); if (i === 1) rrect(g, x + 50, 260, 80, 55, 4, '#ffffff', '#99a'); if (i === 2) { rrect(g, x + 30, 360, 120, 14, 3, '#ffffff', '#99a'); } }
        if (tried) board(g, '(하지 않음)', 300, { x: x + 90, al: 'center', size: 15, c: '#8a5a50' });
        if (i === 0 && done && c === 'aphasia') board(g, '왼손으로 받음', 370, { x: x + 90, al: 'center', size: 14, c: '#8a5a50' });
      });
    },
    auto() { return this.p.cog === 'normal' || !this.p.cog ? { say: '(종이를 받아 반으로 접고 바닥에 내려놓는다) 이렇게요?' } : {}; },
  };

  // 따라 그리기: 겹친 오각형 + 시계(11시 10분). 인지 수준에 따라 흐트러짐. 진찰하기를 누르면 한 획씩 그려짐
  const DQ = {
    normal: { jit: 0.03, wob: 0.6, off: 46, sides: 5, nums: 'even', hands: 'ok' }, mci: { jit: 0.07, wob: 1, off: 50, sides: 5, nums: 'uneven', hands: 'ok' },
    depress: { jit: 0.04, wob: 0.8, off: 46, sides: 5, nums: 'even', hands: 'ok' }, mild: { jit: 0.14, wob: 2, off: 125, sides: 5, nums: 'uneven', hands: 'wrong' },
    moderate: { jit: 0.3, wob: 3, off: 150, sides: 4, nums: 'crowd', hands: 'none' }, severe: { scribble: 1 },
    delirium: { jit: 0.3, wob: 7, off: 95, sides: 5, nums: 'few', hands: 'none' }, wernicke: { jit: 0.12, wob: 1.5, off: 60, sides: 5, nums: 'disorder', hands: 'wrong' },
    aphasia: { jit: 0.12, wob: 4, off: 52, sides: 5, nums: 'even', hands: 'ok' },
  };
  function wline(g, pts, wob, rnd) { g.beginPath(); pts.forEach((p, i) => { if (!i) { g.moveTo(p[0], p[1]); return; } const a = pts[i - 1]; for (let s = 1; s <= 6; s++) { const k = s / 6; g.lineTo(a[0] + (p[0] - a[0]) * k + (rnd() - 0.5) * wob, a[1] + (p[1] - a[1]) * k + (rnd() - 0.5) * wob); } }); g.stroke(); }
  function poly(cx, cy, r, n, rot, jit, rnd) { const o = []; for (let i = 0; i <= n; i++) { const a = rot + (i % n) / n * 6.283 - Math.PI / 2, rr = r * (1 + (rnd() - 0.5) * jit * 2); o.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } o[n] = o[0]; return o; }
  function drawParts(q, x0, y0) {
    const rnd = BE.mulberry(77), parts = [];
    if (q.scribble) { parts.push((g) => { g.beginPath(); g.moveTo(x0 + 60, y0 + 80); for (let i = 0; i < 14; i++) g.lineTo(x0 + 40 + rnd() * 120, y0 + 40 + rnd() * 90); g.stroke(); }); return parts; }
    const p1 = poly(x0 + 70, y0 + 85, 56, q.sides, 0, q.jit, rnd), p2 = poly(x0 + 70 + q.off * 0.9, y0 + 85, 56, q.sides, Math.PI / 5, q.jit, rnd);
    parts.push((g) => wline(g, p1, q.wob, BE.mulberry(1)), (g) => wline(g, p2, q.wob, BE.mulberry(2)));
    const cx = x0 + 120, cy = y0 + 300, R = 85, circ = poly(cx, cy, R, 28, 0, q.jit * 0.3, rnd);
    parts.push((g) => wline(g, circ, q.wob, BE.mulberry(3)));
    const nums = q.nums === 'few' ? [12, 3, 5, 9, 1] : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    nums.forEach((n, i) => {
      let a = (n % 12) / 12 * 6.283;
      if (q.nums === 'uneven') a += (rnd() - 0.5) * 0.35;
      if (q.nums === 'crowd') a = (i / 12) * Math.PI * 0.95;
      if (q.nums === 'disorder') a = ([12, 1, 2, 4, 3, 6, 5, 8, 7, 11, 9, 10].indexOf(n) / 12) * 6.283;
      const r = R * (q.nums === 'uneven' ? 0.72 + rnd() * 0.15 : 0.78);
      parts.push((g) => { g.font = `600 ${18 + (rnd() - 0.5) * q.jit * 20}px ${'"IBM Plex Sans KR", sans-serif'}`; g.fillStyle = '#1a2529'; g.textAlign = 'center'; g.fillText(String(n), cx + Math.sin(a) * r, cy - Math.cos(a) * r + 6); });
    });
    if (q.hands !== 'none') {
      const hA = q.hands === 'ok' ? (11 + 10 / 60) / 12 * 6.283 : 11 / 12 * 6.283, mA = q.hands === 'ok' ? 2 / 12 * 6.283 : 10 / 12 * 6.283;
      parts.push((g) => wline(g, [[cx, cy], [cx + Math.sin(hA) * 45, cy - Math.cos(hA) * 45]], q.wob, BE.mulberry(4)), (g) => wline(g, [[cx, cy], [cx + Math.sin(mA) * 68, cy - Math.cos(mA) * 68]], q.wob, BE.mulberry(5)));
    }
    return parts;
  }
  S.draw = {
    pts() { return []; }, hint: '진찰하기 = 겹친 오각형을 따라 그리고, 11시 10분 시계를 그리게 합니다',
    draw(g) {
      const c = cogFace(this, g);
      board(g, '보고 따라 그리기', 105, { size: 15, c: '#3a4a46' }); board(g, '환자가 그린 것', 105, { x: 870, size: 15, c: '#3a4a46' });
      g.strokeStyle = '#1a2529'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const f of drawParts(DQ.normal, 550, 110).slice(0, 2)) f(g);
      board(g, '"11시 10분을 가리키는 시계를 그려 보세요"', 340, { size: 15, c: '#3a4a46', x: 545 });
      g.strokeStyle = 'rgba(26,37,41,.15)'; g.beginPath(); g.moveTo(855, 90); g.lineTo(855, 520); g.stroke();
      if (!this.act) { board(g, '진찰하기를 누르면', 300, { x: 1010, al: 'center', size: 16, c: '#5a6a66' }); board(g, '환자가 그립니다', 325, { x: 1010, al: 'center', size: 16, c: '#5a6a66' }); return; }
      const parts = drawParts(DQ[c] || DQ.normal, 870, 110), n = Math.floor(this.since() / 0.45) + 1;
      g.strokeStyle = '#2a3a8a'; g.lineWidth = 3; parts.slice(0, n).forEach(f => f(g));
    },
    auto() { return this.p.cog === 'normal' || !this.p.cog ? { say: '다 그렸어요.' } : {}; },
  };
})();
