// game.js
// Phaser scene for UPSIDE DOWN: ENDLESS.
//   - DRAWS the board (and the line-clear effect)
//   - READS the keyboard (directly, the instant a key is pressed) and plays the key sounds
//   - runs the flow: intro -> main menu -> playing  (+ pause, settings, quit)
// All rules (movement, rotation, scoring, speed, line clears...) live in logic.js.

import Phaser from 'phaser';
import './background.js';
import { TetrisGame, COLS, ROWS, SHAPES } from './logic.js';
import * as hud from './hud.js';
import { playIntro } from './intro.js';
import * as audio from './audio.js';
import { openMenu, focusMenu, loadPlayerName } from './menu.js';
import { initSettings, showSettingsButton } from './settings.js';

// ---------- Layout ----------
const CELL = 64;                 // one board cell in canvas pixels (the page scales the canvas down)
const BOARD_W = COLS * CELL;     // 640
const BOARD_H = ROWS * CELL;     // 1280
const TILE_SIZE = CELL - 4;      // leaves a small gap so tiles read as separate blocks

// ---------- Feel (tune these while play-testing) ----------
// Left/right: a key press moves ONE block. Only if you keep holding it for longer than
// DAS_DELAY does it start sliding (one block every ARR_DELAY).
//   press held under ~220 ms -> 1 block   |   300 ms -> 3 blocks   |   500 ms -> 10 blocks
// If a quick press still moves 2 blocks, raise DAS_DELAY. If sliding feels slow, lower ARR_DELAY.
const DAS_DELAY = 220;           // ms you hold left/right before auto-repeat starts
const ARR_DELAY = 30;            // ms between repeated moves (lower = faster slide)

// ---------- Game start: panels fade in, then 3 - 2 - 1 ----------
const REVEAL_WAIT_MS = 1300;     // wait for the panels to finish fading in
const COUNT_STEP_MS = 1000;      // 3... 2... 1...

// ---------- Line-clear effect (all in ms) ----------
const FLASH_MS = 55;             // one flash step; the row blinks twice
const DISSOLVE_DELAY = 130;      // the tiles start dissolving after the flashes...
const DISSOLVE_MS = 300;         // ...and take this long to fade away
const COLLAPSE_DELAY = 200;      // the stack above starts falling into the gap...
const COLLAPSE_MS = 230;         // ...and takes this long

const BEST_KEY = 'upside-down-endless-best';

// One entry per piece type. Each uses its own PNG from public/tiles/.
// To change a tile's artwork later, just point `file` at a different image.
// `color` is used for the little pieces that fly off when a line is cleared.
const TILES = {
  I: { key: 'tile-walkie',   file: 'tiles/cyan_walkie_talkie.png',    color: 0x08c9ed },  // cyan
  O: { key: 'tile-waffle',   file: 'tiles/eggo_waffle.png',           color: 0xffcf38 },  // golden yellow
  T: { key: 'tile-cassette', file: 'tiles/max_music_cassette.png',    color: 0xc34cff },  // purple
  S: { key: 'tile-cap',      file: 'tiles/green_trucker_cap.png',     color: 0x49e37e },  // green
  Z: { key: 'tile-bat',      file: 'tiles/barbed_baseball_bat.png',   color: 0xff4b59 },  // crimson red
  J: { key: 'tile-car',      file: 'tiles/vintage_blue_car.png',      color: 0x438cff },  // electric blue
  L: { key: 'tile-ahoy',     file: 'tiles/ahoy_sailor_cap.png',       color: 0xff963a }   // orange
};

// ---------- Personal best (saved in the browser) ----------
function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Private mode or storage disabled: the game still works, the best just isn't saved.
  }
}

const pad6 = n => String(n).padStart(6, '0');
const rand = (min, max) => min + Math.random() * (max - min);

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  // Phaser calls preload() first and waits until every file below has loaded.
  preload() {
    this.load.on('loaderror', file => {
      console.error(`Could not load ${file.src}. Is it inside public/tiles/ ?`);
    });

    for (const tile of Object.values(TILES)) {
      this.load.image(tile.key, tile.file);
    }
  }

  create() {
    hud.setTileImages(this.getTileImages());

    this.drawBoardBackground();
    this.createSprites();

    this.best = loadBest();
    this.paused = false;
    this.settingsOpen = false;
    this.fx = new Set();       // line-clear effect objects that are on screen
    this.fall = null;          // the "stack drops into the gap" animation
    this.held = { left: false, right: false, down: false };
    this.lastHorizontal = 0;
    this.resetDas();

    // NOTE: don't call this `this.game` - Phaser already uses that name.
    this.tetris = new TetrisGame({
      onEvent: (name, data) => this.onGameEvent(name, data)
    });

    this.setupInput();
    this.setupFpsCounter();

    hud.onAction(action => {
      if (action === 'resume') this.togglePause();
      if (action === 'restart') this.restart();
    });

    // Settings: opening it pauses the game; QUIT goes back to the main menu.
    initSettings({
      onOpen: () => {
        this.settingsOpen = true;
        this.releaseKeys();
        if (this.phase === 'playing' && !this.tetris.gameOver) this.setPaused(true, { sound: false });
        this.updateFrozen();
      },
      onClose: () => {
        this.settingsOpen = false;
        this.updateFrozen();
      },
      onQuit: () => this.quitToMenu(),
      canQuit: () => this.phase === 'playing' || this.phase === 'countdown'
    });

    // Auto-pause when the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'playing' && !this.tetris.gameOver) {
        this.setPaused(true, { sound: false });
      }
    });

    // The game waits while the title intro and the pop-up menu are on screen.
    //   'intro' -> 'menu' -> 'countdown' (3-2-1) -> 'playing'
    // Until PLAY GAME is pressed, only the title is visible (the "pregame" class hides the panels).
    this.phase = 'intro';
    this.countdownMs = 0;
    this.countdownShown = null;
    document.body.classList.add('pregame');
    this.playerName = loadPlayerName();
    hud.setPlayer(this.playerName);

    playIntro({
      // intro.mp3 starts with the intro...
      startMusic: () => audio.play('intro'),

      // ...and the moment the player clicks or presses a key, it starts again from the
      // beginning, the Settings button appears, and the main menu opens in the game panel.
      onSkip: () => {
        audio.prepareSfx();            // that click / key press unlocks the sound effects
        audio.restart('intro');
        showSettingsButton(true);
        this.phase = 'menu';
        openMenu().then(name => this.startRun(name));
      }
    }).then(() => {
      // The intro has finished fading out: put the cursor in the name box.
      focusMenu();
    });

    this.syncHud();
    this.render();
  }

  // ---------- Setup ----------

  // The HTML panels (NEXT / HOLD) reuse the exact same tile images.
  getTileImages() {
    const images = {};
    for (const [type, tile] of Object.entries(TILES)) {
      images[type] = tile.file;
    }
    return images;
  }

  drawBoardBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x050a18, 1);
    g.fillRect(0, 0, BOARD_W, BOARD_H);

    g.lineStyle(2, 0x24416b, 0.55);
    for (let c = 1; c < COLS; c++) {
      g.lineBetween(c * CELL, 0, c * CELL, BOARD_H);
    }
    for (let r = 1; r < ROWS; r++) {
      g.lineBetween(0, r * CELL, BOARD_W, r * CELL);
    }
  }

  // Sprites are created ONCE and reused every frame (no creating/destroying).
  createSprites() {
    this.cellSprites = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const sprite = this.add
          .image(c * CELL + CELL / 2, r * CELL + CELL / 2, TILES.I.key)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(1)
          .setVisible(false);
        row.push(sprite);
      }
      this.cellSprites.push(row);
    }

    this.ghostSprites = [];
    this.activeSprites = [];
    for (let i = 0; i < 4; i++) {
      this.ghostSprites.push(
        this.add.image(0, 0, TILES.I.key)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(2)
          .setAlpha(0.28)
          .setVisible(false)
      );
      this.activeSprites.push(
        this.add.image(0, 0, TILES.I.key)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(3)
          .setVisible(false)
      );
    }
  }

  // Optional: add ?fps to the address to see the frame rate in the corner.
  setupFpsCounter() {
    if (!new URLSearchParams(window.location.search).has('fps')) return;

    const label = document.createElement('div');
    label.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2000;padding:4px 8px;font:12px monospace;' +
      'color:#54e9ff;background:#000a;border-radius:6px;pointer-events:none';
    document.body.appendChild(label);
    this.fpsLabel = label;
    this.fpsNextUpdate = 0;
  }

  // ---------- Keyboard ----------
  // Keys are handled the instant they are pressed (not once per frame), so there is no
  // waiting for the next frame. Holding left/right/down repeats from update().

  setupInput() {
    window.addEventListener('keydown', event => this.handleKeyDown(event));
    window.addEventListener('keyup', event => this.handleKeyUp(event));
    window.addEventListener('blur', () => this.releaseKeys()); // never leave a key "stuck"
  }

  handleKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;   // browser shortcuts
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;   // typing
    if (this.phase !== 'playing' || this.settingsOpen) return;

    const g = this.tetris;
    const code = event.code;

    // P (or Esc) pauses and resumes. It also works while paused.
    if (code === 'KeyP' || code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.togglePause();
      return;
    }

    if (code === 'KeyR') {
      if (!event.repeat && (g.gameOver || this.paused)) this.restart();
      return;
    }

    if (this.paused || g.gameOver) return;

    const gameKeys = [
      'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp',
      'KeyX', 'KeyZ', 'Space', 'ShiftLeft', 'ShiftRight'
    ];
    if (!gameKeys.includes(code)) return;

    event.preventDefault();          // no page scrolling, no button "clicks"
    if (event.repeat) return;        // we do our own repeating (see handleHorizontal / tick)

    switch (code) {
      case 'ArrowLeft':
        this.pressHorizontal(-1);
        audio.playSfx('key');
        break;
      case 'ArrowRight':
        this.pressHorizontal(1);
        audio.playSfx('key');
        break;
      case 'ArrowDown':
        this.held.down = true;
        g.softDropStep();            // one row immediately, then it keeps going while held
        audio.playSfx('key');
        break;
      case 'ArrowUp':
      case 'KeyX':
        g.rotate(1);
        audio.playSfx('key');
        break;
      case 'KeyZ':
        g.rotate(-1);
        audio.playSfx('key');
        break;
      case 'Space':
        g.hardDrop();
        audio.playSfx('key');
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        g.holdPiece();
        audio.playSfx('shift');
        break;
      default:
        break;
    }
  }

  handleKeyUp(event) {
    if (event.code === 'ArrowLeft') this.held.left = false;
    if (event.code === 'ArrowRight') this.held.right = false;
    if (event.code === 'ArrowDown') this.held.down = false;
  }

  releaseKeys() {
    this.held.left = false;
    this.held.right = false;
    this.held.down = false;
    this.resetDas();
  }

  resetDas() {
    this.das = { dir: 0, held: 0, repeating: false, repeatTimer: 0 };
  }

  // A fresh left/right press: move right now, then wait DAS_DELAY before repeating.
  pressHorizontal(dir) {
    if (dir < 0) this.held.left = true;
    else this.held.right = true;
    this.lastHorizontal = dir;

    this.resetDas();
    this.das.dir = dir;
    this.tetris.move(dir);
  }

  currentHorizontal() {
    const { left, right } = this.held;
    if (left && right) return this.lastHorizontal;   // the key pressed last wins
    if (left) return -1;
    if (right) return 1;
    return 0;
  }

  // Auto-repeat while left/right is held: wait DAS_DELAY ms, then one cell every ARR_DELAY ms.
  handleHorizontal(dt) {
    const dir = this.currentHorizontal();

    if (dir === 0) {
      this.resetDas();
      return;
    }

    // Always work on the CURRENT state object (resetDas() replaces it).
    if (dir !== this.das.dir) {       // e.g. you let go of one direction but still hold the other
      this.resetDas();
      this.das.dir = dir;
      return;
    }

    const das = this.das;
    das.held += dt;

    if (!das.repeating && das.held >= DAS_DELAY) {
      das.repeating = true;
      das.repeatTimer = 0;
    }

    if (das.repeating) {
      das.repeatTimer += dt;
      while (das.repeatTimer >= ARR_DELAY) {
        this.tetris.move(dir);
        das.repeatTimer -= ARR_DELAY;
      }
    }
  }

  // ---------- Game loop ----------

  update(time, delta) {
    const dt = Math.min(delta, 100); // ignore huge gaps (tab switches, lag spikes)

    if (this.phase === 'countdown' && !this.settingsOpen) this.runCountdown(dt);

    if (this.phase === 'playing' && !this.paused && !this.settingsOpen && !this.tetris.gameOver) {
      this.handleHorizontal(dt);
      this.tetris.tick(dt, this.held.down);   // gravity (gets faster every level) + soft drop
    }

    this.syncHud();
    this.render();

    if (this.fpsLabel && time >= this.fpsNextUpdate) {
      this.fpsNextUpdate = time + 500;
      this.fpsLabel.textContent = `${this.game.loop.actualFps.toFixed(0)} fps`;
    }
  }

  // ---------- Countdown ----------
  // After PLAY GAME: wait for the panels to fade in, show 3, 2, 1, then GO! and the game runs.
  runCountdown(dt) {
    this.countdownMs += dt;
    const t = this.countdownMs - REVEAL_WAIT_MS;
    if (t < 0) return;

    const number = 3 - Math.floor(t / COUNT_STEP_MS);
    if (number >= 1) {
      if (this.countdownShown !== number) {
        this.countdownShown = number;
        hud.countdown(String(number));
      }
      return;
    }

    hud.countdown('GO!', 'go');
    this.phase = 'playing';
  }

  // ---------- Events from logic.js ----------

  onGameEvent(name, data) {
    switch (name) {
      case 'clear':
        this.playClearEffect(data);
        audio.playSfx('lineClear');          // line_clear.wav, at double speed
        if (data.count >= 4) hud.toast('TETRIS!', 'hot');
        break;

      case 'levelup':
        hud.pulse('level');
        hud.toast(`LEVEL ${data.level}\nSPEED ×${+data.speed.toFixed(1)}`);
        break;

      case 'gameover':
        this.handleGameOver(data);
        break;

      default:
        // 'move', 'rotate', 'harddrop', 'hold', 'lock'
        break;
    }
  }

  // ---------- Line-clear effect: flash, dissolve, collapse ----------
  // The rules already removed the rows and spawned the next piece, so the player keeps
  // playing with no pause. This only decides how it LOOKS.

  playClearEffect({ cleared, drops, count }) {
    // If an earlier collapse is still animating, finish it first.
    this.finishFall();

    // 1. The stack above the cleared rows starts where it was, then drops into the gap.
    this.fall = { drops, progress: 0 };
    this.tweens.add({
      targets: this.fall,
      progress: 1,
      delay: COLLAPSE_DELAY,
      duration: COLLAPSE_MS,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.fall = null;
      }
    });

    for (const { row, cells } of cleared) {
      const y = row * CELL + CELL / 2;

      // 2. FLASH: a bright bar blinks twice over the row.
      const flash = this.add
        .rectangle(BOARD_W / 2, y, BOARD_W, CELL, 0xffffff, 1)
        .setDepth(10)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.fx.add(flash);
      this.tweens.add({
        targets: flash,
        alpha: 0.95,
        duration: FLASH_MS,
        yoyo: true,
        repeat: 1,
        onComplete: () => this.disposeFx(flash)
      });

      cells.forEach((type, col) => {
        if (!type) return;
        const x = col * CELL + CELL / 2;
        const delay = DISSOLVE_DELAY + Math.random() * 110;

        // 3. DISSOLVE: a copy of the tile swells, drifts up and fades out...
        const tile = this.add
          .image(x, y, TILES[type].key)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(8);
        this.fx.add(tile);
        const sx = tile.scaleX;
        const sy = tile.scaleY;
        this.tweens.add({
          targets: tile,
          delay,
          duration: DISSOLVE_MS,
          alpha: 0,
          scaleX: sx * 1.35,
          scaleY: sy * 1.35,
          y: y - rand(10, 26),
          angle: rand(-18, 18),
          ease: 'Quad.easeOut',
          onComplete: () => this.disposeFx(tile)
        });

        // ...and breaks into little pieces in the tile's colour.
        for (let i = 0; i < 4; i++) {
          const size = rand(10, 20);
          const shard = this.add
            .rectangle(x + rand(-18, 18), y + rand(-18, 18), size, size, TILES[type].color, 1)
            .setDepth(9);
          this.fx.add(shard);

          const direction = rand(0, Math.PI * 2);
          const distance = rand(40, 130);
          this.tweens.add({
            targets: shard,
            delay: delay * 0.7,
            duration: rand(380, 580),
            x: shard.x + Math.cos(direction) * distance,
            y: shard.y + Math.sin(direction) * distance - 24,
            alpha: 0,
            scale: 0.2,
            angle: rand(-200, 200),
            ease: 'Cubic.easeOut',
            onComplete: () => this.disposeFx(shard)
          });
        }
      });
    }

    // 4. A little screen shake for bigger clears.
    if (count >= 4) this.cameras.main.shake(220, 0.006);
    else if (count >= 2) this.cameras.main.shake(120, 0.003);
  }

  disposeFx(object) {
    if (!this.fx.has(object)) return;
    this.fx.delete(object);
    object.destroy();
  }

  finishFall() {
    if (!this.fall) return;
    this.tweens.killTweensOf(this.fall);
    this.fall = null;
  }

  // Remove every effect object right away (restart, quit).
  clearEffects() {
    this.finishFall();
    for (const object of this.fx) {
      this.tweens.killTweensOf(object);
      object.destroy();
    }
    this.fx.clear();
    if (this.cameras.main.resetFX) this.cameras.main.resetFX();
  }

  // ---------- Pause, settings, restart, quit ----------

  // The effects freeze while the game is paused or Settings is open.
  updateFrozen() {
    if (this.paused || this.settingsOpen) this.tweens.pauseAll();
    else this.tweens.resumeAll();
  }

  setPaused(value, { sound = true } = {}) {
    if (this.paused === value) return;
    this.paused = value;

    if (sound) audio.playSfx('pause');      // pause.wav (on pause AND on resume)
    this.releaseKeys();
    this.updateFrozen();

    if (value) {
      hud.showOverlay({
        title: 'PAUSED',
        detail: 'PRESS P TO RESUME',
        tone: 'pause',
        buttons: [
          { label: 'RESUME', action: 'resume' },
          { label: 'RESTART', action: 'restart' }
        ]
      });
    } else {
      hud.hideOverlay();
    }
  }

  togglePause() {
    if (this.phase !== 'playing' || this.tetris.gameOver) return;
    this.setPaused(!this.paused);
  }

  handleGameOver({ score, lines, level }) {
    const isNewBest = score > this.best;
    if (isNewBest) {
      this.best = score;
      saveBest(score);
    }

    hud.showOverlay({
      title: 'STACK FULL',
      detail:
        `${this.playerName ? this.playerName.toUpperCase() + '\n' : ''}` +
        `SCORE ${pad6(score)}  ·  LINES ${lines}  ·  LEVEL ${level}` +
        (isNewBest ? '\nNEW PERSONAL BEST' : ''),
      tone: 'danger',
      buttons: [{ label: 'RESTART (R)', action: 'restart' }]
    });
  }

  // Called when the player clicks START GAME in the main menu.
  startRun(name) {
    this.playerName = name;
    hud.setPlayer(name);

    audio.prepareSfx();                  // the click unlocks the sound effects
    audio.crossfade('intro', 'game');    // intro.mp3 fades out, Kids.mp3 fades in (both loop)

    this.restart();                      // fresh board, score 0, timer 0

    // The panels fade + scale in, then the countdown runs (see runCountdown).
    document.body.classList.remove('pregame');
    this.countdownMs = 0;
    this.countdownShown = null;
    this.phase = 'countdown';
  }

  restart() {
    hud.clearCountdown();
    this.clearEffects();
    this.tetris.reset();
    this.paused = false;
    this.releaseKeys();
    hud.hideOverlay();
    this.updateFrozen();
  }

  // Settings -> QUIT: leave the run and go back to the main menu.
  quitToMenu() {
    this.restart();
    document.body.classList.add('pregame');   // the panels fade away; only the title + pop-up remain
    this.phase = 'menu';
    audio.crossfade('game', 'intro');
    openMenu({ step: 'start', name: this.playerName }).then(name => this.startRun(name));
    focusMenu();
  }

  // ---------- Drawing ----------

  syncHud() {
    hud.update({
      ...this.tetris.snapshot(),
      best: Math.max(this.best, this.tetris.score)
    });
  }

  render() {
    const g = this.tetris;
    const fall = this.fall;

    // Locked blocks (they slide down into place while a cleared line collapses).
    for (let r = 0; r < ROWS; r++) {
      const offset = fall ? -fall.drops[r] * CELL * (1 - fall.progress) : 0;

      for (let c = 0; c < COLS; c++) {
        const type = g.grid[r][c];
        const sprite = this.cellSprites[r][c];

        if (!type) {
          if (sprite.visible) sprite.setVisible(false);
          continue;
        }
        const key = TILES[type].key;
        if (sprite.texture.key !== key) sprite.setTexture(key);
        sprite.y = r * CELL + CELL / 2 + offset;
        if (!sprite.visible) sprite.setVisible(true);
      }
    }

    // Active piece and its ghost.
    const piece = g.active;
    if (!piece || this.phase === 'countdown') {
      this.activeSprites.forEach(s => s.setVisible(false));
      this.ghostSprites.forEach(s => s.setVisible(false));
      return;
    }

    const key = TILES[piece.type].key;
    const ghostY = g.ghostY();
    const showGhost = ghostY !== piece.y;

    SHAPES[piece.type][piece.rot].forEach(([cx, cy], i) => {
      const x = (piece.x + cx) * CELL + CELL / 2;

      const active = this.activeSprites[i];
      const ay = piece.y + cy;
      if (active.texture.key !== key) active.setTexture(key);
      active.setPosition(x, ay * CELL + CELL / 2).setVisible(ay >= 0);

      const ghost = this.ghostSprites[i];
      const gy = ghostY + cy;
      if (ghost.texture.key !== key) ghost.setTexture(key);
      ghost.setPosition(x, gy * CELL + CELL / 2).setVisible(showGhost && gy >= 0);
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: BOARD_W,
  height: BOARD_H,
  backgroundColor: '#050a18',
  antialias: true,
  render: { powerPreference: 'high-performance' },
  input: { keyboard: false },      // keys are handled directly in this file (faster)
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: GameScene
});