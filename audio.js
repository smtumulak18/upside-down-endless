// audio.js
// All the sound for UPSIDE DOWN: ENDLESS. Everything lives in public/audio/.
//
//   MUSIC   (looping, fades)          intro.mp3  -> title intro + main menu
//                                      Kids.mp3   -> while you play
//   EFFECTS (instant, can overlap)    key_press.wav, shift.mp3, line_clear.wav, pause.wav
//
// Two separate volumes (Settings): music and sound effects. Both are saved in the browser.
//
// Browsers block sound until the player has clicked or pressed a key, so play() reports
// 'blocked' in that case instead of throwing (the intro shows a "click to enter" screen).

// ---------- Music ----------
const MUSIC = {
  intro: { src: 'audio/intro.mp3', volume: 0.7 },   // volume = how loud this track is at 100% on the slider
  game: { src: 'audio/Kids.mp3', volume: 0.55 }
};

// ---------- Sound effects ----------
//   rate: playback speed (2 = double speed, which is also one octave higher)
//   gain: loudness of this effect compared to the others
//   cut:  a new play stops the previous one (stops fast key presses piling up into noise)
const SFX = {
  key: { src: '/audio/key_press.wav', rate: 1, gain: 1, cut: true },
  shift: { src: '/audio/shift.mp3', rate: 1, gain: 1, cut: true },
  lineClear: { src: '/audio/line_clear.wav', rate: 2, gain: 1, cut: false },
  pause: { src: '/audio/pause.wav', rate: 1, gain: 1, cut: false }
};

const VOLUME_KEY = 'upside-down-endless-volumes';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

// ---------- Saved volumes ----------
function loadVolumes() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY));
    return {
      music: saved && 'music' in saved ? clamp01(saved.music) : 0.7,
      sfx: saved && 'sfx' in saved ? clamp01(saved.sfx) : 0.8
    };
  } catch {
    return { music: 0.7, sfx: 0.8 };
  }
}

function saveVolumes() {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ music: musicVolume, sfx: sfxVolume }));
  } catch {
    // Storage disabled: the volumes still work for this visit.
  }
}

let { music: musicVolume, sfx: sfxVolume } = loadVolumes();

export const getMusicVolume = () => musicVolume;
export const getSfxVolume = () => sfxVolume;

// =====================================================================================
// MUSIC
// =====================================================================================

const elements = {};            // track name -> <audio> element
const levels = {};              // track name -> fade level 0..1 (the real volume also uses the slider)
const failed = new Set();       // tracks whose file could not be loaded
const fadeTimers = new Map();   // track name -> running fade timer
let wanted = null;              // the track that should be playing right now

function getElement(name) {
  if (elements[name]) return elements[name];

  const track = MUSIC[name];
  if (!track) return null;

  const audio = new Audio(track.src);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.addEventListener('error', () => {
    failed.add(name);
    console.warn(`Could not load ${track.src}. Is the file inside public/audio/ ?`);
  });

  elements[name] = audio;
  levels[name] = 0;
  return audio;
}

// The volume you hear = fade level x track loudness x the Music slider.
function applyMusicVolume(name) {
  const audio = elements[name];
  if (audio) audio.volume = clamp01(levels[name] * MUSIC[name].volume * musicVolume);
}

// Smoothly move a track's fade level to a target (0 = silent, 1 = full).
function fade(name, to, ms, onDone) {
  if (!elements[name]) return;

  clearInterval(fadeTimers.get(name));
  fadeTimers.delete(name);

  if (ms <= 0) {
    levels[name] = clamp01(to);
    applyMusicVolume(name);
    if (onDone) onDone();
    return;
  }

  const from = levels[name];
  const startedAt = performance.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (performance.now() - startedAt) / ms);
    levels[name] = clamp01(from + (to - from) * t);
    applyMusicVolume(name);
    if (t >= 1) {
      clearInterval(timer);
      fadeTimers.delete(name);
      if (onDone) onDone();
    }
  }, 40);
  fadeTimers.set(name, timer);
}

/**
 * Start a track (looping). Resolves to:
 *   'playing'      it is playing now
 *   'blocked'      the browser needs a click / key press first
 *   'unavailable'  the file is missing or cannot be played
 */
export async function play(name, { fadeMs = 2000 } = {}) {
  const audio = getElement(name);
  if (!audio || failed.has(name)) return 'unavailable';

  wanted = name;

  if (!audio.paused) {
    fade(name, 1, fadeMs);
    return 'playing';
  }

  try {
    levels[name] = 0;
    applyMusicVolume(name);
    await audio.play();
    fade(name, 1, fadeMs);
    return 'playing';
  } catch (error) {
    return error && error.name === 'NotAllowedError' ? 'blocked' : 'unavailable';
  }
}

/** Start the same track again from the very beginning (it keeps looping). */
export async function restart(name, { fadeMs = 900 } = {}) {
  const audio = getElement(name);
  if (!audio || failed.has(name)) return 'unavailable';

  wanted = name;

  if (!audio.paused) {
    // A very quick fade-out so the restart does not click.
    await new Promise(resolve => fade(name, 0, 200, resolve));
  }

  try {
    audio.currentTime = 0;
  } catch {
    // Not ready yet: it will start from the beginning anyway.
  }
  return play(name, { fadeMs });
}

/** Fade a track out, then stop it. */
export function stop(name, { fadeMs = 800 } = {}) {
  const audio = elements[name];
  if (!audio) return;
  if (wanted === name) wanted = null;

  fade(name, 0, fadeMs, () => {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // ignore
    }
  });
}

/** Fade one track out while the next one fades in. */
export function crossfade(from, to, { fadeMs = 1200 } = {}) {
  stop(from, { fadeMs });
  return play(to, { fadeMs });
}

export function setMusicVolume(value) {
  musicVolume = clamp01(value);
  Object.keys(elements).forEach(applyMusicVolume);
  saveVolumes();
}

// =====================================================================================
// SOUND EFFECTS (Web Audio: starts instantly and can overlap)
// =====================================================================================

let context = null;
let sfxGain = null;
const buffers = {};             // effect name -> decoded sound
const loading = {};             // effect name -> loading promise
const failedSfx = new Set();
const voices = {};              // effect name -> the sound currently playing (for "cut")
const playedCount = {};         // for debugging

function getContext() {
  if (context) return context;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  context = new AudioContextClass({ latencyHint: 'interactive' });
  sfxGain = context.createGain();
  sfxGain.gain.value = sfxVolume;
  sfxGain.connect(context.destination);
  return context;
}

async function loadEffect(name) {
  if (buffers[name] || failedSfx.has(name)) return;
  if (loading[name]) return loading[name];

  const effect = SFX[name];
  loading[name] = (async () => {
    try {
      const response = await fetch(effect.src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      buffers[name] = await new Promise((resolve, reject) => {
        context.decodeAudioData(data, resolve, reject);
      });
    } catch {
      failedSfx.add(name);
      console.warn(`Could not load sound effect ${effect.src}. Is the file inside public/audio/ ?`);
    }
  })();
  return loading[name];
}

/**
 * Get the sound effects ready (call it after the player's first click or key press).
 * Safe to call many times.
 */
export async function prepareSfx() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Still blocked: the next click or key press will resume it.
    }
  }
  await Promise.all(Object.keys(SFX).map(loadEffect));
}

/** Play a sound effect right now. Returns true if it started. */
export function playSfx(name, { rate } = {}) {
  const effect = SFX[name];
  if (!effect || !context || !buffers[name] || sfxVolume <= 0) return false;

  if (context.state === 'suspended') context.resume().catch(() => {});

  if (effect.cut && voices[name]) {
    try {
      voices[name].stop();
    } catch {
      // already finished
    }
  }

  const source = context.createBufferSource();
  source.buffer = buffers[name];
  source.playbackRate.value = rate ?? effect.rate;

  const gain = context.createGain();
  gain.gain.value = effect.gain;
  source.connect(gain);
  gain.connect(sfxGain);

  source.start(0);
  voices[name] = source;
  source.onended = () => {
    if (voices[name] === source) voices[name] = null;
  };

  playedCount[name] = (playedCount[name] || 0) + 1;
  return true;
}

export function setSfxVolume(value) {
  sfxVolume = clamp01(value);
  if (sfxGain) sfxGain.gain.value = sfxVolume;
  saveVolumes();
}

// =====================================================================================
// Wiring
// =====================================================================================

// If something was blocked, start it on the player's first click or key press.
function onFirstGesture() {
  if (context && context.state === 'suspended') context.resume().catch(() => {});
  if (!wanted) return;
  const audio = elements[wanted];
  if (audio && audio.paused && !failed.has(wanted)) play(wanted);
}

window.addEventListener('pointerdown', onFirstGesture, true);
window.addEventListener('keydown', onFirstGesture, true);

// For debugging in the browser console.
export function getState() {
  const state = {
    wanted,
    musicVolume,
    sfxVolume,
    sfx: {
      context: context ? context.state : 'none',
      loaded: Object.keys(buffers),
      failed: [...failedSfx],
      played: { ...playedCount }
    }
  };
  for (const name of Object.keys(MUSIC)) {
    const audio = elements[name];
    state[name] = audio
      ? {
          paused: audio.paused,
          currentTime: Number(audio.currentTime.toFixed(2)),
          volume: Number(audio.volume.toFixed(3)),
          loop: audio.loop,
          failed: failed.has(name)
        }
      : null;
  }
  return state;
}