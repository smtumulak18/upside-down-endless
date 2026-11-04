// background.js
// Looping, cross-fading background video. Moved as-is from the prototype's game.js.

const backgroundHost = document.createElement('div');
backgroundHost.id = 'animated-background';

const videos = [];

for (let i = 0; i < 2; i++) {
  const video = document.createElement('video');

  video.src = '/upside-down-background-4k.mp4';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = false;
  video.className = 'background-video';

  backgroundHost.appendChild(video);
  videos.push(video);
}

document.body.prepend(backgroundHost);

let activeVideo = 0;
let transitioning = false;
const FADE_DURATION = 1.2;

videos[0].style.opacity = '1';
videos[1].style.opacity = '0';

videos[0].play().catch(error => {
  console.error('Could not start background video:', error);
});

async function startNextBackground() {
  if (transitioning) return;

  transitioning = true;

  const current = videos[activeVideo];
  const nextIndex = 1 - activeVideo;
  const next = videos[nextIndex];

  try {
    next.pause();
    next.currentTime = 0;
    await next.play();

    next.style.opacity = '1';
    current.style.opacity = '0';

    window.setTimeout(() => {
      current.pause();
      current.currentTime = 0;
      activeVideo = nextIndex;
      transitioning = false;
    }, FADE_DURATION * 1000);
  } catch (error) {
    transitioning = false;
    console.error('Background transition failed:', error);
  }
}

videos.forEach((video, index) => {
  video.addEventListener('timeupdate', () => {
    if (index !== activeVideo || transitioning) return;

    if (video.duration &&
        video.currentTime >= video.duration - FADE_DURATION) {
      startNextBackground();
    }
  });
});
