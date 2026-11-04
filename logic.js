// logic.js
// Pure game rules for UPSIDE DOWN: ENDLESS.
// No Phaser, no DOM. Phaser only DRAWS what this file decides.

export const COLS = 10;
export const ROWS = 20;
export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// ---------- Tunable numbers ----------
export const LINES_PER_LEVEL = 10;
export const LOCK_DELAY = 500;        // ms a landed piece can still slide/rotate
export const MAX_LOCK_RESETS = 15;    // stops infinite stalling at the bottom
export const SOFT_DROP_INTERVAL = 50; // ms per row while Down is held
export const LINE_SCORES = [0, 100, 300, 500, 800]; // x level

// ---------- Speed ----------
// Level N is exactly N times as fast as level 1:
//   level 1 = normal (600 ms per row), level 2 = 2x, level 5 = 5x, level 10 = 10x ...
// Past level 20 the speed stops growing (30 ms per row, which is already instant for a human).
export const START_INTERVAL = 600;   // ms per row at level 1
export const MIN_INTERVAL = 30;      // the fastest the game ever gets (level 20)

export function gravityInterval(level) {
  return Math.max(MIN_INTERVAL, START_INTERVAL / level);
}

// "How many times faster than level 1" - shown next to LEVEL on screen.
export function speedMultiplier(level) {
  return gravityInterval(1) / gravityInterval(level);
}

// ---------- Piece shapes ----------
// Cells are [x, y] inside a size x size box. y grows downward.
const BASE = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
};

function rotateCW(cells, size) {
  return cells.map(([x, y]) => [size - 1 - y, x]);
}

// SHAPES[type][rotation] -> list of [x, y]. Rotation 0..3 (0 = spawn, 1 = clockwise).
export const SHAPES = {};
for (const type of PIECE_TYPES) {
  const { size, cells } = BASE[type];
  const states = [cells];
  for (let i = 1; i < 4; i++) states.push(rotateCW(states[i - 1], size));
  SHAPES[type] = states;
}

// ---------- Wall kicks (Super Rotation System) ----------
// These tables use the "y points up" convention from the Tetris guideline.
// When we apply them we flip y, because our y grows downward.
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};

const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

// ---------- The game ----------
export class TetrisGame {
  /**
   * @param {object}   [options]
   * @param {function} [options.rng]      returns 0..1 (swap in a seeded one for tests)
   * @param {function} [options.onEvent]  called as onEvent(name, data)
   *   names: move, rotate, harddrop, hold, lock, clear, levelup, gameover
   */
  constructor({ rng = Math.random, onEvent = null } = {}) {
    this.rng = rng;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.bag = [];
    this.queue = [];
    this.active = null;     // { type, rot, x, y }
    this.hold = null;
    this.holdUsed = false;

    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.gameOver = false;

    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = 0;

    this.fillQueue();
    this.spawn(this.takeNext());
  }

  emit(name, data = {}) {
    if (this.onEvent) this.onEvent(name, data);
  }

  // ----- Seven-bag randomizer -----
  refillBag() {
    const bag = [...PIECE_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.bag = bag;
  }

  fillQueue() {
    while (this.queue.length < 7) {
      if (this.bag.length === 0) this.refillBag();
      this.queue.push(this.bag.pop());
    }
  }

  takeNext() {
    const type = this.queue.shift();
    this.fillQueue();
    return type;
  }

  get next() {
    return this.queue.slice(0, 3);
  }

  // ----- Collision -----
  collides(type, rot, x, y) {
    for (const [cx, cy] of SHAPES[type][rot]) {
      const gx = x + cx;
      const gy = y + cy;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && this.grid[gy][gx]) return true;
    }
    return false;
  }

  grounded() {
    const p = this.active;
    return !!p && this.collides(p.type, p.rot, p.x, p.y + 1);
  }

  canAct() {
    return !!this.active && !this.gameOver;
  }

  // ----- Spawning -----
  spawn(type) {
    this.active = { type, rot: 0, x: type === 'O' ? 4 : 3, y: 0 };
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = 0;

    if (this.collides(type, 0, this.active.x, this.active.y)) {
      this.endGame();
    }
  }

  endGame() {
    this.gameOver = true;
    this.active = null;
    this.emit('gameover', { score: this.score, lines: this.lines, level: this.level });
  }

  // ----- Player actions -----
  move(dx) {
    if (!this.canAct()) return false;
    const p = this.active;
    if (this.collides(p.type, p.rot, p.x + dx, p.y)) return false;
    p.x += dx;
    this.afterSuccessfulMove();
    this.emit('move');
    return true;
  }

  rotate(dir) {
    if (!this.canAct()) return false;
    const p = this.active;
    if (p.type === 'O') return false;

    const to = (p.rot + dir + 4) % 4;
    const table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${p.rot}>${to}`];

    for (const [kx, ky] of kicks) {
      const nx = p.x + kx;
      const ny = p.y - ky; // flip y: the tables use "up is positive"
      if (!this.collides(p.type, to, nx, ny)) {
        p.rot = to;
        p.x = nx;
        p.y = ny;
        this.afterSuccessfulMove();
        this.emit('rotate');
        return true;
      }
    }
    return false;
  }

  hardDrop() {
    if (!this.canAct()) return false;
    const p = this.active;
    let dist = 0;
    while (!this.collides(p.type, p.rot, p.x, p.y + 1)) {
      p.y += 1;
      dist += 1;
    }
    this.score += dist * 2;
    this.emit('harddrop', { dist });
    this.lock();
    return true;
  }

  // One row down right now (used the instant the Down key is pressed, so it never feels late).
  softDropStep() {
    if (!this.canAct()) return false;
    const p = this.active;
    if (this.collides(p.type, p.rot, p.x, p.y + 1)) return false;
    p.y += 1;
    this.score += 1;
    this.gravityTimer = 0;
    this.afterSuccessfulMove();
    return true;
  }

  holdPiece() {
    if (!this.canAct() || this.holdUsed) return false;
    const current = this.active.type;
    this.holdUsed = true;

    if (this.hold === null) {
      this.hold = current;
      this.spawn(this.takeNext());
    } else {
      const swap = this.hold;
      this.hold = current;
      this.spawn(swap);
    }
    this.emit('hold');
    return true;
  }

  // ----- Time -----
  // dt is in milliseconds. Only call this while the game is actually running,
  // which is what makes pause work: no tick, no time, no gravity.
  tick(dt, softDropping = false) {
    if (this.gameOver) return;
    this.elapsedMs += dt;
    if (!this.active) return;

    if (this.grounded()) {
      this.gravityTimer = 0;
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lock();
      return;
    }

    this.lockTimer = 0;
    const base = gravityInterval(this.level);
    const interval = softDropping ? Math.min(base, SOFT_DROP_INTERVAL) : base;

    this.gravityTimer += dt;
    while (this.gravityTimer >= interval && this.active && !this.grounded()) {
      this.gravityTimer -= interval;
      this.active.y += 1;
      if (softDropping) this.score += 1;
      this.noteDescent();
    }
    if (this.grounded()) this.gravityTimer = 0;
  }

  noteDescent() {
    if (this.active.y > this.lowestY) {
      this.lowestY = this.active.y;
      this.lockResets = 0;
    }
  }

  afterSuccessfulMove() {
    this.noteDescent();
    if (this.grounded()) {
      if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockTimer = 0;
        this.lockResets += 1;
      }
    } else {
      this.lockTimer = 0;
    }
  }

  // ----- Locking and clearing -----
  lock() {
    const { type, rot, x, y } = this.active;

    for (const [cx, cy] of SHAPES[type][rot]) {
      const gx = x + cx;
      const gy = y + cy;
      if (gy < 0) {
        this.endGame(); // locked above the board
        return;
      }
      this.grid[gy][gx] = type;
    }

    this.active = null;
    this.emit('lock', { type });

    const full = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.grid[r].every(Boolean)) full.push(r);
    }

    // Rows are removed and the next piece spawns RIGHT AWAY, so the player can keep
    // playing with no pause. The scene gets the details it needs (what was in the cleared
    // rows, and how far everything above fell) to play the flash/dissolve animation.
    if (full.length > 0) this.clearRows(full);

    this.holdUsed = false;
    this.spawn(this.takeNext());
  }

  clearRows(rows) {
    const doomed = new Set(rows);

    // What was in the cleared rows (for the dissolve animation).
    const cleared = rows.map(row => ({ row, cells: [...this.grid[row]] }));

    // Build the new grid. drops[r] = how many rows the content of new row r fell.
    const kept = [];
    for (let r = 0; r < ROWS; r++) {
      if (!doomed.has(r)) kept.push({ cells: this.grid[r], from: r });
    }
    const newGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const drops = Array(ROWS).fill(0);
    const offset = ROWS - kept.length;
    kept.forEach((row, i) => {
      newGrid[offset + i] = row.cells;
      drops[offset + i] = offset + i - row.from;
    });
    this.grid = newGrid;

    const points = LINE_SCORES[rows.length] * this.level;
    this.score += points;
    this.lines += rows.length;

    const newLevel = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
    const leveledUp = newLevel > this.level;
    if (leveledUp) this.level = newLevel;

    this.emit('clear', { rows, count: rows.length, cleared, drops, points });
    if (leveledUp) this.emit('levelup', { level: newLevel, speed: speedMultiplier(newLevel) });
  }

  // ----- Helpers for drawing -----
  ghostY() {
    if (!this.active) return null;
    const { type, rot, x } = this.active;
    let y = this.active.y;
    while (!this.collides(type, rot, x, y + 1)) y += 1;
    return y;
  }

  snapshot() {
    return {
      score: this.score,
      lines: this.lines,
      level: this.level,
      speed: speedMultiplier(this.level),
      timeMs: this.elapsedMs,
      next: this.next,
      hold: this.hold,
      holdUsed: this.holdUsed,
      gameOver: this.gameOver
    };
  }
}