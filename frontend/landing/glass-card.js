// The card is a window onto a refracted duplicate of the background video. Every frame the current
// video frame is drawn into a viewport-sized canvas positioned so its pixels line up 1:1 with the real
// video behind the card; the card's overflow:hidden and radius clip it, and the SVG filter refracts it.
const video = document.getElementById("bg-video");
const card = document.querySelector("[data-glass-card]");
const container = document.getElementById("dup-video-container");
const canvas = document.getElementById("dup-image");
const ctx = canvas.getContext("2d");

// The duplicate stays at 1x even on retina: the SVG filter's cost scales with pixel count, and what
// shows through is a soft refraction where 4x the filter work buys nothing.
const DUP_PIXEL_RATIO = 1;

function frame() {
  const rect = card.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0 && video.videoWidth > 0 && video.videoHeight > 0) {
    // Sized to the viewport rather than the card, deliberately: the filter shifts each colour channel
    // by a different amount, so the filtered element's own leading edges show hard channel-separation
    // bands. At viewport size those bands fall outside the card and only clean refraction shows.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    container.style.left = `${-rect.left}px`;
    container.style.top = `${-rect.top}px`;
    container.style.width = `${vw}px`;
    container.style.height = `${vh}px`;

    const w = Math.round(vw * DUP_PIXEL_RATIO), h = Math.round(vh * DUP_PIXEL_RATIO);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // Reproduce object-fit: cover.
    const cover = Math.max(vw / video.videoWidth, vh / video.videoHeight);
    const sw = vw / cover, sh = vh / cover;
    const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2;
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    } catch {
      // frame not decodable yet
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
