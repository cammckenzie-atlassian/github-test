const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const GRID_W = 30;
const GRID_H = 30;
const TICK_MS = 150;
const MAX_PLAYERS = 4;
const RESPAWN_TICKS = Math.round(3000 / TICK_MS); // ~20 ticks

const COLORS = ['#4ade80', '#60a5fa', '#fb923c', '#c084fc'];
const STARTS = [
  { x: 5,  y: 5,  dir: 'RIGHT' },
  { x: 24, y: 24, dir: 'LEFT'  },
  { x: 24, y: 5,  dir: 'LEFT'  },
  { x: 5,  y: 24, dir: 'RIGHT' },
];

// ── state ────────────────────────────────────────────────────────────────────

let snakes = [];   // { id, body:[{x,y}], dir, nextDir, score, alive, respawnIn }
let food   = [];
let nextId = 1;
const clients = new Map(); // ws → playerId

function spawnFood() {
  const occupied = new Set();
  for (const s of snakes) for (const c of s.body) occupied.add(`${c.x},${c.y}`);
  for (const f of food) occupied.add(`${f.x},${f.y}`);

  let attempts = 0;
  while (attempts++ < 200) {
    const x = Math.floor(Math.random() * GRID_W);
    const y = Math.floor(Math.random() * GRID_H);
    if (!occupied.has(`${x},${y}`)) return { x, y };
  }
  return null;
}

function ensureFood() {
  while (food.length < 5) {
    const f = spawnFood();
    if (f) food.push(f);
    else break;
  }
}

function spawnSnake(id) {
  const idx = (id - 1) % MAX_PLAYERS;
  const { x, y, dir } = STARTS[idx];
  return {
    id,
    color: COLORS[idx],
    body: [{ x, y }, { x: x - (dir === 'RIGHT' ? 1 : dir === 'LEFT' ? -1 : 0), y: y - (dir === 'DOWN' ? 1 : dir === 'UP' ? -1 : 0) }],
    dir,
    nextDir: dir,
    score: 0,
    alive: true,
    respawnIn: 0,
  };
}

function addPlayer(ws) {
  if (snakes.length >= MAX_PLAYERS) return null;
  const id = nextId++;
  clients.set(ws, id);
  snakes.push(spawnSnake(id));
  ensureFood();
  return id;
}

function removePlayer(ws) {
  const id = clients.get(ws);
  if (id === undefined) return;
  clients.delete(ws);
  snakes = snakes.filter(s => s.id !== id);
}

const DIRS = {
  UP:    { x:  0, y: -1 },
  DOWN:  { x:  0, y:  1 },
  LEFT:  { x: -1, y:  0 },
  RIGHT: { x:  1, y:  0 },
};
const OPPOSITE = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };

function tick() {
  // handle respawning
  for (const s of snakes) {
    if (!s.alive) {
      s.respawnIn--;
      if (s.respawnIn <= 0) {
        const idx = (s.id - 1) % MAX_PLAYERS;
        const { x, y, dir } = STARTS[idx];
        s.body = [{ x, y }, { x: x - (dir === 'RIGHT' ? 1 : dir === 'LEFT' ? -1 : 0), y }];
        s.dir = dir;
        s.nextDir = dir;
        s.alive = true;
      }
      continue;
    }
    // apply direction
    if (s.nextDir !== OPPOSITE[s.dir]) s.dir = s.nextDir;

    const delta = DIRS[s.dir];
    const head = s.body[0];
    const newHead = { x: head.x + delta.x, y: head.y + delta.y };

    // wall collision
    if (newHead.x < 0 || newHead.x >= GRID_W || newHead.y < 0 || newHead.y >= GRID_H) {
      s.alive = false;
      s.respawnIn = RESPAWN_TICKS;
      continue;
    }

    // self collision (skip tail tip which will move)
    const bodyWithoutTail = s.body.slice(0, s.body.length - 1);
    if (bodyWithoutTail.some(c => c.x === newHead.x && c.y === newHead.y)) {
      s.alive = false;
      s.respawnIn = RESPAWN_TICKS;
      continue;
    }

    s.body.unshift(newHead);

    // food check
    const foodIdx = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
    if (foodIdx !== -1) {
      food.splice(foodIdx, 1);
      s.score++;
      // don't remove tail (snake grows)
    } else {
      s.body.pop();
    }
  }

  // other-snake collision (after moves)
  const allCells = new Map();
  for (const s of snakes) {
    if (!s.alive) continue;
    for (let i = 0; i < s.body.length; i++) {
      const key = `${s.body[i].x},${s.body[i].y}`;
      if (!allCells.has(key)) allCells.set(key, []);
      allCells.get(key).push({ snakeId: s.id, isHead: i === 0 });
    }
  }
  for (const [, occupants] of allCells) {
    if (occupants.length > 1) {
      // heads colliding or head into body
      const heads = occupants.filter(o => o.isHead);
      if (heads.length > 1) {
        // both heads collide — kill all
        for (const h of heads) {
          const s = snakes.find(s => s.id === h.snakeId);
          if (s) { s.alive = false; s.respawnIn = RESPAWN_TICKS; }
        }
      } else if (heads.length === 1) {
        const s = snakes.find(s => s.id === heads[0].snakeId);
        if (s) { s.alive = false; s.respawnIn = RESPAWN_TICKS; }
      }
    }
  }

  ensureFood();

  // broadcast
  const state = {
    type: 'state',
    snakes: snakes.map(s => ({ id: s.id, color: s.color, body: s.body, score: s.score, alive: s.alive })),
    food,
  };
  const msg = JSON.stringify(state);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── HTTP + WS server ─────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  const id = addPlayer(ws);
  if (id === null) {
    ws.close(1008, 'Server full');
    return;
  }
  ws.send(JSON.stringify({ type: 'init', playerId: id }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'direction') {
        const playerId = clients.get(ws);
        const snake = snakes.find(s => s.id === playerId);
        if (snake && snake.alive && DIRS[msg.dir]) {
          snake.nextDir = msg.dir;
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

server.listen(3000, () => console.log('Snake server running at http://localhost:3000'));
setInterval(tick, TICK_MS);
