/**
 * Card Scanner+ Universal Viewfinder & Smart Image Snapper
 * Fixed full-screen overlay (never trapped in sub-containers) with Auto-Snap to open product images
 */

class CardTracker {
  constructor() {
    this.container = null;
    this.trackingBox = null;
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.boxStart = { left: 0, top: 0, width: 0, height: 0 };

    // Standard centered card dimensions in viewport coordinates (px)
    this.pos = {
      left: Math.round(window.innerWidth * 0.35),
      top: Math.round(window.innerHeight * 0.18),
      width: 320,
      height: 448
    };

    // Load saved position
    chrome.storage.local.get('cardViewfinderPos', (data) => {
      if (data && data.cardViewfinderPos) {
        this.pos = data.cardViewfinderPos;
        this.applyBoxStyle();
      }
    });

    this.init();
  }

  init() {
    this.createTrackingUI();
    this.observeOpenImages();
  }

  createTrackingUI() {
    if (document.getElementById('cardscanner-tracker-layer')) {
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'cardscanner-tracker-layer';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 9998;
      overflow: hidden;
    `;

    // High-Precision Glowing Framing Box
    this.trackingBox = document.createElement('div');
    this.trackingBox.className = 'cs-tracking-box';
    this.trackingBox.style.cssText = `
      position: absolute;
      border: 2.5px solid #10b981;
      border-radius: 12px;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.45), inset 0 0 14px rgba(16, 185, 129, 0.08);
      background: rgba(16, 185, 129, 0.03);
      pointer-events: auto;
      cursor: grab;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 6px 8px;
      box-sizing: border-box;
      user-select: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    this.trackingBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.92); color: #34d399; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(52,211,153,0.4); display: flex; align-items: center; gap: 4px; backdrop-filter: blur(6px);">
          <span style="display:inline-block; width:6px; height:6px; background:#34d399; border-radius:50%; box-shadow: 0 0 6px #34d399;"></span>
          ⚡ KARTEN-ZIEL
        </span>
        <button id="cs-btn-snap-img" style="pointer-events: auto; background: rgba(15, 23, 42, 0.85); color: #cbd5e1; font-family: sans-serif; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer;" title="Automatisch auf offenes Bild einrasten">
          🎯 Einrasten
        </button>
      </div>

      <div style="display: flex; justify-content: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.88); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);">
          Drücke <b style="color: #34d399;">[ S ]</b> zum Scannen
        </span>
      </div>

      <!-- Bottom-Right Resize Handle -->
      <div class="cs-box-resize-handle" style="position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; cursor: se-resize; pointer-events: auto; display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;">
        <svg style="width:10px; height:10px; color:#34d399;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
    `;

    this.container.appendChild(this.trackingBox);
    document.body.appendChild(this.container);

    this.applyBoxStyle();
    this.bindEvents();

    // Auto-snap to open image on first load
    setTimeout(() => this.autoSnapToProminentImage(), 600);
  }

  applyBoxStyle() {
    if (!this.trackingBox) return;
    this.trackingBox.style.left = `${this.pos.left}px`;
    this.trackingBox.style.top = `${this.pos.top}px`;
    this.trackingBox.style.width = `${this.pos.width}px`;
    this.trackingBox.style.height = `${this.pos.height}px`;
  }

  bindEvents() {
    if (!this.trackingBox) return;

    this.trackingBox.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cs-box-resize-handle')) {
        this.isResizing = true;
      } else if (e.target.id === 'cs-btn-snap-img') {
        this.autoSnapToProminentImage();
        e.stopPropagation();
        return;
      } else {
        this.isDragging = true;
        this.trackingBox.style.cursor = 'grabbing';
      }

      this.dragStart = { x: e.clientX, y: e.clientY };
      this.boxStart = { ...this.pos };

      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging && !this.isResizing) return;

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;

      if (this.isDragging) {
        this.pos.left = Math.max(0, Math.min(window.innerWidth - this.pos.width, this.boxStart.left + dx));
        this.pos.top = Math.max(0, Math.min(window.innerHeight - this.pos.height, this.boxStart.top + dy));
        this.applyBoxStyle();
      } else if (this.isResizing) {
        const newW = Math.max(120, Math.min(window.innerWidth - this.pos.left, this.boxStart.width + dx));
        const newH = Math.min(window.innerHeight - this.pos.top, Math.round(newW * 1.40));

        this.pos.width = newW;
        this.pos.height = newH;
        this.applyBoxStyle();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging || this.isResizing) {
        this.isDragging = false;
        this.isResizing = false;
        this.trackingBox.style.cursor = 'grab';
        chrome.storage.local.set({ cardViewfinderPos: this.pos });
      }
    });

    // Snap button click
    const btnSnap = this.trackingBox.querySelector('#cs-btn-snap-img');
    if (btnSnap) {
      btnSnap.onclick = (e) => {
        e.stopPropagation();
        this.autoSnapToProminentImage();
      };
    }
  }

  /**
   * Automatically finds the largest prominent card image on screen (e.g. open Pre-Bid photo or Video)
   */
  autoSnapToProminentImage() {
    const images = Array.from(document.querySelectorAll('img, video')).filter(el => {
      if (el.closest('#cardscanner-root') || el.closest('#cardscanner-tracker-layer')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 150 && rect.height >= 180 && rect.top < window.innerHeight && rect.bottom > 0;
    });

    // Sort by area to get the most prominent card image in focus
    images.sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return (rB.width * rB.height) - (rA.width * rA.height);
    });

    if (images.length > 0) {
      const best = images[0];
      const r = best.getBoundingClientRect();

      this.pos = {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };

      this.applyBoxStyle();
      console.log('[Card Scanner+] Auto-snapped reticle to prominent card element:', best, this.pos);
      return true;
    }

    return false;
  }

  /**
   * Watches for user clicking on product listing items to auto-snap onto opened photos
   */
  observeOpenImages() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target.closest('#cardscanner-root') || target.closest('#cardscanner-tracker-layer')) return;

      // When clicking a product or image, trigger auto-snap after modal renders
      setTimeout(() => {
        this.autoSnapToProminentImage();
      }, 350);
    }, true);
  }

  getTrackedCardRect() {
    if (!this.trackingBox) return null;
    return this.trackingBox.getBoundingClientRect();
  }

  destroy() {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

window.cardTracker = new CardTracker();
