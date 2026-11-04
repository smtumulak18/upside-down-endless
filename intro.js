// intro.js
// Title-sequence intro shown when the game opens:
//   black screen -> the camera very slowly pulls back -> outlined letters glow in and drift
//   into place -> the bars + "WELCOME TO" appear -> after 40 seconds the title glows slowly.
//
// It never disappears by itself. Click or press any key and it fades out from the
// edges toward the centre.
//
// Usage:
//   playIntro({
//     startMusic: () => audio.play('intro'),   // resolves 'playing' | 'blocked' | 'unavailable'
//     onSkip: () => { ... }                    // called the moment the player skips
//   }).then(() => { /* the intro is completely gone */ });
//
// Add ?nointro to the URL to turn it off while developing.

// ---------- Text (change these freely) ----------
const WELCOME_TEXT = 'WELCOME TO';  // Benguiat Bold, in the top bar
const LINE_1 = 'UPSIDE DOWN';        // outlined font, where "STRANGER" sits in the show's logo
const LINE_2 = 'ENDLESS';            // outlined font, where "THINGS" sits

// ---------- Timing, in milliseconds ----------
const INTRO_ENABLED = true;

const INTRO_SECONDS = 47;              // <-- how long the whole reveal takes. Change just this number.
const SCALE = INTRO_SECONDS / 40;      // everything below was designed for 40 s and scales from it

const TOTAL_MS = INTRO_SECONDS * 1000; // the reveal ends here; then the title glows slowly
const ZOOM_FROM = 2.3;                 // starts this many times too big, then pulls back to 1
const ZOOM_MS = TOTAL_MS;
const LETTER_START = [1500 * SCALE, 26000 * SCALE];    // each letter starts at a random moment in this range...
const LETTER_DURATION = [6000 * SCALE, 11000 * SCALE]; // ...and takes this long to glow in and settle
const BARS_START = 30000 * SCALE;      // the double bars grow in
const BARS_MS = 5000 * SCALE;
const WELCOME_START = 33000 * SCALE;   // "WELCOME TO" glows in
const WELCOME_MS = 5500 * SCALE;
const GLOW_MS = 4000;                  // one slow glow "breath" at the end (in, then out)
const IRIS_MS = 3000;                  // fade-out from the edges to the centre
const IGNORE_INPUT_MS = 500;           // ignore clicks/keys right after the intro starts

const SEED = 7;                        // same drift pattern every time; change for a different one

const FONT_OUTLINED = 'ST Outlined';
const FONT_WELCOME = 'Benguiat';

// Small seeded random generator so the animation looks the same each run.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (min, max, t) => min + (max - min) * t;

export function playIntro({ startMusic, onSkip } = {}) {
  const root = document.getElementById('intro');
  const skipFromUrl = new URLSearchParams(window.location.search).has('nointro');

  if (!root || !INTRO_ENABLED || skipFromUrl) {
    if (root) root.remove();
    if (onSkip) onSkip();
    return Promise.resolve();
  }
  return run(root, { startMusic, onSkip });
}

// Wait (up to 2.5 s) for the two fonts, and report which ones really loaded.
async function loadFonts() {
  const loading = Promise.all([
    document.fonts.load(`100px "${FONT_OUTLINED}"`, LINE_1 + LINE_2),
    document.fonts.load(`100px "${FONT_WELCOME}"`, WELCOME_TEXT)
  ]).catch(() => {});
  await Promise.race([loading, new Promise(resolve => setTimeout(resolve, 2500))]);

  const isLoaded = family =>
    [...document.fonts].some(
      face => face.family.replace(/["']/g, '') === family && face.status === 'loaded'
    );
  return { outlined: isLoaded(FONT_OUTLINED), welcome: isLoaded(FONT_WELCOME) };
}

// One <span> per letter so every letter can animate on its own.
function buildLetters(container, text) {
  container.replaceChildren();
  const glyphs = [];
  for (const char of text) {
    if (char === ' ') {
      container.appendChild(document.createTextNode(' '));
      continue;
    }
    const span = document.createElement('span');
    span.className = 'glyph';
    span.textContent = char;
    container.appendChild(span);
    glyphs.push(span);
  }
  return glyphs;
}

// Size the whole lockup so the first line spans the available width.
function fit(root, lockup, line1) {
  const maxWidth = Math.min(window.innerWidth * 0.88, 1250);
  root.style.setProperty('--intro-fs', '100px');
  const widthAt100 = line1.offsetWidth || 800;
  let fontSize = (maxWidth / widthAt100) * 100;

  // Also keep the lockup from getting taller than ~60% of the window.
  fontSize = Math.min(fontSize, (window.innerHeight * 0.6) / 2.4);

  root.style.setProperty('--intro-fs', `${fontSize}px`);
  lockup.style.width = `${(widthAt100 / 100) * fontSize}px`;
}

// Is this click / key press one that should skip or start the intro?
// (The Settings button is hidden during the intro, so any click counts.)
function isPlayerInput(event) {
  if (event.type === 'keydown') {
    // Ignore key repeats and browser shortcuts such as Cmd+R or Ctrl+Tab.
    return !(event.repeat || event.metaKey || event.ctrlKey || event.altKey);
  }
  return true;
}

// Browsers only allow sound after a click or key press. If the music was blocked, show an
// "enter" screen and wait for the player's first input before starting the intro.
function waitForFirstInput(root, lockup) {
  const gate = root.querySelector('#intro-gate');
  gate.hidden = false;
  lockup.style.visibility = 'hidden';

  return new Promise(resolve => {
    const go = event => {
      if (!isPlayerInput(event)) return;
      window.removeEventListener('keydown', go, true);
      window.removeEventListener('pointerdown', go, true);
      gate.hidden = true;
      lockup.style.visibility = '';
      resolve();
    };
    window.addEventListener('keydown', go, true);
    window.addEventListener('pointerdown', go, true);
  });
}

async function run(root, { startMusic, onSkip }) {
  const lockup = root.querySelector('.intro-lockup');
  const line1 = root.querySelector('#intro-line-1');
  const line2 = root.querySelector('#intro-line-2');
  const welcome = root.querySelector('#intro-welcome');
  const bars = [...root.querySelectorAll('.intro-bar')];
  const hint = root.querySelector('.intro-skip');
  const bloom = root.querySelector('.intro-bloom');

  welcome.textContent = WELCOME_TEXT;
  const glyphs = [...buildLetters(line1, LINE_1), ...buildLetters(line2, LINE_2)];

  const fonts = await loadFonts();
  // If the outlined font is missing, draw the letters as outlines with CSS instead.
  if (!fonts.outlined) root.classList.add('no-outline-font');

  fit(root, lockup, line1);
  const onResize = () => fit(root, lockup, line1);
  window.addEventListener('resize', onResize);

  // ----- Music, and the "click to enter" screen if the browser blocks it -----
  let music = 'unavailable';
  if (startMusic) {
    music = await Promise.race([
      Promise.resolve(startMusic()).catch(() => 'unavailable'),
      new Promise(resolve => setTimeout(() => resolve('unavailable'), 1500))
    ]);
  }
  if (music === 'blocked') {
    await waitForFirstInput(root, lockup);
    if (startMusic) startMusic();
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = mulberry32(SEED);
  const total = reduceMotion ? 3000 : TOTAL_MS;

  return new Promise(resolve => {
    let finished = false;
    let closing = false;
    let hintTimer = null;
    let safetyTimer = null;
    let armTimer = null;
    const animations = [];

    const add = (element, keyframes, options) => {
      const animation = element.animate(keyframes, { fill: 'both', ...options });
      animations.push(animation);
      return animation;
    };

    // ----- 1. The camera slowly pulls back -----
    if (!reduceMotion) {
      add(
        lockup,
        [{ transform: `scale(${ZOOM_FROM})` }, { transform: 'scale(1)' }],
        { duration: ZOOM_MS, easing: 'cubic-bezier(0.3, 0.35, 0.3, 1)' }
      );
    }

    // ----- 2. Letters glow in; some drift in from off-position -----
    glyphs.forEach(glyph => {
      const start = reduceMotion ? 0 : lerp(LETTER_START[0], LETTER_START[1], rand());
      const duration = reduceMotion ? 1500 : lerp(LETTER_DURATION[0], LETTER_DURATION[1], rand());
      const drifts = !reduceMotion && rand() > 0.55;

      const dx = drifts ? (rand() - 0.5) * 2.4 : (rand() - 0.5) * 0.16;
      const dy = drifts ? (rand() - 0.5) * 2.0 : (rand() - 0.5) * 0.16;
      const rotate = drifts ? (rand() - 0.5) * 16 : 0;

      // Only opacity and transform are animated (the GPU handles these cheaply).
      // The glow itself is a fixed text-shadow set in the CSS.
      add(
        glyph,
        [
          { opacity: 0, transform: `translate(${dx}em, ${dy}em) rotate(${rotate}deg)` },
          { opacity: 1, offset: 0.65 },
          { opacity: 1, transform: 'none' }
        ],
        { delay: start, duration, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)' }
      );
    });

    // ----- 3. The double bars grow outward from the text -----
    bars.forEach((bar, index) => {
      const fromRight = bar.dataset.side === 'left'; // left bars grow toward the left
      bar.style.transformOrigin = fromRight ? 'right center' : 'left center';
      add(
        bar,
        [
          { opacity: 0, transform: 'scaleX(0.15)' },
          { opacity: 1, transform: 'scaleX(1)' }
        ],
        {
          delay: reduceMotion ? 500 : BARS_START + (index % 2) * 400,
          duration: reduceMotion ? 1000 : BARS_MS,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)'
        }
      );
    });

    // ----- 4. "WELCOME TO" -----
    add(welcome, [{ opacity: 0 }, { opacity: 1 }], {
      delay: reduceMotion ? 500 : WELCOME_START,
      duration: reduceMotion ? 1000 : WELCOME_MS,
      easing: 'ease-out'
    });

    // ----- 5. A red haze slowly builds behind the title -----
    add(bloom, [{ opacity: 0 }, { opacity: 0.55 }], {
      duration: total,
      easing: 'ease-in'
    });

    // ----- 6. When the reveal is complete, the title glows slowly, forever -----
    if (!reduceMotion) {
      add(
        lockup,
        [
          { filter: 'brightness(1) saturate(1)' },
          { filter: 'brightness(1.45) saturate(1.2)' }
        ],
        {
          delay: total,
          duration: GLOW_MS,
          iterations: Infinity,
          direction: 'alternate',
          easing: 'ease-in-out',
          fill: 'forwards'
        }
      );
      add(bloom, [{ opacity: 0.55 }, { opacity: 1 }], {
        delay: total,
        duration: GLOW_MS,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out',
        fill: 'forwards'
      });
    }

    // ----- 7. Skip hint -----
    add(hint, [{ opacity: 0 }, { opacity: 0.55 }], { delay: 2500, duration: 1500 });
    hintTimer = setTimeout(() => {
      hint.textContent = 'CLICK OR PRESS ANY KEY TO CONTINUE';
    }, total);

    // ----- Finishing -----
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hintTimer);
      clearTimeout(safetyTimer);
      clearTimeout(armTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('pointerdown', skip, true);
      animations.forEach(animation => animation.cancel());
      root.remove();
      resolve();
    };

    // Fade out from the edges to the centre (a closing "iris" mask).
    const closeIris = () => {
      const irisSupported =
        !reduceMotion && window.CSS && typeof CSS.registerProperty === 'function';

      if (irisSupported) {
        root.classList.add('closing');
        root
          .animate([{ '--iris': '150%' }, { '--iris': '0%' }], {
            duration: IRIS_MS,
            easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
            fill: 'forwards'
          })
          .finished.then(done, done);
        safetyTimer = setTimeout(done, IRIS_MS + 600);
      } else {
        // Older browsers: a plain fade.
        root
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, fill: 'forwards' })
          .finished.then(done, done);
        safetyTimer = setTimeout(done, 1400);
      }
    };

    // Click or any key: tell the game right away, then fade out.
    function skip(event) {
      if (closing || !isPlayerInput(event)) return;
      closing = true;
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('pointerdown', skip, true);

      root.style.pointerEvents = 'none'; // let clicks reach the menu underneath
      if (onSkip) onSkip();
      closeIris();
    }

    // Only start listening a moment after the intro begins, so the key or click that
    // started it (or an accidental double press) cannot skip it instantly.
    armTimer = setTimeout(() => {
      window.addEventListener('keydown', skip, true);
      window.addEventListener('pointerdown', skip, true);
    }, IGNORE_INPUT_MS);
  });
}