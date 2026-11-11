// 3D 배경: 달밤의 카멜롯 성 (three.js)
import * as THREE from '/vendor/three/three.module.js';

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

// 돌벽 텍스처
function stoneTexture() {
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#5b5a66'; g.fillRect(0, 0, w, h);
    const rows = 8; const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 24;
      for (let x = -off; x < w; x += 48) {
        const shade = 70 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${shade},${shade - 2},${shade + 8})`;
        g.fillRect(x + 2, r * rh + 2, 44, rh - 4);
        for (let i = 0; i < 20; i++) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
          g.fillRect(x + 2 + Math.random() * 44, r * rh + 2 + Math.random() * (rh - 4), 2, 2);
        }
      }
    }
    g.strokeStyle = 'rgba(20,18,26,.9)'; g.lineWidth = 3;
    for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(0, r * rh); g.lineTo(w, r * rh); g.stroke(); }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture() {
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#1b2a22'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5 ? `rgba(60,90,60,${Math.random() * 0.35})` : `rgba(0,0,0,${Math.random() * 0.35})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(inner, outer) {
  const c = makeCanvas(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.35, outer);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTexture() {
  const c = makeCanvas(256, 128, (g) => {
    for (let i = 0; i < 26; i++) {
      const x = 30 + Math.random() * 196; const y = 40 + Math.random() * 50; const r = 18 + Math.random() * 30;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(170,175,210,.35)');
      grd.addColorStop(1, 'rgba(170,175,210,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function init() {
  const canvas = document.getElementById('bg3d');
  if (!canvas) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    return; // WebGL 미지원 → CSS 배경 유지
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  document.body.classList.add('has-3d');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d1024, 0.0115);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

  // 하늘
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x05071a) },
      mid: { value: new THREE.Color(0x1a1840) },
      horizon: { value: new THREE.Color(0x4a2f5c) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP; void main(){ float h = vP.y; vec3 c = mix(horizon, mid, smoothstep(-0.05, 0.25, h)); c = mix(c, top, smoothstep(0.25, 0.9, h)); gl_FragColor = vec4(c,1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // 별
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 1600; i++) {
    const th = Math.random() * Math.PI * 2; const ph = Math.random() * Math.PI * 0.45;
    const r = 380;
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 10, r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
  scene.add(stars);

  // 달
  const moonPos = new THREE.Vector3(-60, 95, -260);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
  moon.position.copy(moonPos);
  scene.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,200,.9)', 'rgba(255,230,180,.18)'), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moonGlow.scale.set(120, 120, 1);
  moonGlow.position.copy(moonPos);
  scene.add(moonGlow);

  // 구름
  const clouds = [];
  const cTex = cloudTexture();
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex, fog: false, depthWrite: false, transparent: true, opacity: 0.28 }));
    m.scale.set(160 + Math.random() * 80, 60 + Math.random() * 20, 1);
    m.position.set(-250 + Math.random() * 500, 60 + Math.random() * 60, -240 - Math.random() * 60);
    m.userData.speed = 1 + Math.random() * 2;
    clouds.push(m); scene.add(m);
  }

  // 조명
  scene.add(new THREE.HemisphereLight(0x9aa2e0, 0x161a26, 1.1));
  const moonLight = new THREE.DirectionalLight(0xc8d6ff, 2.2);
  moonLight.position.set(-40, 80, 60);
  const rim = new THREE.DirectionalLight(0x9a7cff, 1.2);
  rim.position.set(60, 40, -160);
  scene.add(rim);
  scene.add(moonLight);

  // 땅과 언덕
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x1d2b26, roughness: 1, flatShading: true });
  const hill = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
  hill.scale.set(1.2, 0.22, 1);
  hill.position.set(0, -1, -70);
  scene.add(hill);

  // 먼 산맥
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x1a1d38, roughness: 1, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const h = 20 + Math.random() * 35;
    const m = new THREE.Mesh(new THREE.ConeGeometry(30 + Math.random() * 30, h, 5 + Math.floor(Math.random() * 3)), mountMat);
    const a = -Math.PI * 0.95 + (i / 21) * Math.PI * 0.9;
    m.position.set(Math.cos(a) * 300, h / 2 - 2, Math.sin(a) * 250 - 90);
    m.rotation.y = Math.random() * Math.PI;
    scene.add(m);
  }

  // 성
  const castle = new THREE.Group();
  castle.position.set(0, 11, -72);
  scene.add(castle);
  const stone = stoneTexture();
  const stoneMat = (rx, ry) => {
    const t = stone.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: 0xd2cee0 });
  };
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a1f3a, roughness: 0.7, flatShading: true });
  const merlonGeo = new THREE.BoxGeometry(1.4, 1.6, 1.4);
  const merlonMat = stoneMat(0.3, 0.3);
  const merlons = [];

  function crenellate(x1, z1, x2, z2, y) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.floor(len / 2.6);
    for (let i = 0; i <= count; i++) {
      const t = i / Math.max(1, count);
      merlons.push(new THREE.Vector3(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t));
    }
  }
  function wall(x, z, w, d, h) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat(w / 8, h / 8));
    m.position.set(x, h / 2, z);
    castle.add(m);
    const y = h + 0.8;
    if (w > d) { crenellate(x - w / 2, z + d / 2, x + w / 2, z + d / 2, y); crenellate(x - w / 2, z - d / 2, x + w / 2, z - d / 2, y); }
    else { crenellate(x + w / 2, z - d / 2, x + w / 2, z + d / 2, y); crenellate(x - w / 2, z - d / 2, x - w / 2, z + d / 2, y); }
  }
  function tower(x, z, r, h, roofH) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 20), stoneMat(r * 0.8, h / 8));
    body.position.set(x, h / 2, z);
    castle.add(body);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 1.4, 20), stoneMat(r, 0.3));
    ring.position.set(x, h + 0.7, z);
    castle.add(ring);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, roofH, 20), roofMat);
    roof.position.set(x, h + 1.4 + roofH / 2, z);
    castle.add(roof);
    return h + 1.4 + roofH;
  }

  // 성벽과 탑
  wall(0, 14, 40, 3, 10);     // 앞
  wall(0, -14, 40, 3, 10);    // 뒤
  wall(-20, 0, 3, 28, 10);    // 왼쪽
  wall(20, 0, 3, 28, 10);     // 오른쪽
  const tops = [];
  for (const [x, z] of [[-20, 14], [20, 14], [-20, -14], [20, -14]]) tops.push([x, tower(x, z, 3.6, 16, 9), z]);
  tops.push([-6, tower(-6, 14, 2.6, 14, 6), 14]);
  tops.push([6, tower(6, 14, 2.6, 14, 6), 14]);
  // 본성(킵)
  const keep = new THREE.Mesh(new THREE.BoxGeometry(16, 22, 12), stoneMat(2, 2.8));
  keep.position.set(0, 11, -2);
  castle.add(keep);
  crenellate(-8, 4, 8, 4, 22.8); crenellate(-8, -8, 8, -8, 22.8);
  tops.push([-7, tower(-7, -2, 2.8, 30, 10) , -2]);
  tops.push([7, tower(7, -2, 2.8, 30, 10), -2]);
  tops.push([0, tower(0, -6, 3.4, 36, 13), -6]);

  const merlonMesh = new THREE.InstancedMesh(merlonGeo, merlonMat, merlons.length);
  const mtx = new THREE.Matrix4();
  merlons.forEach((p, i) => { mtx.makeTranslation(p.x, p.y, p.z); merlonMesh.setMatrixAt(i, mtx); });
  castle.add(merlonMesh);

  // 성문
  const gate = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 1), new THREE.MeshStandardMaterial({ color: 0x24160c, roughness: 0.8 }));
  gate.position.set(0, 3.5, 15.6);
  castle.add(gate);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.1, 20, 1, false, 0, Math.PI), gate.material);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
  arch.position.set(0, 7, 15.6);
  castle.add(arch);

  // 창문 불빛
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const windows = [];
  const winGeo = new THREE.PlaneGeometry(0.9, 1.8);
  const addWin = (x, y, z, ry = 0) => {
    const w = new THREE.Mesh(winGeo, winMat.clone());
    w.position.set(x, y, z); w.rotation.y = ry;
    w.userData.phase = Math.random() * 10;
    castle.add(w); windows.push(w);
  };
  for (const y of [8, 13, 18]) for (const x of [-5, -1.5, 1.5, 5]) if (Math.random() > 0.25) addWin(x, y, 4.05);
  for (const [x, , z] of tops.slice(0, 6)) addWin(x, 10, z + 3.7);
  addWin(0, 30, -2.5);
  addWin(-7, 24, 0.85); addWin(7, 24, 0.85);

  // 깃발
  const banners = [];
  const bannerGeo = new THREE.PlaneGeometry(4, 2.4, 12, 4);
  for (const [i, [x, top, z]] of tops.slice(-3).entries()) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), new THREE.MeshStandardMaterial({ color: 0x777777 }));
    pole.position.set(x, top + 3, z);
    castle.add(pole);
    const geo = bannerGeo.clone();
    geo.translate(2, 0, 0);
    const b = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: i === 1 ? 0x9c1c2b : 0x1f3f8f, side: THREE.DoubleSide, roughness: 0.8, emissive: i === 1 ? 0x2a0508 : 0x050b22 }));
    b.position.set(x, top + 4.8, z);
    b.userData.base = geo.attributes.position.array.slice();
    b.userData.phase = i * 1.7;
    castle.add(b); banners.push(b);
  }

  // 횃불 + 불씨
  const torches = [];
  const flameTex = glowTexture('rgba(255,230,160,1)', 'rgba(255,120,30,.5)');
  for (const x of [-4.2, 4.2]) {
    const light = new THREE.PointLight(0xff8a2a, 30, 30, 1.6);
    light.position.set(x, 7.5, 17.5);
    castle.add(light);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.set(x, 7.6, 16.8); flame.scale.set(2.2, 3, 1);
    castle.add(flame);
    torches.push({ light, flame, phase: Math.random() * 10 });
  }
  const EMBERS = 120;
  const emberGeo = new THREE.BufferGeometry();
  const ember = new Float32Array(EMBERS * 3);
  const emberLife = new Float32Array(EMBERS);
  const resetEmber = (i) => {
    const side = Math.random() < 0.5 ? -4.2 : 4.2;
    ember[i * 3] = side + (Math.random() - 0.5) * 0.6;
    ember[i * 3 + 1] = 7.6;
    ember[i * 3 + 2] = 16.8 + (Math.random() - 0.5) * 0.6;
    emberLife[i] = Math.random();
  };
  for (let i = 0; i < EMBERS; i++) { resetEmber(i); ember[i * 3 + 1] += Math.random() * 8; }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ember, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.25, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  castle.add(embers);

  // 반딧불(떠다니는 빛)
  const FLIES = 70;
  const flyGeo = new THREE.BufferGeometry();
  const fly = new Float32Array(FLIES * 3);
  const flySeed = [];
  for (let i = 0; i < FLIES; i++) {
    fly[i * 3] = (Math.random() - 0.5) * 120; fly[i * 3 + 1] = 1 + Math.random() * 10; fly[i * 3 + 2] = -30 + Math.random() * 60;
    flySeed.push(Math.random() * 100);
  }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(fly, 3));
  const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xc6ff9a, size: 0.35, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(flies);

  // 카메라 경로: 첫 화면은 성 정면, 게임 중에는 조금 더 가까이·낮게
  const modes = {
    home: { pos: new THREE.Vector3(-10, 16, 40), look: new THREE.Vector3(-42, 30, -70), orbit: 0.18 },
    lobby: { pos: new THREE.Vector3(30, 12, 26), look: new THREE.Vector3(-30, 32, -70), orbit: 0.1 },
    game: { pos: new THREE.Vector3(10, 10, 14), look: new THREE.Vector3(-8, 30, -72), orbit: 0.06 },
  };
  let mode = 'home';
  const camPos = modes.home.pos.clone();
  const camLook = modes.home.look.clone();
  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  function resize() {
    const w = window.innerWidth; const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  let last = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const now = performance.now();
    const minGap = mode === 'game' ? 1000 / 30 : 1000 / 50; // 게임 중에는 배터리 아끼기
    if (now - last < minGap) return;
    last = now;
    const t = clock.getElapsedTime();
    const m = modes[mode];

    // 카메라: 목표로 부드럽게 이동 + 천천히 공전 + 마우스 시차
    const ang = reduceMotion ? 0 : Math.sin(t * 0.05) * m.orbit;
    const target = m.pos.clone().sub(m.look).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).add(m.look);
    target.x += mouse.x * 2.5; target.y += -mouse.y * 1.2;
    camPos.lerp(target, 0.02);
    camLook.lerp(m.look, 0.02);
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    if (!reduceMotion) {
      for (const c of clouds) { c.position.x += c.userData.speed * 0.03; if (c.position.x > 300) c.position.x = -300; }
      for (const tch of torches) {
        const f = 0.8 + Math.sin(t * 9 + tch.phase) * 0.12 + Math.sin(t * 23 + tch.phase) * 0.08;
        tch.light.intensity = 30 * f;
        tch.flame.scale.set(2.2 * f, 3 * (0.9 + f * 0.15), 1);
      }
      for (const w of windows) w.material.color.setHSL(0.09, 1, 0.5 + Math.sin(t * 2 + w.userData.phase) * 0.06 + Math.sin(t * 7.3 + w.userData.phase) * 0.03);
      for (const b of banners) {
        const pos = b.geometry.attributes.position;
        const base = b.userData.base;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          pos.array[i * 3 + 2] = Math.sin(x * 1.3 - t * 3 + b.userData.phase) * 0.35 * (x / 4);
        }
        pos.needsUpdate = true;
      }
      for (let i = 0; i < EMBERS; i++) {
        ember[i * 3 + 1] += 0.05 + emberLife[i] * 0.05;
        ember[i * 3] += Math.sin(t * 2 + i) * 0.01;
        if (ember[i * 3 + 1] > 16 + emberLife[i] * 6) resetEmber(i);
      }
      emberGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < FLIES; i++) {
        const s = flySeed[i];
        fly[i * 3] += Math.sin(t * 0.4 + s) * 0.02;
        fly[i * 3 + 1] += Math.cos(t * 0.7 + s) * 0.01;
      }
      flyGeo.attributes.position.needsUpdate = true;
      flies.material.opacity = 0.55 + Math.sin(t * 1.5) * 0.25;
      stars.material.opacity = 0.75 + Math.sin(t * 0.8) * 0.15;
    }
    renderer.render(scene, camera);
  }
  frame();

  window.AvalonBG = {
    setMode(next) { if (modes[next]) mode = next; },
  };
  document.dispatchEvent(new CustomEvent('avalon-bg-ready'));
}

try { init(); } catch (err) { console.warn('3D 배경을 불러오지 못했습니다:', err); }
