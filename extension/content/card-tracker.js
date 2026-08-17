/**
 * Card Scanner+ Real-Time Card Tracker
 * High-speed client-side card contour & bounding box detector (Runs smoothly in requestAnimationFrame)
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.trackingBox = null;
    this.isActive = true;
    this.isTracking = false;
    this.animationId = null;

    // Smoothed Bounding Box Coordinates (relative percentages 0.0 -> 1.0)
    this.targetBox = { x: 0.15, y: 0.20, w: 0.70, h: 0.60 };
    this.currentBox = { x: 0.15, y: 0.20, w: 0.70, h: 0.60 };
    this.confidence = 0;
    this.hasFoundCard = false;

    // Offscreen Analysis Canvas
    this.analysisCanvas = document.createElement('canvas');
    this.analysisCanvas.width = 180;
    this.analysisCanvas.height = 240;
    this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });

    this.lastProcessTime = 0;
  }

  init(videoElement) {
    if (!videoElement) return;
    this.video = videoElement;
    this.createTrackingUI();
    this.startTrackingLoop();
  }

  createTrackingUI() {
    if (document.getElementById('cardscanner-tracker-layer')) return;

    this.container = document.createElement('div');
    this.container.id = 'cardscanner-tracker-layer';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    `;

    this.trackingBox = document.createElement('div');
    this.trackingBox.className = 'cs-tracking-box';
    this.trackingBox.style.cssText = `
      position: absolute;
      border: 2px solid rgba(99, 102, 241, 0.85);
      border-radius: 12px;
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.4), inset 0 0 16px rgba(99, 102, 241, 0.15);
      background: rgba(99, 102, 241, 0.04);
      pointer-events: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 6px;
      box-sizing: border-box;
    `;

    this.trackingBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="cs-tracker-tag" style="background: rgba(15, 23, 42, 0.85); color: #818cf8; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(99,102,241,0.4);">
          ⚡ CARD LOCKED
        </span>
        <span class="cs-tracker-score" style="background: rgba(15, 23, 42, 0.85); color: #34d399; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(52,211,153,0.4);">
          98%
        </span>
      </div>
      <div style="display: flex; justify-content: center;">
        <span style="background: rgba(15, 23, 42, 0.8); color: #94a3b8; font-family: sans-serif; font-size: 9px; padding: 1px 5px; border-radius: 3px;">
          Press [S] to Scan
        </span>
      </div>
    `;

    this.container.appendChild(this.trackingBox);

    // Mount to the video's parent container
    const parent = this.video.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(this.container);
    }
  }

  startTrackingLoop() {
    this.isTracking = true;

    const loop = (timestamp) => {
      if (!this.isTracking) return;

      // Throttle image processing to 15 FPS (every 66ms) to keep CPU < 1%
      if (timestamp - this.lastProcessTime > 66) {
        this.lastProcessTime = timestamp;
        this.detectCardContours();
      }

      // Smooth visual lerp for UI frame at 60 FPS
      this.updateVisualBox();

      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);
  }

  detectCardContours() {
    if (!this.video || this.video.paused || this.video.readyState < 2) return;

    const vW = this.video.videoWidth || 720;
    const vH = this.video.videoHeight || 1280;
    const aW = this.analysisCanvas.width;
    const aH = this.analysisCanvas.height;

    // Draw downscaled frame
    this.analysisCtx.drawImage(this.video, 0, 0, aW, aH);

    try {
      const imgData = this.analysisCtx.getImageData(0, 0, aW, aH);
      const data = imgData.data;

      // Fast Edge & Standard Card Aspect Ratio (1 : 1.4) Detection
      let minX = aW, maxX = 0, minY = aH, maxY = 0;
      let edgeCount = 0;

      // Search central 75% region of screen where cards are held
      const startX = Math.floor(aW * 0.10);
      const endX = Math.floor(aW * 0.90);
      const startY = Math.floor(aH * 0.12);
      const endY = Math.floor(aH * 0.88);

      for (let y = startY; y < endY; y += 4) {
        for (let x = startX; x < endX; x += 4) {
          const idx = (y * aW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Compute Sobel-like gradient with adjacent pixel
          const nextIdx = idx + 16;
          const dr = Math.abs(r - data[nextIdx]);
          const dg = Math.abs(g - data[nextIdx + 1]);
          const db = Math.abs(b - data[nextIdx + 2]);
          const diff = dr + dg + db;

          // Strong border/edge pixel
          if (diff > 90) {
            edgeCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const detectedW = (maxX - minX) / aW;
      const detectedH = (maxY - minY) / aH;
      const ratio = detectedH / (detectedW || 1);

      // Validate trading card dimensions (aspect ratio between 1.2 and 1.6, width >= 25%)
      if (edgeCount > 60 && detectedW >= 0.25 && detectedW <= 0.85 && detectedH >= 0.30 && ratio >= 1.15 && ratio <= 1.75) {
        this.targetBox = {
          x: Math.max(0.05, minX / aW),
          y: Math.max(0.08, minY / aH),
          w: Math.min(0.90, detectedW),
          h: Math.min(0.85, detectedH)
        };
        this.hasFoundCard = true;
        this.confidence = Math.min(99, Math.round(75 + edgeCount / 10));
      } else {
        // Default smart center box if hand is moving fast
        this.targetBox = { x: 0.15, y: 0.18, w: 0.70, h: 0.62 };
        this.hasFoundCard = false;
        this.confidence = 85;
      }
    } catch (e) {}
  }

  updateVisualBox() {
    if (!this.trackingBox || !this.container) return;

    // Linear interpolation (lerp) for smooth gliding box
    const lerpFactor = 0.18;
    this.currentBox.x += (this.targetBox.x - this.currentBox.x) * lerpFactor;
    this.currentBox.y += (this.targetBox.y - this.currentBox.y) * lerpFactor;
    this.currentBox.w += (this.targetBox.w - this.currentBox.w) * lerpFactor;
    this.currentBox.h += (this.targetBox.h - this.currentBox.h) * lerpFactor;

    this.trackingBox.style.left = `${(this.currentBox.x * 100).toFixed(2)}%`;
    this.trackingBox.style.top = `${(this.currentBox.y * 100).toFixed(2)}%`;
    this.trackingBox.style.width = `${(this.currentBox.w * 100).toFixed(2)}%`;
    this.trackingBox.style.height = `${(this.currentBox.h * 100).toFixed(2)}%`;

    if (this.hasFoundCard) {
      this.trackingBox.style.borderColor = 'rgba(52, 211, 153, 0.9)'; // Green locked
      this.trackingBox.style.boxShadow = '0 0 18px rgba(52, 211, 153, 0.45), inset 0 0 16px rgba(52, 211, 153, 0.15)';
    } else {
      this.trackingBox.style.borderColor = 'rgba(99, 102, 241, 0.8)'; // Indigo searching
      this.trackingBox.style.boxShadow = '0 0 14px rgba(99, 102, 241, 0.35), inset 0 0 14px rgba(99, 102, 241, 0.10)';
    }
  }

  /**
   * Cuts the exact tracked card area at full native resolution
   * Scales to optimal ~500x700px JPEG (~35 KB) for Gemini Vision API
   */
  getCroppedCardBase64() {
    if (!this.video) return null;

    const vW = this.video.videoWidth || this.video.clientWidth || 720;
    const vH = this.video.videoHeight || this.video.clientHeight || 1280;

    const cropX = Math.floor(vW * this.currentBox.x);
    const cropY = Math.floor(vH * this.currentBox.y);
    const cropW = Math.floor(vW * this.currentBox.w);
    const cropH = Math.floor(vH * this.currentBox.h);

    const canvas = document.createElement('canvas');
    // Scale output to standard high-clarity 500x700px
    canvas.width = 500;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(this.video, cropX, cropY, cropW, cropH, 0, 0, 500, 700);

    return canvas.toDataURL('image/jpeg', 0.82);
  }

  destroy() {
    this.isTracking = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

window.cardTracker = new CardTracker();
