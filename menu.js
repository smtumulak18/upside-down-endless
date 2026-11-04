// menu.js
// The main menu that appears inside the game panel after the intro:
//   step 1: "ENTER YOUR NAME"  ->  step 2: "WELCOME, NAME"  ->  START GAME
// It can be opened again later (Settings -> Quit goes back to step 2).
// DOM only; it never touches Phaser.

const $ = id => document.getElementById(id);

const els = {
  menu: $('menu'),
  stepName: $('menu-step-name'),
  stepStart: $('menu-step-start'),
  input: $('menu-name'),
  error: $('menu-error'),
  continueButton: $('menu-continue'),
  welcome: $('menu-welcome'),
  startButton: $('menu-start'),
  changeButton: $('menu-change')
};

const NAME_KEY = 'upside-down-endless-player';
const MAX_NAME_LENGTH = 12;

export function loadPlayerName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage disabled: the name still works for this visit.
  }
}

// Keep letters, numbers, spaces and a few symbols; trim and limit the length.
function cleanName(raw) {
  return String(raw)
    .normalize()
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

let currentStep = 'name';
let resolveStart = null;   // set while the menu is waiting for START GAME
let wired = false;
let hideTimer = null;      // hides the pop-up after its fade-out animation

function showStep(step) {
  currentStep = step;
  els.stepName.hidden = step !== 'name';
  els.stepStart.hidden = step !== 'start';
  focusMenu();
}

/** Put the keyboard focus on the main control of the current step. */
export function focusMenu() {
  if (els.menu.hidden) return;
  if (currentStep === 'name') {
    els.input.focus();
    els.input.select();
  } else {
    els.startButton.focus();
  }
}

export const isMenuOpen = () => !els.menu.hidden;

function submitName() {
  const name = cleanName(els.input.value);
  if (!name) {
    els.error.hidden = false;
    els.input.focus();
    return;
  }
  els.error.hidden = true;
  els.input.value = name;
  savePlayerName(name);
  els.welcome.textContent = name;
  showStep('start');
}

// Attach every listener ONCE (openMenu can be called many times).
function wire() {
  if (wired) return;
  wired = true;

  els.continueButton.addEventListener('click', submitName);

  els.input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitName();
    }
  });
  els.input.addEventListener('input', () => {
    els.error.hidden = true;
  });

  els.changeButton.addEventListener('click', () => showStep('name'));

  els.startButton.addEventListener('click', () => {
    els.startButton.blur();

    // The pop-up fades and shrinks away while the game panels fade in behind it.
    els.menu.classList.add('closing');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      els.menu.hidden = true;
      els.menu.classList.remove('closing');
    }, 360);

    const done = resolveStart;
    resolveStart = null;
    if (done) done(cleanName(els.input.value));
  });

  // Typing and pressing Space / Enter in the menu must never reach the game's keyboard
  // handler (it would block spaces in the name and could trigger game actions).
  ['keydown', 'keyup'].forEach(type => {
    els.menu.addEventListener(type, event => event.stopPropagation());
  });
}

/**
 * Show the menu. Resolves with the player's name once START GAME is clicked.
 *   step: 'name'  -> start by asking for the name
 *         'start' -> jump straight to "WELCOME, NAME / START GAME" (needs a name)
 *   name: use this name instead of the saved one
 */
export function openMenu({ step = 'name', name } = {}) {
  wire();

  return new Promise(resolve => {
    resolveStart = resolve;

    clearTimeout(hideTimer);
    els.menu.classList.remove('closing');

    els.input.value = name ?? loadPlayerName();
    els.error.hidden = true;
    els.menu.hidden = false;

    const known = cleanName(els.input.value);
    if (step === 'start' && known) {
      els.welcome.textContent = known;
      currentStep = 'start';
      els.stepName.hidden = true;
      els.stepStart.hidden = false;
    } else {
      currentStep = 'name';
      els.stepName.hidden = false;
      els.stepStart.hidden = true;
    }
  });
}