/* 보행 진찰실 3D 환자 (Three.js r147, vendor/three.min.js + GLTFLoader.js)
 * 모델: media/3d/patient_male.js (tools/build_gait3d.py, Quaternius Universal Base Characters — CC0)
 * 2D 엔진(gait-engine.js)이 계산한 관절 위치를 받아, 3D 뼈를 위에서부터 차례로 그 점을 향하게 돌림(조준) → 질환별 걸음이 그대로 따라옴
 * 좌표: 2D 엔진은 x 앞, y 위, z 환자 왼쪽(왼손 좌표) → Three.js 는 (x, y, -z)
 * 카메라: 옆 = 평행 투영(1 m = 225 px, 2D 와 같은 자리), 앞 = 원근(카메라 x 7 m·높이 1.07 m, 초점 760 px, 중심 (600, 225))
 */
(function () {
  'use strict';
  const W = 1200, H = 600, PR = 1.5;
  const V = (p, ox) => new THREE.Vector3(p[0] + (ox || 0), p[1], -p[2]);

  function Gait3D() {
    this.ready = false; this.hairMats = [];
    if (!window.THREE || !THREE.GLTFLoader || !window.GAIT3D_MODEL) return;
    const r = this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(PR); r.setSize(W, H, false); r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const sc = this.scene = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xf4f6ff, 0x9a8a78, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(3, 5, 4); sc.add(key);
    const fill = new THREE.DirectionalLight(0xfff2e6, 0.35); fill.position.set(-4, 3, -3); sc.add(fill);
    this.side = new THREE.OrthographicCamera(-70 / 225, (W - 70) / 225, 505 / 225, -(H - 505) / 225, 0.1, 50);
    this.side.position.set(0, 0, 20); this.side.lookAt(0, 0, 0);          // 환자 오른쪽(+z')에서 봄, 화면 오른쪽 = +x
    this.front = new THREE.PerspectiveCamera(2 * Math.atan(H / 2 / 760) * 180 / Math.PI, W / H, 0.1, 60);
    this.front.position.set(7, 1.07, 0); this.front.lookAt(0, 1.07, 0);
    this.front.setViewOffset(W, H, 0, 75, W, H);                           // 화면 중심 높이 300 → 225
    this.load();
  }
  const P = Gait3D.prototype;

  P.load = function () {
    const M = window.GAIT3D_MODEL, L = new THREE.GLTFLoader();
    L.parse(JSON.stringify(M.body), '', (gl) => {
      const root = this.root = new THREE.Group(), model = this.model = gl.scene;
      model.rotation.y = Math.PI / 2;                                       // 모델은 +z 를 봄 → 환자가 +x 를 보게
      root.add(model); this.scene.add(root);
      const B = this.B = {};
      model.traverse((o) => { if (o.isBone) B[o.name] = o; if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.side = THREE.FrontSide; } });
      this.rest = {}; for (const k in B) this.rest[k] = B[k].quaternion.clone();
      // 슈퍼히어로 체형 → 보통 체형 쪽으로: 어깨(쇄골) 좁게, 가슴 폭 조금 줄임
      for (const n of ['clavicle_l', 'clavicle_r']) B[n].scale.set(1, 0.86, 1);
      B.spine_03.scale.set(0.92, 1, 0.94);
      model.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'MI_Hair_1') this.hairMats.push(o.material); });
      root.updateMatrixWorld(true);
      // 모델 다리 길이(넓적다리+정강이) → 2D 엔진 길이에 맞춰 크기 조절할 때 씀
      const wp = (n) => B[n].getWorldPosition(new THREE.Vector3());
      this.legLen = wp('thigh_l').distanceTo(wp('calf_l')) + wp('calf_l').distanceTo(wp('foot_l'));
      this.ankleH = wp('foot_l').y;                                         // 서 있을 때 발목 높이(발바닥 → 발목)
      L.parse(JSON.stringify(M.hair), '', (hg) => {                         // 머리카락: 원점 0(몸과 같은 자리) → 머리뼈에 붙임
        const hair = hg.scene, head = B.Head;
        model.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(model.matrixWorld);
        hair.applyMatrix4(inv); head.add(hair);
        hair.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.material.transparent = true; o.material.alphaTest = 0.35; this.hairMats.push(o.material); } });
        this.ready = true; if (this.onReady) this.onReady();
      });
    });
  };

  // 뼈 bone 을 돌려서 '조준점'(world 함수 cw)이 목표 target(world) 쪽을 향하게
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
  function aim(bone, childWorld, target) {
    bone.updateWorldMatrix(true, false);
    const bw = bone.getWorldPosition(new THREE.Vector3());
    _a.copy(childWorld()).sub(bw).normalize(); _b.copy(target).sub(bw).normalize();
    if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) return;
    _q.setFromUnitVectors(_a, _b);
    bone.getWorldQuaternion(_wq); _wq.premultiply(_q);
    bone.parent.getWorldQuaternion(_pq).invert();
    bone.quaternion.copy(_pq.multiply(_wq));
    bone.updateMatrixWorld(true);
  }
  const wpos = (b) => () => b.getWorldPosition(new THREE.Vector3());
  // 뼈를 world 축 axis 둘레로 angle 만큼 돌림(아래팔 뒤침·손가락 굽힘)
  function turn(bone, axis, angle) {
    _q.setFromAxisAngle(axis, angle);
    bone.getWorldQuaternion(_wq); _wq.premultiply(_q);
    bone.parent.getWorldQuaternion(_pq).invert();
    bone.quaternion.copy(_pq.multiply(_wq));
    bone.updateMatrixWorld(true);
  }
  const V2 = (p) => new THREE.Vector3(p[0], p[1], -p[2]);       // 방향 벡터(2D 엔진 → Three.js)
  // 손바닥 방향(world): 손가락 방향 × 손 폭(검지→새끼), 엄지가 있는 쪽이 손바닥
  function palmOf(B, sx) {
    const w = wpos(B['hand_' + sx])(), m = wpos(B['middle_01_' + sx])(), f = m.clone().sub(w).normalize();
    const wd = wpos(B['pinky_01_' + sx])().sub(wpos(B['index_01_' + sx])()).normalize();
    const n = new THREE.Vector3().crossVectors(f, wd).normalize();
    if (wpos(B['thumb_03_' + sx])().sub(w).dot(n) < 0) n.negate();
    return { f, n };
  }

  // 가까이 보는 검사 카메라(2D 엔진 closeCam 과 같은 투영). 옆 = 비스듬한 평행 투영을 투영 행렬로 직접
  P.closeCamera = function (c) {
    if (c.kind === 'persp') {
      const cam = this.cPer || (this.cPer = new THREE.PerspectiveCamera(30, W / H, 0.05, 60));
      cam.fov = 2 * Math.atan(H / 2 / c.f) * 180 / Math.PI; cam.position.set(c.X, c.Y, 0); cam.lookAt(0, c.Y, 0);
      cam.setViewOffset(W, H, 0, H / 2 - c.cy, W, H); cam.updateProjectionMatrix();
      return cam;
    }
    // 화면 x = 600 + S(x·c − z'·s − k), 화면 y = Y0 − S(y − 0.3·s·x − 0.3·c·z'), 깊이 = −s·x − c·z' (z' = Three.js z)
    const cam = this.cObl || (this.cObl = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10));
    cam.matrixAutoUpdate = false; cam.matrixWorld.identity(); cam.matrixWorldInverse.identity();
    const a = 2 * c.S / W, b = 2 * c.S / H, D = 4;
    cam.projectionMatrix.set(
      a * c.c, 0, -a * c.s, 2 * (600 - c.S * c.k) / W - 1,
      -0.3 * b * c.s, b, -0.3 * b * c.c, 1 - 2 * c.Y0 / H,
      -c.s / D, 0, -c.c / D, 0,
      0, 0, 0, 1);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return cam;
  };

  // J: 2D 엔진 관절(골반 기준 x + pv.x). Hh: 키. 돌려줌: 그린 캔버스
  P.render = function (J, view, Hh, hairCol, close) {      // close = 앉아서 가까이 보는 검사의 카메라 값(2D 엔진 closeCam)
    if (!this.ready) return null;
    if (hairCol && hairCol !== this.hairCol) { this.hairCol = hairCol; for (const m of this.hairMats) m.color.set(hairCol).multiplyScalar(1.6); }   // 회색 머리 텍스처에 외형 머리색을 곱함
    const B = this.B, ox = J.pv.x, root = this.root;
    for (const k in B) B[k].quaternion.copy(this.rest[k]);
    const s = (J.L.th + J.L.sh) / this.legLen;                              // 2D 엔진 다리 길이에 맞춤
    root.scale.setScalar(s); root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    // 골반: 2D 엉덩관절 가운데로
    const hipC = V([0, J.pv.y, J.pv.z], ox), mid = wpos(B.thigh_l)().add(wpos(B.thigh_r)()).multiplyScalar(0.5);
    root.position.add(hipC.sub(mid)); root.updateMatrixWorld(true);
    // 몸통·목·머리
    const shC = V(J.shC, ox), neck = V(J.neckTop, ox), head = V(J.headC, ox);
    aim(B.spine_01, wpos(B.neck_01), shC.clone().add(neck.clone().sub(shC).multiplyScalar(0.3)));
    aim(B.neck_01, wpos(B.Head), neck);
    if (!this.headTop) { B.Head.updateWorldMatrix(true, false); this.headTop = B.Head.worldToLocal(wpos(B.Head)().add(new THREE.Vector3(0, 0.15, 0))); }
    aim(B.Head, () => B.Head.localToWorld(this.headTop.clone()), head.clone().add(head.clone().sub(neck).multiplyScalar(1.5)));
    // 팔
    for (const [s2, sx] of [['R', 'r'], ['L', 'l']]) {
      const a = J.arms[s2], am = J.arm && J.arm[s2];
      if (close) {
        // 앉은 검사: 모델 팔 길이로 손끝이 2D 목표(손끝 Hn)에 닿게 — 어깨→손목 2관절 IK, 팔꿈치는 2D 팔꿈치 쪽으로
        const ua = B['upperarm_' + sx], la = B['lowerarm_' + sx], hd = B['hand_' + sx];
        const S3 = wpos(ua)(), L1 = wpos(la)().distanceTo(S3), L2 = wpos(hd)().distanceTo(wpos(la)());
        const tipB = B[(am && am.nose != null ? 'index' : 'middle') + '_04_leaf_' + sx], HL = tipB ? wpos(tipB)().distanceTo(wpos(hd)()) * 0.92 : 0.18 * s;
        const Hn3 = V(a.Hn, ox), dir = Hn3.clone().sub(V(a.Wr, ox)).normalize();
        const Wr3 = Hn3.clone().sub(dir.multiplyScalar(HL));
        const toW = Wr3.clone().sub(S3), d = Math.min(toW.length(), (L1 + L2) * 0.999), u = toW.normalize();
        const ap = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - ap * ap));
        const pole = V(a.E, ox).sub(S3).projectOnPlane(u); if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0); pole.normalize();
        const El = S3.clone().add(u.clone().multiplyScalar(ap)).add(pole.multiplyScalar(hh)), Wt = S3.clone().add(u.clone().multiplyScalar(d));
        aim(ua, wpos(la), El); aim(la, wpos(hd), Wt); aim(hd, wpos(tipB || B['middle_01_' + sx]), Hn3);
      } else {
        aim(B['upperarm_' + sx], wpos(B['lowerarm_' + sx]), V(a.E, ox));
        aim(B['lowerarm_' + sx], wpos(B['hand_' + sx]), V(a.Wr, ox));
        aim(B['hand_' + sx], wpos(B['middle_01_' + sx]), V(a.Hn, ox));
      }
      // 손 뒤침(빠른 교대운동 등): 2D 엔진의 손바닥 방향(rot)에 맞게 아래팔을 제 축으로 돌림
      if (am && am.rot != null) {
        const f2 = [a.Hn[0] - a.Wr[0], a.Hn[1] - a.Wr[1], a.Hn[2] - a.Wr[2]], fl = Math.hypot(...f2), f = f2.map((v) => v / fl);
        let w0 = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];          // f × 위
        if (Math.hypot(...w0) < 0.2) w0 = [0, 0, 1];
        const wl = Math.hypot(...w0); w0 = w0.map((v) => v / wl);
        const fw = [f[1] * w0[2] - f[2] * w0[1], f[2] * w0[0] - f[0] * w0[2], f[0] * w0[1] - f[1] * w0[0]];
        const w = w0.map((v, i) => v * Math.cos(am.rot) + fw[i] * Math.sin(am.rot));
        const nt = V2([f[1] * w[2] - f[2] * w[1], f[2] * w[0] - f[0] * w[2], f[0] * w[1] - f[1] * w[0]]);   // 2D 손바닥 방향
        const ax = wpos(B['hand_' + sx])().sub(wpos(B['lowerarm_' + sx])()).normalize(), pm = palmOf(B, sx).n;   // 모델 아래팔 축(손목 자리는 그대로)
        const p1 = pm.clone().projectOnPlane(ax), p2 = nt.projectOnPlane(ax);
        if (p1.lengthSq() > 1e-6 && p2.lengthSq() > 1e-6) {
          let ang = p1.angleTo(p2); if (new THREE.Vector3().crossVectors(p1, p2).dot(ax) < 0) ang = -ang;
          turn(B['lowerarm_' + sx], ax, ang);
          aim(B['hand_' + sx], wpos(B[(close ? 'middle_04_leaf_' : 'middle_01_') + sx]), V(a.Hn, ox));
        }
      }
      // 손가락: 가리키는 손(finger to nose)은 검지만 펴고 나머지는 굽힘, 다른 손은 살짝 굽힌 채
      if (close) {
        const pt = am && am.nose != null, pm = palmOf(B, sx);
        for (const fn of ['index', 'middle', 'ring', 'pinky']) {
          const k = pt ? (fn === 'index' ? 0 : 1.35) : am && am.rot != null ? 0.1 : 0.35;   // 교대운동은 손을 거의 편 채
          for (const seg of ['01', '02', '03']) {
            const bn = B[fn + '_' + seg + '_' + sx], ch = B[fn + '_' + (seg === '03' ? '04_leaf' : '0' + (+seg + 1)) + '_' + sx]; if (!bn || !ch) continue;
            const d = wpos(ch)().sub(wpos(bn)()).normalize(), ax = new THREE.Vector3().crossVectors(d, pm.n).normalize();
            if (k) turn(bn, ax, k * (seg === '01' ? 0.9 : 0.75));
          }
        }
        if (pt) { const tb = B['thumb_02_' + sx]; if (tb) { const d = wpos(B['thumb_03_' + sx])().sub(wpos(tb)()).normalize(); turn(tb, new THREE.Vector3().crossVectors(d, pm.n).normalize(), 0.6); } }
      }
    }
    // 다리
    for (const [s2, sx] of [['R', 'r'], ['L', 'l']]) {
      const l = J.legs[s2];
      aim(B['thigh_' + sx], wpos(B['calf_' + sx]), V(l.knee, ox));
      aim(B['calf_' + sx], wpos(B['foot_' + sx]), V(l.ankle, ox));
      const an = V(l.ankle, ox), toe = V(l.toe, ox);
      aim(B['foot_' + sx], wpos(B['ball_leaf_' + sx]), B['foot_' + sx].getWorldPosition(new THREE.Vector3()).add(toe.sub(an)));
    }
    // 바닥: 모델 발바닥(발끝·뒤꿈치 근처) 최저점을 2D 엔진 발 최저점에 맞춤
    root.updateMatrixWorld(true);
    if (!close) {                                                           // 앉은 검사는 엉덩관절 높이로만 맞춤(발이 바닥에 없음)
      let lo = Infinity;
      for (const sx of ['l', 'r']) { lo = Math.min(lo, wpos(B['ball_leaf_' + sx])().y, wpos(B['foot_' + sx])().y - this.ankleH * s * 0.9); }
      root.position.y += J.floor - lo; root.updateMatrixWorld(true);
    }
    this.renderer.render(this.scene, close ? this.closeCamera(close) : view === 'side' ? this.side : this.front);
    return this.renderer.domElement;
  };

  window.Gait3D = Gait3D;
})();
