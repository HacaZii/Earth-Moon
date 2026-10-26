(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const elTime = document.getElementById('t-time');
  const elSpeed = document.getElementById('t-speed');
  const elDist = document.getElementById('t-dist');
  const elDv = document.getElementById('t-dv');
  const elStatus = document.getElementById('status');

  const powerInput = document.getElementById('power');
  const angleInput = document.getElementById('angle');
  const vPower = document.getElementById('v-power');
  const vAngle = document.getElementById('v-angle');

  const burnPowerInput = document.getElementById('burn-power');
  const burnDirInput = document.getElementById('burn-dir');
  const vBurnPower = document.getElementById('v-burn-power');
  const vBurnDir = document.getElementById('v-burn-dir');
  const btnBurn = document.getElementById('burn');
  const dvBudgetHint = document.getElementById('dv-budget-hint');

  const btnLaunch = document.getElementById('launch');
  const btnReset = document.getElementById('reset');

  const hudEl = document.getElementById('hud');
  const controlsEl = document.getElementById('controls');
  const btnToggleHud = document.getElementById('toggle-hud');
  const btnToggleUi = document.getElementById('toggle-ui');
  const btnShowUi = document.getElementById('show-ui');

  const btnZoomIn = document.getElementById('zoom-in');
  const btnZoomOut = document.getElementById('zoom-out');
  const btnZoomReset = document.getElementById('zoom-reset');

  const resultEl = document.getElementById('result');
  const resultCard = resultEl.querySelector('.result-card');
  const rTitle = document.getElementById('result-title');
  const rSubtitle = document.getElementById('result-subtitle');
  const rTime = document.getElementById('r-time');
  const rDist = document.getElementById('r-dist');
  const rDv = document.getElementById('r-dv');
  const rBestTime = document.getElementById('r-best-time');
  const rBestDv = document.getElementById('r-best-dv');
  const rNewRecord = document.getElementById('result-new-record');
  const btnAgain = document.getElementById('again');
  const btnResetRecords = document.getElementById('reset-records');

  // ---------- Мир ----------
  const WORLD = {
    earth: { x: 0, y: 0, r: 6, mass: 400 },
    moon:  { x: 100, y: 0, r: 2.5, mass: 25 },
    moonZoneR: 6,
    startAlt: 12,
  };

  const DT = 0.004;
  const MAX_STEPS_PER_FRAME = 400;
  const TIME_SCALE = 3;
  const DIST_UNIT_LABEL = 'у.е.';
  const DIST_UNIT_MULT = 1;
  const DV_BUDGET = 2.0;
  const MAP_BOUND = 400;

  // ---------- Состояние ----------
  const state = {
    mode: 'ready',
    time: 0,
    dv: 0,
    distance: 0,
    ship: { x: 0, y: 0, vx: 0, vy: 0 },
    prev: { x: 0, y: 0 },
    trail: [],
    trailMaxLen: 4000,
    acc: 0,
    lastTs: 0,
    failReason: '',
    lastLaunch: { power: 7, angle: 0 },
    particles: [],
  };

  // ---------- Вид ----------
  const view = {
    scale: 1,
    zoom: 1,          // пользовательский zoom (1 = базовый масштаб)
    cx: 0,
    cy: 0,
    dpr: 1,
    worldMidX: 50,
    worldMidY: 0,
  };

  // ---------- Рекорды ----------
  const RECORDS_KEY = 'earth-moon-records-v1';
  const UI_KEY = 'earth-moon-ui-v1';

  function loadRecords() {
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      if (!raw) return { bestTime: null, bestDv: null };
      const obj = JSON.parse(raw);
      return {
        bestTime: typeof obj.bestTime === 'number' ? obj.bestTime : null,
        bestDv: typeof obj.bestDv === 'number' ? obj.bestDv : null,
      };
    } catch {
      return { bestTime: null, bestDv: null };
    }
  }

  function saveRecords(rec) {
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch {}
  }

  function loadUiPrefs() {
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (!raw) return { hudCollapsed: false, uiHidden: false };
      const obj = JSON.parse(raw);
      return {
        hudCollapsed: !!obj.hudCollapsed,
        uiHidden: !!obj.uiHidden,
      };
    } catch {
      return { hudCollapsed: false, uiHidden: false };
    }
  }

  function saveUiPrefs(prefs) {
    try { localStorage.setItem(UI_KEY, JSON.stringify(prefs)); } catch {}
  }

  let records = loadRecords();
  let uiPrefs = loadUiPrefs();

  // ---------- Утилиты ----------
  function setStatus(text, kind) {
    elStatus.textContent = text;
    elStatus.classList.remove('success', 'fail');
    if (kind) elStatus.classList.add(kind);
  }

  function updateHud() {
    elTime.textContent = state.time.toFixed(1) + ' с';
    const speed = Math.hypot(state.ship.vx, state.ship.vy);
    elSpeed.textContent = speed.toFixed(2);
    elDist.textContent = (state.distance * DIST_UNIT_MULT).toFixed(1) + ' ' + DIST_UNIT_LABEL;
    elDv.textContent = state.dv.toFixed(2) + ' / ' + DV_BUDGET.toFixed(2);
    dvBudgetHint.textContent = `(осталось ${(DV_BUDGET - state.dv).toFixed(2)})`;
    updateBurnButton();
  }

  function updateBurnButton() {
    const flying = state.mode === 'flying';
    const hasBudget = state.dv < DV_BUDGET - 1e-6;
    const burnPower = parseFloat(burnPowerInput.value);
    btnBurn.disabled = !(flying && hasBudget && burnPower > 0);
  }

  function resetShip() {
    state.ship.x = WORLD.earth.x;
    state.ship.y = WORLD.earth.y - WORLD.startAlt;
    state.ship.vx = 0;
    state.ship.vy = 0;
    state.prev.x = state.ship.x;
    state.prev.y = state.ship.y;
    state.trail = [{ x: state.ship.x, y: state.ship.y }];
    state.time = 0;
    state.dv = 0;
    state.distance = 0;
    state.acc = 0;
    state.mode = 'ready';
    state.failReason = '';
    state.particles = [];
    hideResult();
    updateHud();
  }

  function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const fx = x1 - cx, fy = y1 - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return (fx * fx + fy * fy) <= r * r;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 <= 0 && t2 >= 1);
  }

  // ---------- Частицы ----------
  function spawnExhaust(x, y, baseVx, baseVy, power) {
    const len = Math.hypot(baseVx, baseVy) || 1;
    const nx = -baseVx / len;
    const ny = -baseVy / len;
    const count = Math.max(10, Math.min(28, Math.floor(10 + power * 6)));
    const speedScale = 6 + power * 4;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const dx = nx * cs - ny * sn;
      const dy = nx * sn + ny * cs;
      const sp = speedScale * (0.5 + Math.random());
      state.particles.push({
        x, y,
        vx: dx * sp,
        vy: dy * sp,
        life: 0.7 + Math.random() * 0.5,
        maxLife: 1.2,
        r: 1.2 + Math.random() * 1.6,
      });
    }
  }

  function updateParticles(dtReal) {
    if (state.particles.length === 0) return;
    const out = [];
    for (const p of state.particles) {
      p.life -= dtReal;
      if (p.life <= 0) continue;
      p.x += p.vx * dtReal;
      p.y += p.vy * dtReal;
      p.vx *= 0.94;
      p.vy *= 0.94;
      out.push(p);
    }
    state.particles = out;
  }

  function drawParticles() {
    for (const p of state.particles) {
      const s = toScreen(p.x, p.y);
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, p.r * 3);
      g.addColorStop(0, `rgba(255, 210, 120, ${0.85 * alpha})`);
      g.addColorStop(1, `rgba(255, 120, 60, 0)`);
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  // ---------- Физика ----------
  function gravityAccel(x, y) {
    let ax = 0, ay = 0;
    const dxE = WORLD.earth.x - x;
    const dyE = WORLD.earth.y - y;
    const dE2 = dxE * dxE + dyE * dyE;
    const dE = Math.sqrt(dE2) || 1e-9;
    const aE = WORLD.earth.mass / (dE2 * dE);
    ax += aE * dxE;
    ay += aE * dyE;
    const dxM = WORLD.moon.x - x;
    const dyM = WORLD.moon.y - y;
    const dM2 = dxM * dxM + dyM * dyM;
    const dM = Math.sqrt(dM2) || 1e-9;
    const aM = WORLD.moon.mass / (dM2 * dM);
    ax += aM * dxM;
    ay += aM * dyM;
    return { ax, ay };
  }

  function stepPhysics() {
    const s = state.ship;
    state.prev.x = s.x;
    state.prev.y = s.y;
    const a1 = gravityAccel(s.x, s.y);
    s.vx += a1.ax * DT * 0.5;
    s.vy += a1.ay * DT * 0.5;
    s.x += s.vx * DT;
    s.y += s.vy * DT;
    const a2 = gravityAccel(s.x, s.y);
    s.vx += a2.ax * DT * 0.5;
    s.vy += a2.ay * DT * 0.5;
    state.time += DT;
    state.distance += Math.hypot(s.x - state.prev.x, s.y - state.prev.y);
    const last = state.trail[state.trail.length - 1];
    if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 0.05) {
      state.trail.push({ x: s.x, y: s.y });
      if (state.trail.length > state.trailMaxLen) state.trail.shift();
    }
    checkOutcome();
  }

  function checkOutcome() {
    const s = state.ship;
    const p = state.prev;
    if (segmentHitsCircle(p.x, p.y, s.x, s.y, WORLD.earth.x, WORLD.earth.y, WORLD.earth.r)) {
      finish('fail', 'Столкновение с Землёй');
      return;
    }
    if (segmentHitsCircle(p.x, p.y, s.x, s.y, WORLD.moon.x, WORLD.moon.y, WORLD.moonZoneR)) {
      finish('success', 'Аппарат у Луны');
      return;
    }
    const dE = Math.hypot(s.x - WORLD.earth.x, s.y - WORLD.earth.y);
    if (dE > MAP_BOUND) {
      finish('fail', 'Выход за границу карты');
      return;
    }
    if (state.time > 120) {
      finish('fail', 'Истекло время полёта');
    }
  }

  function finish(kind, reason) {
    if (state.mode === 'success' || state.mode === 'fail') return;
    state.mode = kind;
    state.failReason = kind === 'fail' ? reason : '';
    setStatus(kind === 'success' ? 'Успех! ' + reason : 'Неудача: ' + reason, kind);
    updateBurnButton();
    showResult(kind, reason);
  }

  function showResult(kind, reason) {
    resultCard.classList.remove('success', 'fail');
    resultCard.classList.add(kind);
    if (kind === 'success') {
      rTitle.textContent = 'Успех!';
      rSubtitle.textContent = 'Аппарат достиг области у Луны.';
    } else if (reason === 'Выход за границу карты') {
      rTitle.textContent = 'Выход за границу карты';
      rSubtitle.textContent = 'Аппарат покинул область симуляции. Уменьшите силу или добавьте +3…+8°.';
    } else {
      rTitle.textContent = 'Неудача';
      rSubtitle.textContent = reason || 'Попробуйте ещё раз.';
    }
    rTime.textContent = state.time.toFixed(2) + ' с';
    rDist.textContent = (state.distance * DIST_UNIT_MULT).toFixed(1) + ' ' + DIST_UNIT_LABEL;
    rDv.textContent = state.dv.toFixed(2);
    let newRecord = false;
    if (kind === 'success') {
      if (records.bestTime === null || state.time < records.bestTime) {
        records.bestTime = state.time; newRecord = true;
      }
      if (records.bestDv === null || state.dv < records.bestDv) {
        records.bestDv = state.dv; newRecord = true;
      }
      if (newRecord) saveRecords(records);
    }
    rBestTime.textContent = records.bestTime !== null ? records.bestTime.toFixed(2) + ' с' : '—';
    rBestDv.textContent = records.bestDv !== null ? records.bestDv.toFixed(2) : '—';
    rNewRecord.classList.toggle('hidden', !newRecord);
    resultEl.classList.remove('hidden');
  }

  function hideResult() { resultEl.classList.add('hidden'); }

  // ---------- Запуск / корректировка ----------
  function launch(power, angleDeg) {
    if (state.mode === 'flying') return;
    resetShip();
    state.lastLaunch = { power, angle: angleDeg };
    const rad = (angleDeg * Math.PI) / 180;
    const tx = 1, ty = 0;
    const rx = 0, ry = -1;
    state.ship.vx = (tx * Math.cos(rad) + rx * Math.sin(rad)) * power;
    state.ship.vy = (ty * Math.cos(rad) + ry * Math.sin(rad)) * power;
    spawnExhaust(state.ship.x, state.ship.y, state.ship.vx, state.ship.vy, power);
    state.mode = 'flying';
    setStatus('В полёте');
    updateHud();
  }

  function launchFromInputs() {
    launch(parseFloat(powerInput.value), parseFloat(angleInput.value));
  }

  function burn() {
    if (state.mode !== 'flying') return;
    const power = parseFloat(burnPowerInput.value);
    if (power <= 0) return;
    const remaining = DV_BUDGET - state.dv;
    if (remaining <= 1e-6) return;
    const applied = Math.min(power, remaining);
    const rad = (parseFloat(burnDirInput.value) * Math.PI) / 180;
    const dvx = Math.cos(rad) * applied;
    const dvy = Math.sin(rad) * applied;
    state.ship.vx += dvx;
    state.ship.vy += dvy;
    state.dv += applied;
    spawnExhaust(state.ship.x, state.ship.y, dvx, dvy, applied);
    updateHud();
  }

  // ---------- Отрисовка ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    view.dpr = dpr;

    const worldW = 200;
    const worldH = 140;
    const baseScale = Math.max(0.01, Math.min(w / worldW, h / worldH) * 0.9);
    view.scale = baseScale * view.zoom;

    view.worldMidX = (WORLD.earth.x + WORLD.moon.x) / 2;
    view.worldMidY = 0;
    view.cx = w / 2;
    view.cy = h / 2;
  }

  function applyZoom(newZoom) {
    view.zoom = Math.max(0.4, Math.min(3, newZoom));
    resize();
  }

  function toScreen(x, y) {
    return {
      x: view.cx + (x - view.worldMidX) * view.scale,
      y: view.cy - (y - view.worldMidY) * view.scale,
    };
  }

  const STARS = (() => {
    const arr = [];
    for (let i = 0; i < 160; i++) {
      const a = (i * 0.6180339887) % 1;
      const b = (i * 0.7548776662) % 1;
      const depth = i % 2 === 0 ? 0.02 : 0.05;
      const r = i % 5 === 0 ? 1.6 : 1.0;
      arr.push({ a, b, depth, r });
    }
    return arr;
  })();

  function drawStars(w, h) {
    const camX = view.worldMidX;
    const camY = view.worldMidY;
    for (const s of STARS) {
      const sx = ((s.a + camX * s.depth) % 1 + 1) % 1 * w;
      const sy = ((s.b + camY * s.depth) % 1 + 1) % 1 * h;
      ctx.fillStyle = 'rgba(200, 220, 255, 0.35)';
      ctx.fillRect(sx, sy, s.r, s.r);
    }
  }

  const ISLANDS = [
    [-0.35,  0.10, 0.28, 0.18,  0.4,  'rgba(110, 190, 120, 0.9)'],
    [-0.10, -0.30, 0.20, 0.14, -0.5,  'rgba(160, 210, 120, 0.9)'],
    [ 0.30,  0.25, 0.30, 0.16,  0.2,  'rgba(90, 170, 100, 0.9)'],
    [ 0.40, -0.20, 0.16, 0.10, -0.3,  'rgba(190, 220, 140, 0.85)'],
    [ 0.05,  0.40, 0.18, 0.10,  0.7,  'rgba(120, 200, 130, 0.85)'],
    [-0.45, -0.35, 0.10, 0.07,  0.1,  'rgba(200, 220, 160, 0.8)'],
    [ 0.55,  0.05, 0.09, 0.06, -0.2,  'rgba(160, 210, 120, 0.85)'],
    [-0.20,  0.35, 0.08, 0.05,  0.0,  'rgba(200, 220, 160, 0.85)'],
  ];

  function drawEarthGlow(x, y, r) {
    const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.6);
    g.addColorStop(0, 'rgba(120, 180, 255, 0.45)');
    g.addColorStop(0.6, 'rgba(80, 140, 255, 0.12)');
    g.addColorStop(1, 'rgba(80, 140, 255, 0)');
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawEarth(x, y, r) {
    drawEarthGlow(x, y, r);
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
    grad.addColorStop(0, '#6fb6ff');
    grad.addColorStop(0.7, '#2a68c8');
    grad.addColorStop(1, '#123a72');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    for (const [cx, cy, rx, ry, rot, color] of ISLANDS) {
      ctx.beginPath();
      ctx.ellipse(x + cx * r, y + cy * r, rx * r, ry * r, rot, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    const shade = ctx.createRadialGradient(x + r * 0.5, y + r * 0.5, r * 0.4, x, y, r);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.restore();
  }

  function drawMoon(x, y, r) {
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r);
    grad.addColorStop(0, '#f2f2f2');
    grad.addColorStop(0.7, '#b9b9b9');
    grad.addColorStop(1, '#6f6f6f');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const craters = [
      [-0.35, -0.15, 0.22], [0.2, 0.25, 0.16], [0.35, -0.3, 0.12],
      [-0.1, 0.4, 0.10], [0.05, -0.45, 0.09], [-0.5, 0.25, 0.08],
    ];
    for (const [cx, cy, cr] of craters) {
      ctx.beginPath();
      ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(90, 90, 90, 0.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + cx * r - cr * r * 0.2, y + cy * r - cr * r * 0.2, cr * r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220, 220, 220, 0.35)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSuccessZone(x, y, r, tSec) {
    const pulse = 0.55 + 0.25 * Math.sin(tSec * 3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(120, 220, 160, ${pulse})`;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.15);
    g.addColorStop(0, 'rgba(120, 220, 160, 0.0)');
    g.addColorStop(0.7, `rgba(120, 220, 160, ${0.10 + 0.05 * Math.sin(tSec * 3)})`);
    g.addColorStop(1, 'rgba(120, 220, 160, 0)');
    ctx.beginPath();
    ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawMapBound() {
    const c = toScreen(WORLD.earth.x, WORLD.earth.y);
    const rpx = MAP_BOUND * view.scale;
    if (rpx <= 0) return;
    ctx.beginPath();
    ctx.arc(c.x, c.y, rpx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 120, 140, 0.18)';
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTrail() {
    if (state.trail.length < 2) return;
    const total = state.trail.length;
    for (let i = 1; i < total; i++) {
      const a = toScreen(state.trail[i - 1].x, state.trail[i - 1].y);
      const b = toScreen(state.trail[i].x, state.trail[i].y);
      const age = i / total;
      const alpha = 0.15 + 0.7 * age;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(90, 170, 255, ${alpha})`;
      ctx.lineWidth = 1.2 + 0.8 * age;
      ctx.stroke();
    }
  }

  function drawShip(x, y, r, vx, vy) {
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.5);
    g.addColorStop(0, 'rgba(255, 220, 130, 0.55)');
    g.addColorStop(1, 'rgba(255, 220, 130, 0)');
    ctx.beginPath();
    ctx.arc(x, y, r * 3.5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe08a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const spd = Math.hypot(vx, vy);
    if (spd > 1e-6) {
      const nx = vx / spd;
      const ny = vy / spd;
      const len = 16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + nx * len, y - ny * len);
      ctx.strokeStyle = 'rgba(255, 210, 110, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const tipX = x + nx * len;
      const tipY = y - ny * len;
      const perpX = -ny, perpY = -nx;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - nx * 5 + perpX * 3, tipY + ny * 5 + perpY * 3);
      ctx.lineTo(tipX - nx * 5 - perpX * 3, tipY + ny * 5 - perpY * 3);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 210, 110, 0.95)';
      ctx.fill();
    }
  }

  function drawScaleBar(w, h) {
    // Скрываем при полном скрытии UI — проверяется в draw()
    const units = 20;
    const pxLen = units * view.scale;
    const x0 = 16;
    const y0 = h - 24;
    ctx.strokeStyle = 'rgba(160, 190, 230, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + pxLen, y0);
    ctx.moveTo(x0, y0 - 4);
    ctx.lineTo(x0, y0 + 4);
    ctx.moveTo(x0 + pxLen, y0 - 4);
    ctx.lineTo(x0 + pxLen, y0 + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200, 220, 245, 0.9)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${units} ${DIST_UNIT_LABEL}`, x0 + 4, y0 - 8);
  }

  function draw(timeSec) {
    const w = canvas.width / view.dpr;
    const h = canvas.height / view.dpr;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);
    drawStars(w, h);
    drawMapBound();
    const eS = toScreen(WORLD.earth.x, WORLD.earth.y);
    const eR = Math.max(1, WORLD.earth.r * view.scale);
    drawEarth(eS.x, eS.y, eR);
    const mS = toScreen(WORLD.moon.x, WORLD.moon.y);
    const mR = Math.max(1, WORLD.moon.r * view.scale);
    drawMoon(mS.x, mS.y, mR);
    drawSuccessZone(mS.x, mS.y, Math.max(1, WORLD.moonZoneR * view.scale), timeSec);
    drawTrail();
    drawParticles();
    const sS = toScreen(state.ship.x, state.ship.y);
    const sR = Math.max(3, 0.9 * view.scale);
    drawShip(sS.x, sS.y, sR, state.ship.vx, state.ship.vy);
    // Линейку не рисуем, если интерфейс полностью скрыт
    if (!uiPrefs.uiHidden) drawScaleBar(w, h);
  }

  // ---------- Главный цикл ----------
  function frame(ts) {
    if (!state.lastTs) state.lastTs = ts;
    let dtReal = (ts - state.lastTs) / 1000;
    state.lastTs = ts;
    if (dtReal > 0.1) dtReal = 0.1;

    if (state.mode === 'flying') {
      state.acc += dtReal * TIME_SCALE;
      let steps = 0;
      while (state.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        stepPhysics();
        state.acc -= DT;
        steps++;
        if (state.mode !== 'flying') break;
      }
      updateHud();
    }
    updateParticles(dtReal);
    draw(ts / 1000);
    requestAnimationFrame(frame);
  }

  // ---------- UI: сворачивание / скрытие ----------
  function applyUiPrefs() {
    hudEl.classList.toggle('collapsed', uiPrefs.hudCollapsed);
    controlsEl.classList.toggle('hidden', uiPrefs.uiHidden);
    hudEl.classList.toggle('hidden', uiPrefs.uiHidden);
    document.getElementById('zoom-controls').classList.toggle('hidden', uiPrefs.uiHidden);
    btnShowUi.classList.toggle('hidden', !uiPrefs.uiHidden);
  }

  btnToggleHud.addEventListener('click', () => {
    uiPrefs.hudCollapsed = !uiPrefs.hudCollapsed;
    saveUiPrefs(uiPrefs);
    applyUiPrefs();
  });

  btnToggleUi.addEventListener('click', () => {
    uiPrefs.uiHidden = true;
    saveUiPrefs(uiPrefs);
    applyUiPrefs();
  });

  btnShowUi.addEventListener('click', () => {
    uiPrefs.uiHidden = false;
    saveUiPrefs(uiPrefs);
    applyUiPrefs();
  });

  // ---------- Zoom ----------
  btnZoomIn.addEventListener('click', () => applyZoom(view.zoom * 1.25));
  btnZoomOut.addEventListener('click', () => applyZoom(view.zoom / 1.25));
  btnZoomReset.addEventListener('click', () => applyZoom(1));

  // Пинч-зум и колёсико на canvas
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyZoom(view.zoom * factor);
  }, { passive: false });

  // Пинч (два пальца)
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartZoom = view.zoom;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const factor = d / pinchStartDist;
      applyZoom(pinchStartZoom * factor);
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => { pinchStartDist = 0; }, { passive: true });

  // ---------- Обычные обработчики ----------
  powerInput.addEventListener('input', () => {
    vPower.textContent = parseFloat(powerInput.value).toFixed(2);
  });
  angleInput.addEventListener('input', () => {
    vAngle.textContent = angleInput.value + '°';
  });
  burnPowerInput.addEventListener('input', () => {
    vBurnPower.textContent = parseFloat(burnPowerInput.value).toFixed(2);
    updateBurnButton();
  });
  burnDirInput.addEventListener('input', () => {
    vBurnDir.textContent = burnDirInput.value + '°';
  });

  btnLaunch.addEventListener('click', launchFromInputs);
  btnReset.addEventListener('click', () => {
    resetShip();
    setStatus('Готов к запуску');
  });
  btnBurn.addEventListener('click', burn);
  btnAgain.addEventListener('click', () => {
    hideResult();
    launch(state.lastLaunch.power, state.lastLaunch.angle);
  });
  btnResetRecords.addEventListener('click', () => {
    let ok = false;
    try { ok = confirm('Сбросить рекорды?'); } catch { ok = false; }
    if (!ok) return;
    records = { bestTime: null, bestDv: null };
    saveRecords(records);
    rBestTime.textContent = '—';
    rBestDv.textContent = '—';
    rNewRecord.classList.add('hidden');
  });

  window.addEventListener('resize', resize);

  // ---------- Старт ----------
  function init() {
    resize();
    applyUiPrefs();
    resetShip();
    setStatus('Готов к запуску');
    draw(0);
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();