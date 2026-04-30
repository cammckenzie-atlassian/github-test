const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highscoreEl = document.getElementById('highscore');
const messageEl = document.getElementById('message');

const GRID = 20;          // cells across/down
const CELL = canvas.width / GRID;  // px per cell
const TICK_BASE = 150;    // ms between moves at level 1
const SPEED_STEP = 5;     // ms faster per 5 points

// Colors
const COLOR_SNAKE_HEAD = '#4ecca3';
const COLOR_SNAKE_BODY = '#38b28d';
const COLOR_FOOD       = '#e94560';
const COLOR_GRID       = '#1a2a4a';

let snake, dir, nextDir, food, score, highScore, state, tickInterval;

highScore = parseInt(localStorage.getItem('snakeHS') || '0', 10);
highscoreEl.textContent = highScore;
state = 'idle'; // idle | running | dead

// ─── Input ────────────────────────────────────────────────────────────────────
const KEY_MAP = {
  ArrowUp:    { x: 0, y: -1 },
  ArrowDown:  { x: 0, y:  1 },
  ArrowLeft:  { x: -1, y: 0 },
  ArrowRight: { x:  1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y:  1 },
  a: { x: -1, y: 0 },
  d: { x:  1, y: 0 },
};

document.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && state !== 'running') {
    startGame();
    return;
  }
  const d = KEY_MAP[e.key];
  if (!d) return;
  e.preventDefault();
  // Prevent reversing direction
  if (d.x !== 0 && dir.x !== 0) return;
  if (d.y !== 0 && dir.y !== 0) return;
  nextDir = d;
});

// ─── Game lifecycle ────────────────────────────────────────────────────────────
function startGame() {
  snake = [
    { x: 10, y: 10 },
    { x: 9,  y: 10 },
    { x: 8,  y: 10 },
  ];
  dir     = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  score   = 0;
  scoreEl.textContent = 0;
  state   = 'running';
  messageEl.textContent = '';
  messageEl.classList.remove('active');
  spawnFood();
  clearInterval(tickInterval);
  scheduleTick();
}

function scheduleTick() {
  const delay = Math.max(60, TICK_BASE - Math.floor(score / SPEED_STEP) * SPEED_STEP);
  tickInterval = setTimeout(() => {
    if (state === 'running') { tick(); scheduleTick(); }
  }, delay);
}

function tick() {
  dir = nextDir;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // Wall collision
  if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
    return endGame();
  }
  // Self collision
  if (snake.some(s => s.x === head.x && s.y === head.y)) {
    return endGame();
  }

  snake.unshift(head);

  if (head.x === food.x && head.y === food.y) {
    score++;
    scoreEl.textContent = score;
    if (score > highScore) {
      highScore = score;
      highscoreEl.textContent = highScore;
      localStorage.setItem('snakeHS', highScore);
    }
    spawnFood();
  } else {
    snake.pop();
  }

  draw();
}

function endGame() {
  state = 'dead';
  clearInterval(tickInterval);
  drawDeathFlash();
  setTimeout(() => {
    messageEl.textContent = `Game over! Score: ${score} — Press Space to restart`;
    messageEl.classList.add('active');
  }, 400);
}

// ─── Food ─────────────────────────────────────────────────────────────────────
function spawnFood() {
  let pos;
  do {
    pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (snake.some(s => s.x === pos.x && s.y === pos.y));
  food = pos;
  draw();
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function drawGrid() {
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(canvas.width, i * CELL);
    ctx.stroke();
  }
}

function drawCell(x, y, color, radius = 3) {
  const px = x * CELL + 1;
  const py = y * CELL + 1;
  const sz = CELL - 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, sz, sz, radius);
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // Food — pulsing dot
  const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 200);
  ctx.save();
  ctx.globalAlpha = pulse;
  drawCell(food.x, food.y, COLOR_FOOD, CELL / 2);
  ctx.restore();

  // Snake
  snake.forEach((seg, i) => {
    const color = i === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE_BODY;
    drawCell(seg.x, seg.y, color, i === 0 ? 5 : 3);
  });

  // Eyes on head
  drawEyes(snake[0]);
}

function drawEyes(head) {
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const offset = CELL * 0.2;
  const eyeR   = CELL * 0.1;

  // Offset eyes based on direction
  const perp = { x: -dir.y, y: dir.x };
  const fwd  = dir;

  [[1, 1], [1, -1]].forEach(([f, p]) => {
    const ex = cx + fwd.x * offset * f + perp.x * offset * p;
    const ey = cy + fwd.y * offset * f + perp.y * offset * p;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawDeathFlash() {
  let flashes = 0;
  const flash = setInterval(() => {
    ctx.fillStyle = `rgba(233, 69, 96, ${flashes % 2 === 0 ? 0.3 : 0})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (++flashes >= 6) clearInterval(flash);
  }, 80);
}

// ─── Initial render ───────────────────────────────────────────────────────────
(function initialDraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  // Draw a static snake preview
  [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }].forEach((s, i) => {
    drawCell(s.x, s.y, i === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE_BODY);
  });
  drawCell(14, 7, COLOR_FOOD, CELL / 2);
})();

// Animate food pulse on idle screen
setInterval(() => {
  if (state === 'idle') initialDraw_();
}, 50);

function initialDraw_() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }].forEach((s, i) => {
    drawCell(s.x, s.y, i === 0 ? COLOR_SNAKE_HEAD : COLOR_SNAKE_BODY);
  });
  const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 200);
  ctx.save();
  ctx.globalAlpha = pulse;
  drawCell(14, 7, COLOR_FOOD, CELL / 2);
  ctx.restore();
}
