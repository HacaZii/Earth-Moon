// ===================== ВЕРСИЯ 1.0 =====================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const earth = { x: 0, y: 0, r: 38 };
const moon  = { x: 0, y: 0, r: 16, angle: 0, orbitR: 0 };
const successR = 52;

let craft = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  trail: [],
  totalDV: 0,
  flying: false,
  impulsed: false
};

let time = 0;
let timeScale = 70;
let status = 'Ожидание';
let finished = false;

const dvPower = document.getElementById('dvPower');
const dvAngle = document.getElementById('dvAngle');
const dvPowerVal = document.getElementById('dvPowerVal');
const dvAngleVal = document.getElementById('dvAngleVal');

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  placeBodies();
}
window.addEventListener('resize', resize);
resize();

function placeBodies() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  earth.x = w * 0.25;
  earth.y = h * 0.5;
  moon.orbitR = Math.min(w, h) * 0.38;
  updateMoonPosition();
}

function updateMoonPosition() {
  // Луна медленно движется по кругу (пункт 1)
  moon.x = earth.x + Math.cos(moon.angle) * moon.orbitR;
  moon.y = earth.y + Math.sin(moon.angle) * moon.orbitR;
}

function resetGame() {
  placeBodies();
  moon.angle = 0;
  updateMoonPosition();

  craft.x = earth.x + earth.r + 14;
  craft.y = earth.y;
  craft.vx = 0;
  craft.vy = 0;
  craft.trail = [];
  craft.totalDV = 0;
  craft.flying = false;
  craft.impulsed = false;
  time = 0;
  finished = false;
  status = 'Ожидание';
  document.getElementById('result').classList.add('hidden');
  document.getElementById('btnImpulse').disabled = true;
  document.getElementById('btnStart').disabled = false;
  updateHUD();
}

function startFlight() {
  if (finished) return;
  status = 'На орбите — дайте импульс TLI';
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnImpulse').disabled = false;

  // Небольшая начальная скорость (условная круговая орбита)
  craft.vx = 0;
  craft.vy = -1.1;
  craft.flying = true;
}

function applyImpulse() {
  if (!craft.flying || finished || craft.impulsed) return;

  const power = Number(dvPower.value);
  const angleDeg = Number(dvAngle.value);
  const angle = angleDeg * Math.PI / 180;

  // Импульс направлен в сторону Луны + угол игрока
  // Это создаёт вытянутую траекторию (пункт 3)
  const toMoonX = moon.x - craft.x;
  const toMoonY = moon.y - craft.y;
  const dist = Math.hypot(toMoonX, toMoonY) || 1;
  const baseAngle = Math.atan2(toMoonY, toMoonX);

  const finalAngle = baseAngle + angle;
  const strength = power / 900;          // масштаб для экрана

  craft.vx += Math.cos(finalAngle) * strength;
  craft.vy += Math.sin(finalAngle) * strength;
  craft.totalDV += power;
  craft.impulsed = true;

  status = 'Перелёт (TLI выполнен)';
  document.getElementById('btnImpulse').disabled = true;
}

function showResult(success) {
  finished = true;
  craft.flying = false;
  const box = document.getElementById('result');
  const title = document.getElementById('resultTitle');
  const text = document.getElementById('resultText');

  if (success) {
    title.textContent = 'Успех!';
    title.style.color = 'var(--success)';
    text.textContent = `Аппарат достиг зоны Луны за ${(time / 86400).toFixed(2)} сут. Суммарный ΔV = ${craft.totalDV.toFixed(0)} м/с.`;
  } else {
    title.textContent = 'Неудача';
    title.style.color = 'var(--fail)';
    text.textContent = `Аппарат не попал в зону Луны. Попробуйте изменить силу или направление импульса TLI.`;
  }
  box.classList.remove('hidden');
}

function updatePhysics(dt) {
  if (finished) return;

  // Движение Луны (медленно)
  moon.angle += 0.0009 * timeScale * dt;
  updateMoonPosition();

  if (!craft.flying) return;

  // Слабое притяжение к Луне (чтобы траектория изгибалась)
  const dx = moon.x - craft.x;
  const dy = moon.y - craft.y;
  const dist = Math.hypot(dx, dy) || 1;
  const pull = 2200 / (dist * dist);
  craft.vx += (dx / dist) * pull * dt;
  craft.vy += (dy / dist) * pull * dt;

  craft.x += craft.vx * dt * 55;
  craft.y += craft.vy * dt * 55;

  time += dt * timeScale;

  craft.trail.push({ x: craft.x, y: craft.y });
  if (craft.trail.length > 220) craft.trail.shift();

  // Столкновение с Землёй
  if (Math.hypot(craft.x - earth.x, craft.y - earth.y) < earth.r) {
    showResult(false);
    return;
  }

  // Успех — вход в зону Луны
  if (Math.hypot(craft.x - moon.x, craft.y - moon.y) < successR) {
    showResult(true);
    return;
  }

  // Улетел за пределы экрана
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (craft.x < -60 || craft.x > w + 60 || craft.y < -60 || craft.y > h + 60) {
    showResult(false);
  }
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, w, h);

  // Орбита Луны (тонкая линия)
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(176,190,197,0.2)';
  ctx.lineWidth = 1;
  ctx.arc(earth.x, earth.y, moon.orbitR, 0, Math.PI * 2);
  ctx.stroke();

  // Земля
  ctx.beginPath();
  ctx.fillStyle = '#4fc3f7';
  ctx.arc(earth.x, earth.y, earth.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(79,195,247,0.35)';
  ctx.lineWidth = 3;
  ctx.arc(earth.x, earth.y, earth.r + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Луна
  ctx.beginPath();
  ctx.fillStyle = '#b0bec5';
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();

  // Зона успеха
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(102,187,106,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.arc(moon.x, moon.y, successR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // След траектории
  if (craft.trail.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,200,50,0.75)';
    ctx.lineWidth = 2;
    ctx.moveTo(craft.trail[0].x, craft.trail[0].y);
    for (let i = 1; i < craft.trail.length; i++) {
      ctx.lineTo(craft.trail[i].x, craft.trail[i].y);
    }
    ctx.stroke();
  }

  // Аппарат
  ctx.beginPath();
  ctx.fillStyle = '#ffeb3b';
  ctx.arc(craft.x, craft.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function updateHUD() {
  document.getElementById('time').textContent = (time / 86400).toFixed(2);
  const speed = Math.hypot(craft.vx, craft.vy) * 0.85;
  document.getElementById('speed').textContent = speed.toFixed(2);
  document.getElementById('totalDV').textContent = craft.totalDV.toFixed(0);
  document.getElementById('status').textContent = status;
}

// ----- обработчики -----
dvPower.addEventListener('input', () => {
  dvPowerVal.textContent = dvPower.value;
});
dvAngle.addEventListener('input', () => {
  dvAngleVal.textContent = dvAngle.value;
});

document.getElementById('btnStart').addEventListener('click', startFlight);
document.getElementById('btnImpulse').addEventListener('click', applyImpulse);
document.getElementById('btnRestart').addEventListener('click', resetGame);
document.getElementById('btnResultOk').addEventListener('click', resetGame);

window.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft') {
    dvPower.value = Math.max(2000, Number(dvPower.value) - 50);
    dvPower.dispatchEvent(new Event('input'));
  }
  if (e.code === 'ArrowRight') {
    dvPower.value = Math.min(4500, Number(dvPower.value) + 50);
    dvPower.dispatchEvent(new Event('input'));
  }
  if (e.code === 'ArrowUp') {
    dvAngle.value = Math.min(60, Number(dvAngle.value) + 2);
    dvAngle.dispatchEvent(new Event('input'));
  }
  if (e.code === 'ArrowDown') {
    dvAngle.value = Math.max(-60, Number(dvAngle.value) - 2);
    dvAngle.dispatchEvent(new Event('input'));
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!craft.flying) startFlight();
    else applyImpulse();
  }
});

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  updatePhysics(dt);
  draw();
  updateHUD();
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);