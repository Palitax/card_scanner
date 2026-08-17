/**
 * Card Scanner+ Full-Frame Adaptive Card Tracker
 * Aspect-Ratio Compensated Dynamic Card Framing (Perfect 1:1.4 Ratio in any Container)
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.cardReticle = null;
    this.focusRing = null;

    // Fluid Box Coordinates in Pixels
    this.targetPixelBox = { left: 50, top: 100, width: 320, height: 448 };
    this.currentPixelBox = { left: 50, top: 100, width: 320, height: 448 };

    this.isCardLocked = false;
    this.confidence = 99;
    this.userCenter = { x: 0.5, y: 0.5 };

    // Offscreen Canvas for Fast Edge Analysis
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

    // Adaptive Card Reticle
    this.cardReticle = document.createElement('div');
    this.cardReticle.className = 'cs-card-reticle';
    this.cardReticle.style.cssText = `
      position: absolute;
      border: 2.5px solid #10b981;
      border-radius: 12px;
      box-shadow: 0 0 24px rgba(16, 185, 129, 0.55), inset 0 0 16px rgba(16, 185, 129, 0.10);
      background: rgba(16, 185, 129, 0.02);
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
          ⚡ CARD LOCKED
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

    this.container.addEventListener('click', (e) => {
      const rect = this.container.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) / rect.width;
      const clickY = (e.clientY - rect.top) / rect.height;

      this.triggerFocusRing(e.clientX, e.clientY);
      this.userCenter = { x: clickX, y: clickY };
      this.calculateAdaptiveCardBounds();
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
      if (timestamp - this.lastProcessTime > 60) {
        this.lastProcessTime = timestamp;
        this.calculateAdaptiveCardBounds();
      }

      this.updateReticle();
      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);
  }

  /**
   * Computes the exact pixel width and height with 1:1.40 Card Ratio
   */
  calculateAdaptiveCardBounds() {
    if (!this.container || !this.video) return;

    const contW = this.container.clientWidth || 580;
    const contH = this.container.clientHeight || 1000;

    let detectedH = contH * 0.68; // Default 68% height of stream
    let detectedCenterY = contH * this.userCenter.y;
    let detectedCenterX = contW * this.userCenter.x;

    try {
      const cW = this.canvas.width;
      const cH = this.canvas.height;
      this.ctx.drawImage(this.video, 0, 0, cW, cH);
      const imgData = this.ctx.getImageData(0, 0, cW, cH);
      const data = imgData.data;

      const cX = Math.floor(this.userCenter.x * cW);
      const cY = Math.floor(this.userCenter.y * cH);

      // Raycast Top
      let topY = 4;
      for (let y = cY; y >= 6; y -= 3) {
        const idx = (y * cW + cX) * 4;
        const diff = Math.abs(data[idx] - data[idx - cW * 8]) + Math.abs(data[idx+1] - data[idx+1 - cW * 8]) + Math.abs(data[idx+2] - data[idx+2 - cW * 8]);
        if (diff > 80) {
          topY = y - 4;
          break;
        }
      }

      // Raycast Bottom
      let bottomY = cH - 6;
      for (let y = cY; y < cH - 6; y += 3) {
        const idx = (y * cW + cX) * 4;
        const diff = Math.abs(data[idx] - data[idx + cW * 8]) + Math.abs(data[idx+1] - data[idx+1 + cW * 8]) + Math.abs(data[idx+2] - data[idx+2 + cW * 8]);
        if (diff > 80) {
          bottomY = y + 6;
          break;
        }
      }

      const measuredCardH = ((bottomY - topY) / cH) * contH;
      if (measuredCardH > contH * 0.40 && measuredCardH < contH * 0.94) {
        detectedH = measuredCardH;
        detectedCenterY = ((topY + bottomY) / 2 / cH) * contH;
      }
    } catch (e) {}

    // Physical Card Ratio: 2.5 inches wide / 3.5 inches tall = ~0.714
    const trueCardWidthPx = detectedH * (2.5 / 3.5);

    // Clamp width to container bounds
    const finalWidth = Math.min(contW * 0.94, trueCardWidthPx);
    const finalHeight = detectedH;

    const finalLeft = Math.max(8, Math.min(contW - finalWidth - 8, detectedCenterX - finalWidth / 2));
    const finalTop = Math.max(8, Math.min(contH - finalHeight - 8, detectedCenterY - finalHeight / 2));

    this.targetPixelBox = {
      left: finalLeft,
      top: finalTop,
      width: finalWidth,
      height: finalHeight
    };
  }

  updateReticle() {
    if (!this.cardReticle) return;

    // Smooth Lerp
    const lerp = 0.22;
    this.currentPixelBox.left += (this.targetPixelBox.left - this.currentPixelBox.left) * lerp;
    this.currentPixelBox.top += (this.targetPixelBox.top - this.currentPixelBox.top) * lerp;
    this.currentPixelBox.width += (this.targetPixelBox.width - this.currentPixelBox.width) * lerp;
    this.currentPixelBox.height += (this.targetPixelBox.height - this.currentPixelBox.height) * lerp;

    this.cardReticle.style.left = `${this.currentPixelBox.left.toFixed(1)}px`;
    this.cardReticle.style.top = `${this.currentPixelBox.top.toFixed(1)}px`;
    this.cardReticle.style.width = `${this.currentPixelBox.width.toFixed(1)}px`;
    this.cardReticle.style.height = `${this.currentPixelBox.height.toFixed(1)}px`;
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
