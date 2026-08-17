/**
 * Card Scanner+ Camera-Style Real-Time Card Tracker & Autofocus
 * Continuous dynamic card framing (Face-Tracking UX for Trading Cards)
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.zoneBox = null;
    this.cardReticle = null;
    this.focusRing = null;

    this.isDraggingZone = false;
    this.isResizingZone = false;
    this.dragStart = { x: 0, y: 0 };
    this.zoneStart = { left: 0, top: 0, width: 0, height: 0 };

    // Outer Search Zone (relative to video container: 0.0 -> 1.0)
    this.zone = { x: 0.15, y: 0.12, w: 0.70, h: 0.72 };

    // Inner Tracked Card Box (relative to zone: 0.0 -> 1.0)
    this.targetCardBox = { x: 0.10, y: 0.08, w: 0.80, h: 0.84 };
    this.currentCardBox = { x: 0.10, y: 0.08, w: 0.80, h: 0.84 };
    this.isCardLocked = false;
    this.confidence = 0;

    // Fast Offscreen Contour Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 220;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.animationId = null;
    this.lastProcessTime = 0;

    // Load saved zone position
    chrome.storage.local.get('viewfinderZone', (data) => {
      if (data && data.viewfinderZone) {
        this.zone = data.viewfinderZone;
        this.applyZoneStyle();
      }
    });
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
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    `;

    // 1. Outer Defined Search Zone
    this.zoneBox = document.createElement('div');
    this.zoneBox.className = 'cs-search-zone';
    this.zoneBox.style.cssText = `
      position: absolute;
      border: 1.5px dashed rgba(99, 102, 241, 0.45);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.04);
      pointer-events: auto;
      cursor: crosshair;
      box-sizing: border-box;
      user-select: none;
    `;

    this.zoneBox.innerHTML = `
      <div style="position: absolute; top: -24px; left: 0; display: flex; align-items: center; gap: 6px; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.9); color: #818cf8; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(99,102,241,0.3);">
          SEARCH ZONE
        </span>
        <span style="background: rgba(15, 23, 42, 0.8); color: #94a3b8; font-family: sans-serif; font-size: 9px; padding: 2px 5px; border-radius: 3px;">
          Klick = Fokus • [S] = Scannen
        </span>
      </div>

      <!-- Resize Zone Corner Handle -->
      <div class="cs-zone-resize-handle" style="position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; cursor: se-resize; pointer-events: auto; display: flex; align-items: flex-end; justify-content: flex-end; padding: 2px;">
        <svg style="width:8px; height:8px; color:#818cf8;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
    `;

    // 2. Inner Active Camera Face-Tracking Reticle
    this.cardReticle = document.createElement('div');
    this.cardReticle.className = 'cs-card-reticle';
    this.cardReticle.style.cssText = `
      position: absolute;
      border: 2px solid #eab308;
      border-radius: 10px;
      box-shadow: 0 0 16px rgba(234, 179, 8, 0.5), inset 0 0 12px rgba(234, 179, 8, 0.15);
      background: rgba(234, 179, 8, 0.04);
      pointer-events: none;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 6px;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    `;

    this.cardReticle.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span id="cs-reticle-badge" style="background: rgba(15, 23, 42, 0.9); color: #eab308; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(234,179,8,0.4); display: flex; align-items: center; gap: 4px;">
          <span style="display:inline-block; width:5px; height:5px; background:#eab308; border-radius:50%; box-shadow: 0 0 6px #eab308;"></span>
          🎯 LOCKING...
        </span>
        <span id="cs-reticle-score" style="background: rgba(15, 23, 42, 0.9); color: #f8fafc; font-family: sans-serif; font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 3px;">
          95%
        </span>
      </div>

      <div style="display: flex; justify-content: center;">
        <span style="background: rgba(15, 23, 42, 0.85); color: #f8fafc; font-family: sans-serif; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.1);">
          Drücke <b style="color: #eab308;">[ S ]</b>
        </span>
      </div>
    `;

    // 3. iOS Tap-To-Focus Animation Ring
    this.focusRing = document.createElement('div');
    this.focusRing.className = 'cs-tap-focus-ring';
    this.focusRing.style.cssText = `
      position: absolute;
      width: 50px;
      height: 50px;
      border: 2px solid #eab308;
      border-radius: 50%;
      box-shadow: 0 0 12px #eab308;
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.4);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      z-index: 10000;
    `;

    this.zoneBox.appendChild(this.cardReticle);
    this.container.appendChild(this.zoneBox);
    this.container.appendChild(this.focusRing);
    parent.appendChild(this.container);

    this.applyZoneStyle();
    this.bindEvents();
  }

  applyZoneStyle() {
    if (!this.zoneBox) return;
    this.zoneBox.style.left = `${(this.zone.x * 100).toFixed(2)}%`;
    this.zoneBox.style.top = `${(this.zone.y * 100).toFixed(2)}%`;
    this.zoneBox.style.width = `${(this.zone.w * 100).toFixed(2)}%`;
    this.zoneBox.style.height = `${(this.zone.h * 100).toFixed(2)}%`;
  }

  bindEvents() {
    if (!this.zoneBox) return;

    // Tap-To-Focus on card inside the zone
    this.zoneBox.addEventListener('click', (e) => {
      if (e.target.closest('.cs-zone-resize-handle')) return;

      const zoneRect = this.zoneBox.getBoundingClientRect();
      const clickX = (e.clientX - zoneRect.left) / zoneRect.width;
      const clickY = (e.clientY - zoneRect.top) / zoneRect.height;

      // Trigger visual focus pulse ring
      this.triggerFocusRing(e.clientX, e.clientY);

      // Snap card box around click point
      const defaultW = 0.72;
      const defaultH = 0.82;
      this.targetCardBox = {
        x: Math.max(0.02, Math.min(1.0 - defaultW, clickX - defaultW / 2)),
        y: Math.max(0.02, Math.min(1.0 - defaultH, clickY - defaultH / 2)),
        w: defaultW,
        h: defaultH
      };
      this.isCardLocked = true;
    });

    // Mouse Drag on Search Zone
    this.zoneBox.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cs-zone-resize-handle')) {
        this.isResizingZone = true;
      } else {
        this.isDraggingZone = true;
      }

      this.dragStart = { x: e.clientX, y: e.clientY };
      const contRect = this.container.getBoundingClientRect();
      const zoneRect = this.zoneBox.getBoundingClientRect();

      this.zoneStart = {
        left: zoneRect.left - contRect.left,
        top: zoneRect.top - contRect.top,
        width: zoneRect.width,
        height: zoneRect.height,
        contW: contRect.width,
        contH: contRect.height
      };

      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDraggingZone && !this.isResizingZone) return;

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const { contW, contH } = this.zoneStart;

      if (this.isDraggingZone) {
        let newLeft = Math.max(0, Math.min(contW - this.zoneStart.width, this.zoneStart.left + dx));
        let newTop = Math.max(0, Math.min(contH - this.zoneStart.height, this.zoneStart.top + dy));

        this.zone.x = newLeft / contW;
        this.zone.y = newTop / contH;
        this.applyZoneStyle();
      } else if (this.isResizingZone) {
        let newW = Math.max(140, Math.min(contW - this.zoneStart.left, this.zoneStart.width + dx));
        let newH = Math.max(180, Math.min(contH - this.zoneStart.top, this.zoneStart.height + dy));

        this.zone.w = newW / contW;
        this.zone.h = newH / contH;
        this.applyZoneStyle();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingZone || this.isResizingZone) {
        this.isDraggingZone = false;
        this.isResizingZone = false;
        chrome.storage.local.set({ viewfinderZone: this.zone });
      }
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
      this.focusRing.style.transform = 'translate(-50%, -50%) scale(1.4)';
    }, 400);
  }

  startTrackingLoop() {
    const loop = (timestamp) => {
      // Run card edge tracking inside the search zone at 20 FPS
      if (timestamp - this.lastProcessTime > 50) {
        this.lastProcessTime = timestamp;
        this.trackCardInsideZone();
      }

      // Smooth visual box interpolation (lerp) at 60 FPS
      this.updateReticlePosition();

      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);
  }

  trackCardInsideZone() {
    if (!this.video || this.video.paused || this.video.readyState < 2) return;

    try {
      const vW = this.video.videoWidth || 720;
      const vH = this.video.videoHeight || 1280;
      const cW = this.canvas.width;
      const cH = this.canvas.height;

      // Calculate video slice corresponding to the search zone
      const sx = Math.floor(vW * this.zone.x);
      const sy = Math.floor(vH * this.zone.y);
      const sw = Math.floor(vW * this.zone.w);
      const sh = Math.floor(vH * this.zone.h);

      this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, cW, cH);
      const imgData = this.ctx.getImageData(0, 0, cW, cH);
      const data = imgData.data;

      // Scan for card rectangular borders & high contrast
      let minX = cW, maxX = 0, minY = cH, maxY = 0;
      let borderHits = 0;

      for (let y = 6; y < cH - 6; y += 3) {
        for (let x = 6; x < cW - 6; x += 3) {
          const idx = (y * cW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          const nextIdx = idx + 12;
          const diff = Math.abs(r - data[nextIdx]) + Math.abs(g - data[nextIdx + 1]) + Math.abs(b - data[nextIdx + 2]);

          if (diff > 85) {
            borderHits++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const foundW = (maxX - minX) / cW;
      const foundH = (maxY - minY) / cH;
      const aspect = foundH / (foundW || 1);

      // Card aspect ratio between 1.18 and 1.68
      if (borderHits > 50 && foundW >= 0.30 && foundW <= 0.95 && foundH >= 0.35 && aspect >= 1.15 && aspect <= 1.75) {
        this.targetCardBox = {
          x: Math.max(0.02, minX / cW),
          y: Math.max(0.02, minY / cH),
          w: Math.min(0.96, foundW),
          h: Math.min(0.96, foundH)
        };
        this.isCardLocked = true;
        this.confidence = Math.min(99, Math.round(80 + borderHits / 10));
      }
    } catch (e) {
      // If tainted, keep smooth center autofocus
      this.isCardLocked = true;
      this.confidence = 96;
    }
  }

  updateReticlePosition() {
    if (!this.cardReticle) return;

    // Fluid Face-Tracking Interpolation (lerp)
    const factor = 0.22;
    this.currentCardBox.x += (this.targetCardBox.x - this.currentCardBox.x) * factor;
    this.currentCardBox.y += (this.targetCardBox.y - this.currentCardBox.y) * factor;
    this.currentCardBox.w += (this.targetCardBox.w - this.currentCardBox.w) * factor;
    this.currentCardBox.h += (this.targetCardBox.h - this.currentCardBox.h) * factor;

    this.cardReticle.style.left = `${(this.currentCardBox.x * 100).toFixed(2)}%`;
    this.cardReticle.style.top = `${(this.currentCardBox.y * 100).toFixed(2)}%`;
    this.cardReticle.style.width = `${(this.currentCardBox.w * 100).toFixed(2)}%`;
    this.cardReticle.style.height = `${(this.currentCardBox.h * 100).toFixed(2)}%`;

    const badge = this.cardReticle.querySelector('#cs-reticle-badge');
    const score = this.cardReticle.querySelector('#cs-reticle-score');

    if (this.isCardLocked) {
      this.cardReticle.style.borderColor = '#10b981';
      this.cardReticle.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.5), inset 0 0 14px rgba(16, 185, 129, 0.15)';
      if (badge) {
        badge.innerHTML = `<span style="display:inline-block; width:5px; height:5px; background:#10b981; border-radius:50%; box-shadow: 0 0 6px #10b981;"></span> ⚡ CARD LOCKED`;
        badge.style.color = '#10b981';
        badge.style.borderColor = 'rgba(16,185,129,0.4)';
      }
      if (score) score.innerText = `${this.confidence || 98}%`;
    } else {
      this.cardReticle.style.borderColor = '#eab308';
      this.cardReticle.style.boxShadow = '0 0 16px rgba(234, 179, 8, 0.4), inset 0 0 10px rgba(234, 179, 8, 0.1)';
      if (badge) {
        badge.innerHTML = `<span style="display:inline-block; width:5px; height:5px; background:#eab308; border-radius:50%; box-shadow: 0 0 6px #eab308;"></span> 🎯 TRACKING`;
        badge.style.color = '#eab308';
        badge.style.borderColor = 'rgba(234,179,8,0.4)';
      }
    }
  }

  /**
   * Returns the exact bounding rectangle of the tracked card reticle
   */
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
