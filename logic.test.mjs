// Run with:  node --test logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TetrisGame, COLS, ROWS, PIECE_TYPES, SHAPES,
  gravityInterval, speedMultiplier, LOCK_DELAY
} from './logic.js';

// Small deterministic random generator so tests never flake.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function newGame(seed = 7) {
  return new TetrisGame({ rng: seeded(seed) });
}

// Fill a row except the given columns.
function fillRow(game, row, exceptCols = []) {
  for (let c = 0; c < COLS; c++) {
    if (!exceptCols.includes(c)) game.grid[row][c] = 'T';
  }
}

test('every shape has 4 cells in all 4 rotations', () => {
  for (const type of PIECE_TYPES) {
    for (let rot = 0; rot < 4; rot++) {
      assert.equal(SHAPES[type][rot].length, 4, `${type} rot ${rot}`);
    }
  }
});

test('seven-bag: every run of 7 pieces contains each type once', () => {
  const g = newGame();
  const seq = [g.active.type];
  for (let i = 0; i < 69; i++) seq.push(g.takeNext());
  for (let i = 0; i < 70; i += 7) {
    const chunk = seq.slice(i, i + 7).sort().join('');
    assert.equal(chunk, [...PIECE_TYPES].sort().join(''), `chunk at ${i}`);
  }
});

test('NEXT shows 3 upcoming pieces', () => {
  const g = newGame();
  assert.equal(g.next.length, 3);
});

test('pieces stop at the walls', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 0 };
  for (let i = 0; i < 20; i++) g.move(-1);
  assert.equal(g.active.x, 0);
  for (let i = 0; i < 20; i++) g.move(1);
  assert.equal(g.active.x, COLS - 3);
});

test('rotation near the wall uses a wall kick instead of failing', () => {
  const g = newGame();
  // Vertical I hugging the left wall (its column is x + 2 = 0).
  g.active = { type: 'I', rot: 1, x: -2, y: 5 };
  const ok = g.rotate(-1); // back to horizontal, needs to kick right
  assert.equal(ok, true);
  assert.equal(g.active.rot, 0);
  assert.ok(g.active.x >= 0);
});

test('four rotations return to the original orientation', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 8 };
  for (let i = 0; i < 4; i++) assert.equal(g.rotate(1), true);
  assert.deepEqual(g.active, { type: 'T', rot: 0, x: 3, y: 8 });
});

test('O piece never rotates or kicks', () => {
  const g = newGame();
  g.active = { type: 'O', rot: 0, x: 4, y: 3 };
  assert.equal(g.rotate(1), false);
});

test('hard drop: scores 2 per cell and locks at the floor', () => {
  const g = newGame();
  g.active = { type: 'I', rot: 0, x: 3, y: 0 }; // cells sit on row y + 1
  g.hardDrop();
  assert.equal(g.score, 2 * 18);
  for (let c = 3; c <= 6; c++) assert.equal(g.grid[ROWS - 1][c], 'I');
  assert.ok(g.active, 'next piece spawned');
});

test('single line clear: happens instantly and scores 100 x level', () => {
  const g = newGame();
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  const before = g.score;
  g.hardDrop();
  assert.equal(g.lines, 1);
  assert.equal(g.score, before + 2 * 18 + 100, 'hard-drop points (2 x 18 rows) + 100 for the line');
  assert.ok(g.grid[19].every(cell => cell === null));
  assert.ok(g.active, 'next piece spawned immediately');
});

test('blocks above a cleared row fall down', () => {
  const g = newGame();
  g.grid[18][0] = 'S';
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  assert.equal(g.grid[19][0], 'S');
  assert.equal(g.grid[18][0], null);
});

test('four-line clear scores 800 x level', () => {
  const g = newGame();
  for (let r = 16; r < 20; r++) fillRow(g, r, [9]);
  g.active = { type: 'I', rot: 1, x: 7, y: 0 }; // vertical, column x + 2 = 9
  const before = g.score;
  g.hardDrop();
  assert.equal(g.lines, 4);
  assert.equal(g.score - before - 2 * 16, 800); // minus the hard-drop points
});

test('level rises every 10 lines and the piece falls faster', () => {
  const g = newGame();
  g.lines = 9;
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  assert.equal(g.level, 2);
  assert.ok(gravityInterval(2) < gravityInterval(1));
  assert.ok(gravityInterval(100) >= 30, 'speed has a floor');
});

test('hold: allowed once per piece, swaps with the stored piece', () => {
  const g = newGame();
  const first = g.active.type;
  assert.equal(g.holdPiece(), true);
  assert.equal(g.hold, first);
  assert.equal(g.holdPiece(), false, 'second hold on the same piece is refused');

  g.hardDrop(); // locking unlocks hold again
  const current = g.active.type;
  assert.equal(g.holdPiece(), true);
  assert.equal(g.active.type, first);
  assert.equal(g.hold, current);
});

test('gravity moves the piece down one row after one interval', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 0 };
  g.tick(gravityInterval(1) + 1);
  assert.equal(g.active.y, 1);
});

test('soft drop is faster than gravity and awards 1 point per row', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 0 };
  g.tick(200, true);
  assert.ok(g.active.y >= 3);
  assert.equal(g.score, g.active.y);
});

test('lock delay: a landed piece can still be moved before it locks', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 18 }; // resting on the floor
  assert.equal(g.grounded(), true);
  g.tick(LOCK_DELAY - 100);
  assert.ok(g.active, 'still active during the delay');
  g.move(1); // sliding resets the timer
  g.tick(LOCK_DELAY - 100);
  assert.ok(g.active, 'timer was reset by the move');
  g.tick(200);
  assert.equal(g.active.type === 'T' && g.active.y === 18, false, 'it locked and a new piece spawned');
});

test('lock delay cannot be stalled forever', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 18 };
  let locked = false;
  for (let i = 0; i < 60 && !locked; i++) {
    g.move(i % 2 === 0 ? 1 : -1);
    g.tick(LOCK_DELAY - 50);
    locked = !(g.active && g.active.y === 18 && g.active.type === 'T');
  }
  assert.equal(locked, true);
});

test('ghost piece lands where a hard drop would', () => {
  const g = newGame();
  g.active = { type: 'O', rot: 0, x: 4, y: 0 };
  assert.equal(g.ghostY(), ROWS - 2);
});

test('timer only advances through tick (so pausing stops it)', () => {
  const g = newGame();
  g.tick(1000);
  assert.equal(g.elapsedMs, 1000);
  // A paused scene simply does not call tick, so nothing changes.
  assert.equal(g.snapshot().timeMs, 1000);
});

test('game over when a new piece cannot spawn', () => {
  const g = newGame();
  let fired = false;
  g.onEvent = name => { if (name === 'gameover') fired = true; };
  for (let r = 0; r < 3; r++) fillRow(g, r, []);
  g.spawn('T');
  assert.equal(g.gameOver, true);
  assert.equal(fired, true);
  assert.equal(g.move(1), false, 'no actions after game over');
});

test('reset gives a completely fresh game', () => {
  const g = newGame();
  g.score = 999; g.lines = 12; g.level = 3; g.hold = 'I';
  fillRow(g, 19, []);
  g.gameOver = true;
  g.reset();
  assert.equal(g.score, 0);
  assert.equal(g.lines, 0);
  assert.equal(g.level, 1);
  assert.equal(g.hold, null);
  assert.equal(g.gameOver, false);
  assert.ok(g.grid.every(row => row.every(cell => cell === null)));
  assert.ok(g.active);
});


test('speed: level N is exactly N times as fast as level 1', () => {
  assert.equal(gravityInterval(1), 600);
  assert.equal(gravityInterval(2), 300);   // 2x
  assert.equal(gravityInterval(5), 120);   // 5x
  assert.equal(gravityInterval(10), 60);   // 10x
  for (let level = 1; level <= 20; level++) {
    assert.ok(Math.abs(speedMultiplier(level) - level) < 1e-9, `level ${level} is exactly ${level}x`);
  }
  for (let level = 2; level <= 20; level++) {
    assert.ok(gravityInterval(level) < gravityInterval(level - 1), `level ${level} is faster than ${level - 1}`);
  }
  assert.equal(gravityInterval(50), 30, 'the speed stops growing after level 20');
});

test('the speed really is used: a piece falls more rows per second at a higher level', () => {
  const rowsIn = (level, ms) => {
    const g = newGame();
    g.level = level;
    g.active = { type: 'T', rot: 0, x: 3, y: 0 };
    for (let i = 0; i < ms / 10; i++) g.tick(10);
    return g.active.y;
  };
  const level1 = rowsIn(1, 1000);
  assert.ok(rowsIn(2, 1000) >= level1 * 1.8, 'level 2 falls about twice as many rows per second');
  assert.ok(rowsIn(5, 1000) >= level1 * 4.5, 'level 5 falls about five times as many');
});

test('line clear gives the scene what it needs for the animation', () => {
  const g = newGame();
  let payload = null;
  g.onEvent = (name, data) => { if (name === 'clear') payload = data; };
  g.grid[17][0] = 'S';
  g.grid[18][1] = 'Z';
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  assert.deepEqual(payload.rows, [19]);
  assert.equal(payload.count, 1);
  assert.equal(payload.cleared[0].row, 19);
  assert.equal(payload.cleared[0].cells.filter(Boolean).length, 10, 'the full row is described');
  assert.equal(payload.drops[19], 1, 'the content now on row 19 fell 1 row');
  assert.equal(payload.drops[18], 1);
  assert.equal(payload.drops[0], 0);
  assert.equal(g.grid[19][1], 'Z');
});

test('multi-row clear: rows above fall by the number of rows cleared below them', () => {
  const g = newGame();
  let payload = null;
  g.onEvent = (name, data) => { if (name === 'clear') payload = data; };
  g.grid[16][0] = 'S';                // above everything
  fillRow(g, 17, [9]); g.grid[18][0] = 'O'; // row 18 is NOT full
  fillRow(g, 19, [9]);
  g.grid[18][9] = null;
  g.active = { type: 'I', rot: 1, x: 7, y: 0 };
  g.hardDrop();                       // fills column 9 down to the floor: rows 17 and 19 are now full
  assert.deepEqual(payload.rows, [17, 19]);
  assert.equal(g.grid[19][0], 'O', 'row 18 fell 1 row');
  assert.equal(payload.drops[19], 1);
  assert.equal(g.grid[18][0], 'S', 'row 16 fell 2 rows');
  assert.equal(payload.drops[18], 2);
});

test('NO input freeze after a line clear: the next piece moves immediately', () => {
  const g = newGame();
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  const x = g.active.x;
  assert.equal(g.move(-1), true, 'move works the instant after the clear');
  assert.equal(g.active.x, x - 1);
  assert.equal(g.rotate(1), true);
  const y = g.active.y;
  g.tick(gravityInterval(1) + 1);
  assert.equal(g.active.y, y + 1, 'gravity keeps running too');
});

test('levelup event reports the new level and speed', () => {
  const g = newGame();
  let info = null;
  g.onEvent = (name, data) => { if (name === 'levelup') info = data; };
  g.lines = 9;
  fillRow(g, 19, [3, 4, 5, 6]);
  g.active = { type: 'I', rot: 0, x: 3, y: 0 };
  g.hardDrop();
  assert.equal(info.level, 2);
  assert.equal(info.speed, 2, 'level 2 reports 2x speed');
});

test('softDropStep moves one row immediately and scores 1', () => {
  const g = newGame();
  g.active = { type: 'T', rot: 0, x: 3, y: 5 };
  assert.equal(g.softDropStep(), true);
  assert.equal(g.active.y, 6);
  assert.equal(g.score, 1);
  g.active.y = 18; // resting on the floor
  assert.equal(g.softDropStep(), false);
});
