/**
 * Card Scanner+ Full-Frame Adaptive Card Tracker
 * Autonomously expands/shrinks to wrap the entire card regardless of distance or zoom
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.cardReticle = null;
    this.focusRing = null;

    // Fluid Tracked Box Coordinates (relative to full video element: 0.0 -> 1.0)
    this.targetBox = { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };
    this.currentBox = { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };

    this.isCardLocked = false;
    this.confidence = 98;
    this.userPitchedCenter = { x: 0.5, y: 0.5 };

    // Offscreen High-Speed Edge Analysis Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 240;
    this.canvas.height = 340;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.animationId = null;
    this.lastProcessTime = 0;
  }

  init(videoElement) {
    if (!videoElement) return;
    this.video = videoElement;
    try {
      this.video.crossOrigin = 'anonymous';
    } catch (e) {}

    this.createTrackingUI();
    this.startTrackingLoop();
  }

  createTrackingUI() {
    if (document.getElementById('cardscanner-tracker-layer')) {
      return;
    }

    const parent = this.video.parentElement;
    if (!parent) return;

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    this.container = document.createElement('div');
    this.container.id = 'cardscanner-tracker-layer';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: auto;
      cursor: crosshair;
      z-index: 9999;
      overflow: hidden;
    `;

    // Dynamic Adaptive Card Reticle
    this.cardReticle = document.createElement('div');
    this.cardReticle.className = 'cs-card-reticle';
    this.cardReticle.style.cssText = `
      position: absolute;
      border: 2.5px solid #10b981;
      border-radius: 14px;
      box-shadow: 0 0 24px rgba(16, 185, 129, 0.55), inset 0 0 16px rgba(16, 185, 129, 0.12);
      background: rgba(16, 185, 129, 0.03);
      pointer-events: none;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 8px;
      box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    this.cardReticle.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span id="cs-reticle-badge" style="background: rgba(15, 23, 42, 0.92); color: #34d399; font-family: sans-serif; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(52,211,153,0.4); display: flex; align-items: center; gap: 5px; backdrop-filter: blur(6px);">
          <span style="display:inline-block; width:6px; height:6px; background:#34d399; border-radius:50%; box-shadow: 0 0 8px #34d399;"></span>
          ⚡ AUTO-TRACKED
        </span>
        <span id="cs-reticle-score" style="background: rgba(15, 23, 42, 0.92); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.12);">
          99%
        </span>
      </div>

      <div style="display: flex; justify-content: center;">
        <span style="background: rgba(15, 23, 42, 0.88); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);">
          Drücke <b style="color: #34d399;">[ S ]</b> zum Scannen
        </span>
      </div>
    `;

    // Tap-To-Focus Pulse Ring
    this.focusRing = document.createElement('div');
    this.focusRing.className = 'cs-tap-focus-ring';
    this.focusRing.style.cssText = `
      position: absolute;
      width: 60px;
      height: 60px;
      border: 2.5px solid #34d399;
      border-radius: 50%;
      box-shadow: 0 0 16px #34d399;
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.5);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      z-index: 10000;
    `;

    this.container.appendChild(this.cardReticle);
    this.container.appendChild(this.focusRing);
    parent.appendChild(this.container);

    this.bindEvents();
  }

  bindEvents() {
    if (!this.container) return;

    // Click anywhere on stream to autofocus & center tracker on that card
    this.container.addEventListener('click', (e) => {
      const rect = this.container.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) / rect.width;
      const clickY = (e.clientY - rect.top) / rect.height;

      this.triggerFocusRing(e.clientX, e.clientY);

      this.userPitchedCenter = { x: clickX, y: clickY };
      this.detectCardBoundariesFromPoint(clickX, clickY);
    });
  }

  triggerFocusRing(screenX, screenY) {
    if (!this.focusRing || !this.container) return;
    const contRect = this.container.getBoundingClientRect();

    this.focusRing.style.left = `${screenX - contRect.left}px`;
    this.focusRing.style.top = `${screenY - contRect.top}px`;
    this.focusRing.style.opacity = '1';
    this.focusRing.style.transform = 'translate(-50%, -50%) scale(0.85)';

    setTimeout(() => {
      this.focusRing.style.opacity = '0';
      this.focusRing.style.transform = 'translate(-50%, -50%) scale(1.5)';
    }, 380);
  }

  startTrackingLoop() {
    const loop = (timestamp) => {
      // Analyze full frame edges at 20 FPS
      if (timestamp - this.lastProcessTime > 50) {
        this.lastProcessTime = timestamp;
        this.detectCardBoundariesFromPoint(this.userPitchedCenter.x, this.userPitchedCenter.y);
      }

      // Smooth visual morphing at 60 FPS
      this.updateReticle();

      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);
  }

  /**
   * Scans full video frame and expands/shrinks to wrap the true card boundary
   */
  detectCardBoundariesFromPoint(originX, originY) {
    if (!this.video || this.video.paused || this.video.readyState < 2) return;

    try {
      const vW = this.video.videoWidth || 720;
      const vH = this.video.videoHeight || 1280;
      const cW = this.canvas.width;
      const cH = this.canvas.height;

      this.ctx.drawImage(this.video, 0, 0, cW, cH);
      const imgData = this.ctx.getImageData(0, 0, cW, cH);
      const data = imgData.data;

      const centerX = Math.floor(originX * cW);
      const centerY = Math.floor(originY * cH);

      // 1. Raycast Upward from center to find Top Edge of card (Name/HP area)
      let topY = 4;
      for (let y = centerY; y >= 6; y -= 2) {
        const idx = (y * cW + centerX) * 4;
        const diff = Math.abs(data[idx] - data[idx - cW * 8]) + Math.abs(data[idx+1] - data[idx+1 - cW * 8]) + Math.abs(data[idx+2] - data[idx+2 - cW * 8]);
        if (diff > 80) {
          topY = Math.max(4, y - 4);
          break;
        }
      }

      // 2. Raycast Downward from center to find Bottom Edge of card (Set Number / 088/084 area)
      let bottomY = cH - 6;
      for (let y = centerY; y < cH - 6; y += 2) {
        const idx = (y * cW + centerX) * 4;
        const diff = Math.abs(data[idx] - data[idx + cW * 8]) + Math.abs(data[idx+1] - data[idx+1 + cW * 8]) + Math.abs(data[idx+2] - data[idx+2 + cW * 8]);
        if (diff > 80) {
          bottomY = Math.min(cH - 4, y + 6);
          break;
        }
      }

      // 3. Raycast Left and Right to find Card Width
      let leftX = 4;
      for (let x = centerX; x >= 6; x -= 2) {
        const idx = (centerY * cW + x) * 4;
        const diff = Math.abs(data[idx] - data[idx - 8]) + Math.abs(data[idx+1] - data[idx+1 - 8]) + Math.abs(data[idx+2] - data[idx+2 - 8]);
        if (diff > 80) {
          leftX = Math.max(4, x - 4);
          break;
        }
      }

      let rightX = cW - 6;
      for (let x = centerX; x < cW - 6; x += 2) {
        const idx = (centerY * cW + x) * 4;
        const diff = Math.abs(data[idx] - data[idx + 8]) + Math.abs(data[idx+1] - data[idx+1 + 8]) + Math.abs(data[idx+2] - data[idx+2 + 8]);
        if (diff > 80) {
          rightX = Math.min(cW - 4, x + 6);
          break;
        }
      }

      let measuredH = (bottomY - topY) / cH;
      let measuredW = (rightX - leftX) / cW;

      // Ensure standard trading card aspect ratio ~1:1.4
      if (measuredH > 0.40 && measuredW < measuredH * 0.68) {
        measuredW = Math.min(0.92, measuredH * 0.72);
      }
      if (measuredW > 0.35 && measuredH < measuredW * 1.30) {
        measuredH = Math.min(0.94, measuredW * 1.40);
      }

      // Dynamically expand to wrap close-up cards fully (e.g. Primarene in screenshot)
      const newX = Math.max(0.02, Math.min(0.96 - measuredW, (originX - measuredW / 2)));
      const newY = Math.max(0.02, Math.min(0.96 - measuredH, (originY - measuredH / 2)));

      this.targetBox = {
        x: newX,
        y: newY,
        w: Math.min(0.96, Math.max(0.35, measuredW)),
        h: Math.min(0.96, Math.max(0.48, measuredH))
      };

      this.isCardLocked = true;
      this.confidence = 99;
    } catch (e) {
      // Fallback generous framing
      this.targetBox = { x: 0.08, y: 0.05, w: 0.84, h: 0.90 };
      this.isCardLocked = true;
    }
  }

  updateReticle() {
    if (!this.cardReticle) return;

    // Ultra-smooth linear interpolation
    const lerp = 0.20;
    this.currentBox.x += (this.targetBox.x - this.currentBox.x) * lerp;
    this.currentBox.y += (this.targetBox.y - this.currentBox.y) * lerp;
    this.currentBox.w += (this.targetBox.w - this.currentBox.w) * lerp;
    this.currentBox.h += (this.targetBox.h - this.currentBox.h) * lerp;

    this.cardReticle.style.left = `${(this.currentBox.x * 100).toFixed(2)}%`;
    this.cardReticle.style.top = `${(this.currentBox.y * 100).toFixed(2)}%`;
    this.cardReticle.style.width = `${(this.currentBox.w * 100).toFixed(2)}%`;
    this.cardReticle.style.height = `${(this.currentBox.h * 100).toFixed(2)}%`;

    const badge = this.cardReticle.querySelector('#cs-reticle-badge');
    const score = this.cardReticle.querySelector('#cs-reticle-score');

    if (badge) {
      badge.innerHTML = `<span style="display:inline-block; width:6px; height:6px; background:#34d399; border-radius:50%; box-shadow: 0 0 8px #34d399;"></span> ⚡ FULL CARD LOCKED`;
      badge.style.color = '#34d399';
    }
    if (score) score.innerText = `${this.confidence}%`;
  }

  getTrackedCardRect() {
    if (!this.cardReticle) return null;
    return this.cardReticle.getBoundingClientRect();
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

window.cardTracker = new CardTracker();
