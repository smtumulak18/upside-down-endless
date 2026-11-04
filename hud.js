// hud.js
// Everything in the HTML panels around the board: stats, NEXT, HOLD, and the
// pause / game-over overlay. The Phaser scene calls these functions; this file
// never touches Phaser.

import { SHAPES } from './logic.js';

const $ = id => document.getElementById(id);

const els = {
  score: $('stat-score'),
  lines: $('stat-lines'),
  level: $('stat-level'),
  time: $('stat-time'),
  best: $('stat-best'),
  player: $('stat-player'),
  speed: $('stat-speed'),
  toast: $('toast'),
  countdown: $('countdown'),
  levelBox: $('stat-level-box'),
  hold: $('hold-slot'),
  next: [...document.querySelectorAll('[data-next]')],
  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  overlayDetail: $('overlay-detail'),
  overlayActions: $('overlay-actions')
};

let tileImages = {};          // { I: 'data:image/png;base64,...', ... }
let actionHandler = () => {}; // set by the scene
const cache = {};             // last values written, so we only touch the DOM on change

export function onAction(fn) {
  actionHandler = fn;
}

export function setTileImages(images) {
  tileImages = images;
  // Force previews to redraw with the real artwork.
  [els.hold, ...els.next].forEach(slot => { slot.dataset.type = '?'; });
}

function setText(key, el, value) {
  if (cache[key] === value) return;
  cache[key] = value;
  el.textContent = value;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

const pad6 = n => String(n).padStart(6, '0');

// Draw one piece into a preview slot using the same tile artwork as the board.
function drawPreview(slot, type) {
  const key = type ?? '';
  if (slot.dataset.type === key) return;
  slot.dataset.type = key;
  slot.replaceChildren();
  slot.classList.toggle('empty', !type);
  if (!type) return;

  const cells = SHAPES[type][0];
  const xs = cells.map(c => c[0]);
  const ys = cells.map(c => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;

  const mini = document.createElement('div');
  mini.className = 'mini';
  mini.style.width = `calc(${w} * var(--mini))`;
  mini.style.height = `calc(${h} * var(--mini))`;

  for (const [x, y] of cells) {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.style.left = `calc(${x - minX} * var(--mini))`;
    cell.style.top = `calc(${y - minY} * var(--mini))`;
    if (tileImages[type]) cell.style.backgroundImage = `url(${tileImages[type]})`;
    mini.appendChild(cell);
  }
  slot.appendChild(mini);
}

// state = game.snapshot() plus { best }
export function update(state) {
  setText('score', els.score, pad6(state.score));
  setText('lines', els.lines, String(state.lines));
  setText('level', els.level, String(state.level));
  setText('time', els.time, formatTime(state.timeMs));
  setText('best', els.best, pad6(state.best));
  if (els.speed) setText('speed', els.speed, `SPEED ×${state.speed.toFixed(1)}`);

  state.next.forEach((type, i) => {
    if (els.next[i]) drawPreview(els.next[i], type);
  });

  drawPreview(els.hold, state.hold);
  els.hold.classList.toggle('used', state.holdUsed);
}

export function setPlayer(name) {
  if (els.player) els.player.textContent = name || '—';
}

// A short message in the middle of the board (level up, big clears).
export function toast(text, tone = 'info') {
  if (!els.toast) return;
  els.toast.textContent = text;
  els.toast.dataset.tone = tone;
  els.toast.classList.remove('show');
  void els.toast.offsetWidth; // restart the CSS animation
  els.toast.classList.add('show');
}

// The big 3 - 2 - 1 - GO! in the middle of the board. kind: 'tick' (numbers) or 'go'.
export function countdown(text, kind = 'tick') {
  if (!els.countdown) return;
  els.countdown.textContent = text;
  els.countdown.className = 'countdown';
  void els.countdown.offsetWidth; // restart the CSS animation
  els.countdown.classList.add(kind);
}

export function clearCountdown() {
  if (!els.countdown) return;
  els.countdown.className = 'countdown';
  els.countdown.textContent = '';
}

export function pulse(name) {
  const el = name === 'level' ? els.levelBox : null;
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('pulse');
}

// ----- Pause / game-over overlay -----
// options: { title, detail, tone: 'pause' | 'danger', buttons: [{ label, action }] }
export function showOverlay({ title, detail = '', tone = 'pause', buttons = [] }) {
  els.overlayTitle.textContent = title;
  els.overlayDetail.textContent = detail;
  els.overlay.dataset.tone = tone;
  els.overlayActions.replaceChildren();

  buttons.forEach(({ label, action }, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = index === 0 ? 'btn primary' : 'btn';
    btn.addEventListener('click', () => {
      btn.blur(); // keep Space / Enter from "clicking" it again during play
      actionHandler(action);
    });
    els.overlayActions.appendChild(btn);
  });

  els.overlay.hidden = false;
}

export function hideOverlay() {
  els.overlay.hidden = true;
  els.overlayActions.replaceChildren();
}