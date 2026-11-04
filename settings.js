// settings.js
// The Settings button (top-right) and its dialog:
//   SOUND EFFECTS volume, MUSIC volume, ABOUT, QUIT.
// DOM only. The game tells it what to do through initSettings(...).

import * as audio from './audio.js';

const $ = id => document.getElementById(id);

const els = {
  button: $('settings-button'),
  dialog: $('settings'),
  views: {
    main: $('settings-main'),
    about: $('settings-about-view'),
    quit: $('settings-quit-view')
  },
  sfxSlider: $('sfx-slider'),
  sfxValue: $('sfx-value'),
  musicSlider: $('music-slider'),
  musicValue: $('music-value'),
  aboutButton: $('settings-about'),
  quitButton: $('settings-quit'),
  closeButton: $('settings-close'),
  aboutBack: $('about-back'),
  quitConfirm: $('quit-confirm'),
  quitCancel: $('quit-cancel')
};

let handlers = {
  onOpen() {},               // the dialog opened (the game pauses)
  onClose() {},              // the dialog closed (the game continues)
  onQuit() {},               // the player confirmed QUIT
  canQuit: () => false       // QUIT only works while a run is in progress
};

let open = false;
let view = 'main';

export const isSettingsOpen = () => open;

/** Show or hide the gear button (it stays hidden during the intro). */
export function showSettingsButton(visible = true) {
  els.button.hidden = !visible;
}

function showView(name) {
  view = name;
  for (const [key, element] of Object.entries(els.views)) {
    element.hidden = key !== name;
  }

  // Put the keyboard focus on something sensible in each view.
  const focusTarget = {
    main: els.sfxSlider,
    about: els.aboutBack,
    quit: els.quitCancel
  }[name];
  if (focusTarget) focusTarget.focus();
}

function syncSliders() {
  const sfx = Math.round(audio.getSfxVolume() * 100);
  const music = Math.round(audio.getMusicVolume() * 100);
  els.sfxSlider.value = sfx;
  els.musicSlider.value = music;
  els.sfxValue.textContent = `${sfx}%`;
  els.musicValue.textContent = `${music}%`;
}

export function openSettings() {
  if (open) return;
  open = true;

  syncSliders();

  const quitAllowed = handlers.canQuit();
  els.quitButton.disabled = !quitAllowed;
  els.quitButton.title = quitAllowed ? '' : 'You are already at the main menu';

  els.dialog.hidden = false;
  handlers.onOpen();
  showView('main');
}

export function closeSettings() {
  if (!open) return;
  open = false;
  els.dialog.hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  handlers.onClose();
}

// Keep Tab inside the dialog while it is open.
function trapTab(event) {
  const panel = els.views[view];
  const focusable = [...panel.querySelectorAll('input, button:not([disabled])')];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function initSettings(options) {
  handlers = { ...handlers, ...options };
  syncSliders();

  // Gear button
  els.button.addEventListener('click', () => {
    if (open) closeSettings();
    else openSettings();
    els.button.blur(); // so Space / Enter keep going to the game
  });

  // Volume sliders: changes are heard immediately and saved.
  els.sfxSlider.addEventListener('input', () => {
    const value = Number(els.sfxSlider.value);
    audio.setSfxVolume(value / 100);
    els.sfxValue.textContent = `${value}%`;
  });
  els.sfxSlider.addEventListener('change', () => audio.playSfx('key')); // a sample when you let go

  els.musicSlider.addEventListener('input', () => {
    const value = Number(els.musicSlider.value);
    audio.setMusicVolume(value / 100);
    els.musicValue.textContent = `${value}%`;
  });

  // Buttons
  els.closeButton.addEventListener('click', closeSettings);
  els.aboutButton.addEventListener('click', () => showView('about'));
  els.aboutBack.addEventListener('click', () => showView('main'));
  els.quitButton.addEventListener('click', () => showView('quit'));
  els.quitCancel.addEventListener('click', () => showView('main'));
  els.quitConfirm.addEventListener('click', () => {
    closeSettings();
    handlers.onQuit();
  });

  // Clicking the dark area around the panel closes it.
  els.dialog.addEventListener('pointerdown', event => {
    if (event.target === els.dialog) closeSettings();
  });

  // Keys inside the dialog: Esc goes back / closes, Tab stays inside.
  // They never reach the game.
  ['keydown', 'keyup'].forEach(type => {
    els.dialog.addEventListener(type, event => {
      event.stopPropagation();
      if (type !== 'keydown') return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (view === 'main') closeSettings();
        else showView('main');
      } else if (event.key === 'Tab') {
        trapTab(event);
      }
    });
  });
}
