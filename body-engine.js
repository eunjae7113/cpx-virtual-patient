/* 전신 진찰 엔진 (Canvas 2D + Web Audio, 외부 라이브러리 없음) — 기본판
 * 몸 앞모습 그림 위 청진·타진·촉진 지점을 누르면 소리(심음·호흡음·장음·경동맥 잡음·타진음)를 합성해 들려주고,
 * 그 지점의 반응(아파요 등)을 돌려준다. 청진·타진이 없는 항목(시진·촉진·신경·인지)은 body-scenes.js 의 장면 그림
 * (BodyEngine.SCENES[장면] = { pts 진찰 지점, draw 그림, exam 지점 진찰, auto '진찰하기', tick 매 프레임 })이 맡는다.
 * 좌표: 환자 오른쪽(R) = 화면 왼쪽.  파라미터는 tools/body_presets.py 의 장면별 p (BASE 위에 덮어씀)
 */
(function () {
  'use strict';
  const W = 1200, H = 600, CX = 600;
  // 지점(화면 좌표): 폐 6구역(앞), 심장 5곳, 경동맥, 복부 9구역
  const LUNG = { RU: [520, 205], LU: [680, 205], RM: [505, 265], LM: [695, 265], RL: [500, 325], LL: [700, 325] };
  const HEART = { A: [572, 232, '대동맥판(흉골 오른쪽 2번째 늑간)'], P: [628, 232, '폐동맥판(흉골 왼쪽 2번째 늑간)'], E: [628, 270, 'Erb 점(흉골 왼쪽 3번째 늑간)'], T: [612, 305, '삼첨판(흉골 왼쪽 아래)'], M: [668, 318, '심첨부(승모판)'] };
  const CAROTID = { R: [578, 150], L: [622, 150] };
  const ABD = { RUQ: [535, 395, '오른쪽 위배'], Epi: [600, 385, '명치'], LUQ: [665, 395, '왼쪽 위배'], RF: [525, 445, '오른쪽 옆배'], Umb: [600, 445, '배꼽 주위'], LF: [675, 445, '왼쪽 옆배'], RLQ: [540, 500, '오른쪽 아래배'], Supra: [600, 505, '치골 위'], LLQ: [660, 500, '왼쪽 아래배'] };
  const POINTS = {
    lung: () => Object.entries(LUNG).map(([k, p]) => ({ k, x: p[0], y: p[1], n: { RU: '오른쪽 위', LU: '왼쪽 위', RM: '오른쪽 가운데', LM: '왼쪽 가운데', RL: '오른쪽 아래', LL: '왼쪽 아래' }[k] + ' 폐야' })),
    perc: () => POINTS.lung(), cpalp: () => POINTS.lung(),
    heart: () => Object.entries(HEART).map(([k, p]) => ({ k, x: p[0], y: p[1], n: p[2] })),
    carotid: () => [{ k: 'R', x: CAROTID.R[0], y: CAROTID.R[1], n: '오른쪽 경동맥' }, { k: 'L', x: CAROTID.L[0], y: CAROTID.L[1], n: '왼쪽 경동맥' }],
    bowel: () => [{ k: 'Umb', x: 600, y: 445, n: '배꼽 주위' }, { k: 'RLQ', x: 540, y: 500, n: '오른쪽 아래배' }],
    aperc: () => Object.entries(ABD).map(([k, p]) => ({ k, x: p[0], y: p[1], n: p[2] })),
    apalp: () => POINTS.aperc(), liver: () => [{ k: 'RUQ', x: 535, y: 395, n: '오른쪽 갈비뼈 아래' }], spleen: () => [{ k: 'LUQ', x: 665, y: 395, n: '왼쪽 갈비뼈 아래' }],
    pulse: () => [{ k: 'R.rad', x: 395, y: 470, n: '오른쪽 요골동맥(손목)' }, { k: 'L.rad', x: 805, y: 470, n: '왼쪽 요골동맥(손목)' }],
  };
  const SOUND_TASKS = ['lung', 'heart', 'carotid', 'bowel', 'perc', 'aperc'];

  class BodyEngine {
    constructor(cv) { this.cv = cv; this.g = cv.getContext('2d'); this.task = 'lung'; this.p = {}; this.sel = null; this.t = 0; this.said = null; this.felt = ''; this.act = null; this.raf = 0; this.ac = null; this.node = null; this.av = 'm_m'; }
    setAvatar(a) { this.av = a || 'm_m'; }
    setTask(task, p) { this.stop(); this.task = task; this.p = p || {}; this.sel = null; this.act = null; this.felt = ''; this.said = null; this.draw(); }
    scene() { return (BodyEngine.SCENES || {})[this.task]; }
    points() { const sc = this.scene(); return sc && sc.pts ? sc.pts.call(this) : (POINTS[this.task] || (() => []))(); }
    // 마지막 진찰 동작(k = 지점 키, 'act' = 진찰하기)에서 지난 초. 없으면 아주 큰 수
    since(k) { return this.act && (k == null || this.act.k === k) ? this.t - this.act.t0 : 1e9; }
    look() { return BodyEngine.look(this.av); }
    skin() {
      const s = this.look().skin;
      return this.tint ? BodyEngine.mix(s, this.tint[0], this.tint[1]) : s;
    }
    // '진찰하기' 단추: 장면 전체 동작(부르기·표정 짓기·그림 그리기 등)
    auto() { const sc = this.scene(); if (!sc || !sc.auto) return null; this.act = { k: 'act', t0: this.t }; const r = sc.auto.call(this) || {}; this.felt = r.felt || ''; this.draw(); return r; }
    // 애니메이션(숨쉬기·맥박·다리 올리기 등). 화면이 보일 때만 돌림
    start() { if (this.raf) return; let last = performance.now(); const f = (now) => { this.t += Math.min(0.1, (now - last) / 1000); last = now; this.tick(); this.draw(); this.raf = requestAnimationFrame(f); }; this.raf = requestAnimationFrame(f); }
    pause() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
    advance(s) { for (let i = 0; i < s * 30; i++) { this.t += 1 / 30; this.tick(); } this.draw(); }
    tick() { const sc = this.scene(); if (sc && sc.tick) sc.tick.call(this); }
    hit(x, y) { return this.points().find(q => Math.hypot(q.x - x, q.y - y) < 28) || null; }
    takeSay() { const s = this.said; this.said = null; return s; }
    // ---- 지점 진찰: 소리 + 반응. 돌려주는 값 = 그 지점에서 듣거나 느낀 것(눈·귀로 알 수 있는 것만, 진단 이름 없음)
    examine(q) {
      const sc = this.scene();
      if (sc && sc.exam) { this.sel = q; this.act = { k: q.k, t0: this.t }; const r = sc.exam.call(this, q) || {}; this.said = r.say || null; this.felt = r.felt || ''; this.draw(); return r; }
      this.sel = q; this.draw();
      const p = this.p, t = this.task;
      if (t === 'lung') { const z = Object.assign({ br: 1 }, (p.zones || {})[q.k]); if (!this.playClip(this.clipFor('lung', q.k, z))) this.play('lung', z); this.draw(); return null; }
      if (t === 'heart') { if (!this.playClip(this.clipFor('heart', q.k))) this.play('heart', q.k); this.draw(); return null; }
      if (t === 'carotid') { this.play('carotid', q.k); return null; }
      if (t === 'bowel') { this.play('bowel'); return null; }
      if (t === 'perc') { this.play('perc', (p.zones || {})[q.k] || 'res'); return null; }
      if (t === 'aperc') { const d = (p.dull || []).includes(q.k) || (q.k === 'Supra' && p.bladder); this.play('perc', d ? 'dull' : p.tymp_up ? 'hyper' : 'tymp'); return null; }
      return null;
    }
    // ---- Web Audio 합성(8초 반복). 학교 사이트용 녹음 파일 대신 파라미터로 만듦 — 실제 녹음과 다름(교육용 근사)
    ctx() { if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)(); if (this.ac.state === 'suspended' && !BodyEngine.muted) this.ac.resume(); else if (BodyEngine.muted && this.ac.state === 'running') this.ac.suspend(); return this.ac; }
    // 소리 끄기(머리줄 🔊 단추, 모든 진찰실 공통): 합성음은 오디오 장치를 멈추고 녹음은 음소거 — 다시 켜면 이어서 들림
    setMuted(v) { BodyEngine.muted = v; if (this.ac) { if (v) this.ac.suspend(); else this.ac.resume(); } if (this.audio) this.audio.muted = v; if (this.task) this.draw(); }
    stop() { if (this.node) { try { this.node.stop(); } catch (e) { } this.node = null; } if (this.audio) { this.audio.pause(); this.audio = null; } this.clip = null; }
    // ---- 실제 녹음(공개 청진음 HLS-CMDS, CC BY 4.0, tools/sound_lib.py). 소견에 맞는 녹음이 없으면 null → 합성음
    // 녹음이 있는 소리: 정상 심음·수축기 잡음(중기)·이완기 잡음(후기)·S3·S4·심방세동·빈맥 / 정상 호흡음·천명음·가는·굵은 수포음·흉막 마찰음
    clipFor(kind, k, z) {
      const L = (BodyEngine.CLIPS || {})[kind]; if (!L) return null;
      const p = this.p; let code, vol = 1;
      if (kind === 'heart') {
        if (p.muffle || p.rub || p.snap || p.loudP2 || p.s1var) return null;          // 녹음에 없는 특징
        const m = p.mur, hr = p.hr || 72;
        if (m) code = { sem: 'MSM', flow: 'MSM', mdm: 'LDM' }[m.t];
        else if (p.s3) code = 'S3'; else if (p.s4) code = 'S4'; else if (p.irr) code = 'AF';
        else if (hr >= 100) code = 'T'; else if (hr >= 56) code = 'N';
        if (m && m.t === 'flow') vol = 0.7;
      } else {
        if (p.stridor || z.bronch) return null;
        code = z.cr === 'fine' ? 'FC' : z.cr ? 'CC' : z.wh ? 'W' : z.rub ? 'PR' : z.rh ? 'R' : 'N';
        vol = Math.max(0.06, Math.min(1, z.br == null ? 1 : z.br));                  // 호흡음 감소 = 소리 줄임
      }
      const d = code && L[code]; if (!d) return null;
      // 그 자리 녹음이 없으면 가장 가까운 자리
      const P = kind === 'heart' ? { A: [572, 232], P: [628, 232], E: [628, 270], T: [612, 305], M: [668, 318] } : LUNG, me = P[k] || [600, 260];
      const at = Object.keys(d).sort((a, b) => Math.hypot(P[a][0] - me[0], P[a][1] - me[1]) - Math.hypot(P[b][0] - me[0], P[b][1] - me[1]))[0];
      return Object.assign({ vol }, d[at]);
    }
    playClip(c) {
      if (!c) return false;
      this.stop();
      const a = new Audio(c.src); a.loop = true; a.volume = c.vol; a.muted = !!BodyEngine.muted; a.play().catch(() => { });
      this.audio = a; this.clip = c; return true;
    }
    play(kind, arg) {
      const ac = this.ctx(); this.stop();
      const sr = ac.sampleRate, n = sr * 8, buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
      BodyEngine.synth(d, sr, kind, arg, this.p);
      const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(ac.destination); s.start(); this.node = s;
    }
    static synth(d, sr, kind, arg, p) {
      const n = d.length, rnd = mulberry(7);
      const noise = () => rnd() * 2 - 1;
      // 한 극(pole) 저역 통과 잡음
      const lp = (a) => { let y = 0; return () => (y += a * (noise() - y)); };
      const tone = (i0, len, f, amp, decay) => { for (let i = 0; i < len && i0 + i < n; i++) { const t = i / sr; d[i0 + i] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay); } };
      const burst = (i0, len, amp, a, shape) => { const f = lp(a); for (let i = 0; i < len && i0 + i < n; i++) { const k = i / len; d[i0 + i] += amp * f() * (shape ? shape(k) : Math.sin(Math.PI * k)); } };
      if (kind === 'heart' || kind === 'carotid') {
        const hr = p.hr || 72, irr = p.irr, at = arg, m = p.mur;
        let t = 0.2;
        while (t < 7.8) {
          const rr = 60 / hr * (irr ? 0.65 + rnd() * 0.7 : 1), i = Math.floor(t * sr), sys = Math.min(0.32, rr * 0.38);
          if (kind === 'heart') {
            const s1 = (p.s1 || 1) * (p.s1var ? 0.5 + rnd() : 1) * (at === 'M' || at === 'T' ? 1.2 : 0.8) * (p.muffle ? 0.35 : 1);
            const s2 = (p.s2 || 1) * (at === 'A' || at === 'P' ? 1.2 : 0.8) * (p.loudP2 && at === 'P' ? 1.6 : 1) * (p.muffle ? 0.35 : 1);
            tone(i, sr * 0.1, 48, 0.55 * s1, 30); burst(i, sr * 0.08, 0.25 * s1, 0.08);
            const i2 = i + Math.floor(sys * sr);
            tone(i2, sr * 0.08, 70, 0.45 * s2, 38); burst(i2, sr * 0.06, 0.2 * s2, 0.12);
            if (p.snap && at === 'M') tone(i2 + sr * 0.08, sr * 0.04, 110, 0.3, 60);
            if (p.s3) tone(i2 + Math.floor(0.15 * sr), sr * 0.07, 32, 0.35 * (at === 'M' ? 1 : 0.5), 30);
            if (p.s4) tone(i - Math.floor(0.1 * sr), sr * 0.06, 36, 0.3 * (at === 'M' ? 1 : 0.5), 34);
            if (m) {
              const near = { A: { A: 1, P: 0.6, E: 0.6, T: 0.4, M: 0.5 }, P: { P: 1, A: 0.6, E: 0.7, T: 0.4, M: 0.3 }, E: { E: 1, A: 0.6, P: 0.6, T: 0.7, M: 0.6 }, T: { T: 1, E: 0.7, M: 0.5, P: 0.4, A: 0.3 }, M: { M: 1, T: 0.5, E: 0.5, A: 0.3, P: 0.3 } }[m.at][at] || 0.3;
              const amp = 0.06 * m.g * near;
              if (m.t === 'sem' || m.t === 'flow') burst(i + sr * 0.07, sr * (sys - 0.1), amp * (m.t === 'flow' ? 0.6 : 1), 0.5, (k) => Math.sin(Math.PI * k));
              if (m.t === 'psm') burst(i + sr * 0.03, sr * (sys - 0.03), amp, 0.55, () => 0.9);
              if (m.t === 'edm') burst(i2 + sr * 0.05, sr * Math.min(0.35, rr - sys - 0.15), amp * 0.8, 0.75, (k) => 1 - k);
              if (m.t === 'mdm') burst(i2 + sr * 0.14, sr * Math.min(0.3, rr - sys - 0.2), amp * 1.4, 0.04, (k) => 0.6 + 0.4 * k);
            }
            if (p.rub) burst(i + sr * 0.04, sr * 0.12, 0.12, 0.6), burst(i2 + sr * 0.05, sr * 0.1, 0.1, 0.6);
          } else {
            // 경동맥: 맥박 쿵 + 잡음(협착·전달 잡음)
            tone(i, sr * 0.08, 40, 0.35, 30);
            const b = (p[at] || 0) + (p.rad ? 0.6 : 0) + (p.thy ? 0.3 : 0);
            if (b) burst(i + sr * 0.04, sr * sys, 0.09 * b, 0.45);
          }
          t += rr;
        }
      } else if (kind === 'lung') {
        const z = arg, rr = p.rr || 14, cyc = 60 / rr, insp = cyc * (p.prolong ? 0.3 : 0.4);
        for (let t = 0.1; t < 7.9; t += cyc) {
          const i = Math.floor(t * sr), li = Math.floor(insp * sr), le = Math.floor((cyc - insp) * sr * 0.8);
          const br = z.br == null ? 1 : z.br, bro = z.bronch;
          burst(i, li, 0.16 * br * (bro ? 1.4 : 1), bro ? 0.3 : 0.07, (k) => Math.sin(Math.PI * Math.min(1, k * 1.2)));
          burst(i + li, le, (bro ? 0.18 : 0.05) * br, bro ? 0.3 : 0.05, (k) => 1 - k);
          if (z.wh) { const f = 380 + rnd() * 250; for (let j = 0; j < le * 0.85; j++) { const k = j / le; d[i + li + j] += 0.07 * z.wh * Math.sin(2 * Math.PI * (f + 15 * Math.sin(j / sr * 30)) * j / sr) * Math.sin(Math.PI * k / 0.85); } }
          if (z.cr) {
            const fine = z.cr === 'fine', cnt = fine ? 10 : 7;
            for (let c = 0; c < cnt; c++) { const k = fine ? 0.5 + rnd() * 0.5 : rnd() * 0.6; tone(i + Math.floor(k * li), sr * 0.012, fine ? 700 : 260, fine ? 0.25 : 0.32, fine ? 400 : 180); }
          }
          if (z.rub) burst(i + li * 0.8, sr * 0.25, 0.1, 0.6);
          if (p.stridor) { for (let j = 0; j < li; j++) d[i + j] += 0.09 * Math.sin(2 * Math.PI * 900 * j / sr) * Math.sin(Math.PI * j / li); }
        }
      } else if (kind === 'bowel') {
        const bs = p.bs || 'normal', rate = { normal: 1.2, hyper: 4, hypo: 0.25, absent: 0, tinkling: 1.5 }[bs];
        for (let t = 0.2; t < 7.6; t += 1 / Math.max(rate, 0.01) * (0.5 + rnd())) {
          if (!rate) break;
          const i = Math.floor(t * sr);
          if (bs === 'tinkling') { tone(i, sr * 0.15, 1200 + rnd() * 600, 0.2, 25); tone(i + sr * 0.1, sr * 0.12, 1500 + rnd() * 400, 0.14, 30); }
          else { const len = sr * (0.15 + rnd() * 0.5); for (let j = 0; j < len && i + j < n; j++) { const k = j / len; d[i + j] += 0.12 * Math.sin(2 * Math.PI * (150 + 120 * Math.sin(j / sr * 14)) * j / sr) * Math.sin(Math.PI * k) * (0.5 + 0.5 * noise()); } }
        }
        if (p.bruit) for (let t = 0.3; t < 7.8; t += 60 / (p.hr || 72)) burst(Math.floor(t * sr), sr * 0.25, 0.06, 0.4);
      } else if (kind === 'perc') {
        const k = arg, P = { res: [110, 9, 0.6], hyper: [85, 5, 0.7], tymp: [260, 7, 0.55], dull: [210, 35, 0.4], flat: [260, 90, 0.25] }[k] || [110, 9, 0.6];
        for (const t0 of [0.3, 0.75, 2.3, 2.75, 4.3, 4.75, 6.3, 6.75]) { const i = Math.floor(t0 * sr); tone(i, sr * 0.5, P[0], P[2], P[1]); burst(i, sr * 0.02, 0.4, 0.5); }
      }
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i]));
      if (mx > 0.95) for (let i = 0; i < n; i++) d[i] *= 0.95 / mx;
    }
    // 지금 소리를 WAV 파일로(자료로 저장·학교 사이트에 붙일 때)
    wav(kind, arg) {
      const sr = 22050, d = new Float32Array(sr * 8); BodyEngine.synth(d, sr, kind, arg, this.p);
      const b = new DataView(new ArrayBuffer(44 + d.length * 2)), s = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
      s(0, 'RIFF'); b.setUint32(4, 36 + d.length * 2, true); s(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
      b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); s(36, 'data'); b.setUint32(40, d.length * 2, true);
      for (let i = 0; i < d.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
      return new Blob([b], { type: 'audio/wav' });
    }
    soundOf(q) {
      const t = this.task, p = this.p;
      if (t === 'lung') return ['lung', Object.assign({ br: 1 }, (p.zones || {})[q.k])];
      if (t === 'heart' || t === 'carotid') return [t, q.k];
      if (t === 'bowel') return ['bowel'];
      if (t === 'perc') return ['perc', (p.zones || {})[q.k] || 'res'];
      if (t === 'aperc') return ['perc', (p.dull || []).includes(q.k) ? 'dull' : p.tymp_up ? 'hyper' : 'tymp'];
      return null;
    }
    // ---- 그림
    draw() {
      const g = this.g; g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#10171a'; g.fillRect(0, 0, W, H);
      const sc = this.scene();
      if (sc && sc.draw) { g.save(); sc.draw.call(this, g); g.restore(); } else { g.fillStyle = '#18242a'; g.fillRect(0, 470, W, 130); this.body(g); }
      const pts = this.points();
      for (const q of (sc && sc.noDots ? [] : pts)) {
        const on = this.sel && this.sel.k === q.k;
        g.beginPath(); g.arc(q.x, q.y, on ? 17 : 12, 0, 7);
        g.fillStyle = on ? 'rgba(232,215,166,.9)' : 'rgba(120,200,190,.35)'; g.fill();
        g.lineWidth = 2; g.strokeStyle = on ? '#fff' : 'rgba(150,230,220,.8)'; g.stroke();
      }
      if (this.sel && SOUND_TASKS.includes(this.task)) this.stetho(g, this.sel);
      g.fillStyle = '#cfe0dc'; g.font = '600 20px "IBM Plex Sans KR", sans-serif'; g.textAlign = 'left';
      g.fillText(this.sel ? this.sel.n : sc && sc.hint ? sc.hint : (pts.length ? '동그라미를 눌러 진찰하세요' : ''), 28, 44);
      if (this.sel && SOUND_TASKS.includes(this.task)) { g.font = '14px "IBM Plex Sans KR", sans-serif'; g.fillStyle = '#93a8a3'; g.fillText(BodyEngine.muted ? '소리 꺼짐 — 위쪽 🔇 단추로 켜기' : '소리가 반복 재생됩니다 · ■ 멈춤', 28, 68); g.fillText(this.clip ? '실제 녹음(마네킹) · HLS-CMDS, CC BY 4.0' : '합성음(교육용 근사)', 28, 88); }
      if (this.felt) this.feltBox(g, this.felt);
    }
    // 손끝·눈으로 확인한 것(진단 이름 없이 느낀 것만)을 화면 아래에
    feltBox(g, s) {
      g.font = '16px "IBM Plex Sans KR", sans-serif'; g.textAlign = 'left';
      const lines = [], maxW = W - 90; let cur = '';
      for (const ch of s) { if (g.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch; }
      lines.push(cur);
      const h = 18 + lines.length * 24, y = H - h - 12;
      g.fillStyle = 'rgba(8,14,16,.82)'; g.beginPath(); g.roundRect ? g.roundRect(20, y, W - 40, h, 10) : g.rect(20, y, W - 40, h); g.fill();
      g.fillStyle = '#e8d7a6'; lines.forEach((l, i) => g.fillText(l, 40, y + 28 + i * 24));
    }
    // 앞모습 몸통(청진·타진·복부 그림 공통). 외형(성별·나이)에 따라 어깨·허리 폭, 머리 크기, 가슴 모양이 바뀜. 진찰 지점 좌표는 그대로
    body(g) {
      const skin = this.skin(), L = this.look(), f = L.sex === 'f', kid = L.age === 'c' || L.age === 'nb';
      const sh = kid ? 126 : f ? 136 : L.age === 't' ? 140 : 150, wa = f ? 114 : kid ? 122 : 130, hip = f ? 142 : kid ? 122 : 135, hr = kid ? 1.15 : 1;
      g.save(); g.fillStyle = skin; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
      if (BodyEngine.draw) { g.restore(); BodyEngine.draw.face(this, g, CX, 80 - (hr - 1) * 40, 62 * hr, { hair: true }); g.save(); g.fillStyle = skin; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; }
      else { g.beginPath(); g.ellipse(CX, 80, 52, 62, 0, 0, 7); g.fill(); g.stroke(); }
      g.fillRect(CX - (f || kid ? 22 : 26), 128, f || kid ? 44 : 52, 42);
      // 몸통: 어깨 → 허리 → 엉덩이
      g.beginPath(); g.moveTo(CX - sh, 180); g.quadraticCurveTo(CX, 150, CX + sh, 180); g.lineTo(CX + sh - (f || kid ? 8 : 20), 330); g.quadraticCurveTo(CX + wa - 8, 400, CX + (kid ? wa + 10 : wa), 430); g.quadraticCurveTo(CX + hip, 480, CX + hip, 540);
      g.lineTo(CX - hip, 540); g.quadraticCurveTo(CX - hip, 480, CX - (kid ? wa + 10 : wa), 430); g.quadraticCurveTo(CX - wa + 8, 400, CX - sh + (f || kid ? 8 : 20), 330); g.closePath(); g.fill(); g.stroke();
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(CX + s * sh, 182); g.quadraticCurveTo(CX + s * (sh + 55), 300, CX + s * (sh + 52), 470); g.lineTo(CX + s * (sh + 22), 475); g.quadraticCurveTo(CX + s * (sh + 15), 320, CX + s * (sh - 22), 250); g.closePath(); g.fill(); g.stroke(); }
      // 갈비뼈 선·배꼽(희미하게, 위치 기준). 마른 노인은 갈비뼈가 조금 더 보임
      g.strokeStyle = 'rgba(80,40,20,.18)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(CX, 175); g.lineTo(CX, 345); g.stroke();
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(CX + s * 12, 345); g.quadraticCurveTo(CX + s * 80, 380, CX + s * 118, 360); g.stroke(); }
      if (L.age === 'e') { g.strokeStyle = 'rgba(80,40,20,.12)'; for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(CX + s * 20, 215 + i * 30); g.quadraticCurveTo(CX + s * 70, 225 + i * 30, CX + s * (sh - 30), 250 + i * 28); g.stroke(); } }
      g.fillStyle = 'rgba(120,60,40,.35)'; g.beginPath(); g.arc(CX, 450, 5, 0, 7); g.fill();
      if (f && !kid && L.age !== 't') {
        // 여성: 유방 윤곽(그늘 선만, 교육용 도식)
        for (const s of [-1, 1]) {
          const gr = g.createRadialGradient(CX + s * 68, 268, 10, CX + s * 68, 268, 62); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.beginPath(); g.ellipse(CX + s * 68, 262, 62, 56, 0, 0, 7); g.fill();
          g.strokeStyle = 'rgba(90,45,30,.28)'; g.lineWidth = 2; g.beginPath(); g.arc(CX + s * 68, 258, 58, Math.PI * (s < 0 ? 0.15 : 0.15), Math.PI * 0.9); g.stroke();
        }
      } else if (f && L.age === 't') {
        for (const s of [-1, 1]) { g.strokeStyle = 'rgba(90,45,30,.2)'; g.lineWidth = 2; g.beginPath(); g.arc(CX + s * 66, 255, 36, Math.PI * 0.2, Math.PI * 0.85); g.stroke(); }
      } else {
        g.fillStyle = 'rgba(120,60,40,.35)'; for (const s of [-1, 1]) { g.beginPath(); g.arc(CX + s * (kid ? 58 : 70), 255, kid ? 4 : 5, 0, 7); g.fill(); }
        if (!kid && L.age !== 't') { g.strokeStyle = 'rgba(80,40,20,.12)'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(CX + s * 18, 212); g.quadraticCurveTo(CX + s * 80, 205, CX + s * (sh - 25), 225); g.stroke(); } }
      }
      if (kid) { const gr = g.createRadialGradient(CX - 20, 430, 10, CX, 445, 120); gr.addColorStop(0, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(CX, 445, 120, 90, 0, 0, 7); g.fill(); }
      // 환자복 반바지
      g.fillStyle = '#5f7f9a'; g.fillRect(CX - hip - 1, 520, 2 * hip + 2, 80);
      g.restore();
      g.fillStyle = '#7f918d'; g.font = '13px "IBM Plex Sans KR", sans-serif'; g.textAlign = 'center';
      g.fillText('환자 오른쪽', CX - 250, 590); g.fillText('환자 왼쪽', CX + 250, 590);
    }
    stetho(g, q) {
      g.save(); g.strokeStyle = '#2b2f33'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(q.x, q.y); g.bezierCurveTo(q.x + 140, q.y - 40, 980, 120, 1060, 70); g.stroke();
      g.fillStyle = '#c9ced3'; g.beginPath(); g.arc(q.x, q.y, 20, 0, 7); g.fill(); g.strokeStyle = '#7d858c'; g.lineWidth = 3; g.stroke();
      g.restore();
    }
    snap() { return this.cv.toDataURL('image/jpeg', 0.9); }
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // 외형 id(c 소아 t 청소년 y 20~30대 m 40~50대 s 60대 e 80대 × _m/_f, nb 신생아) → 그림에 쓰는 성별·나이·피부·머리색
  // 주의: 첫 글자는 나이(m = 40~50대)이고 성별은 끝 글자
  BodyEngine.look = (av) => {
    av = av || 'm_m';
    const sex = /_f$/.test(av) ? 'f' : 'm', age = av === 'nb' ? 'nb' : av[0];
    const skin = { c: '#e4b896', nb: '#efc4a8', t: '#dcac87', y: '#e0b08b', m: '#d9a882', s: '#d2a280', e: '#cf9f7d' }[age] || '#d9a882';
    return { sex, age, skin: sex === 'f' ? BodyEngine.mix(skin, '#f0c8a8', 0.25) : skin, hair: age === 'e' ? '#d8d4cc' : age === 's' ? '#8a8580' : '#2b221d', long: sex === 'f' && age !== 'nb', male: sex === 'm' };
  };
  BodyEngine.SOUND_TASKS = SOUND_TASKS;
  BodyEngine.W = W; BodyEngine.H = H; BodyEngine.CX = CX; BodyEngine.ABD = ABD; BodyEngine.LUNG = LUNG; BodyEngine.mulberry = mulberry;
  BodyEngine.mix = (a, b, t) => { const h = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); const A = h(a), B = h(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  BodyEngine.SCENES = BodyEngine.SCENES || {};
  window.BodyEngine = BodyEngine;
})();
