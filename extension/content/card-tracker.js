/**
 * Card Scanner+ Precision Card Viewfinder & Tracker
 * Perfectly snappable, resizable & draggable framing box with Auto-Card Lock
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.trackingBox = null;
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.boxStart = { left: 0, top: 0, width: 0, height: 0 };

    // Standard snug card dimensions (centered, optimal trading card aspect 1 : 1.40)
    this.box = { left: 0.16, top: 0.20, width: 0.68, height: 0.60 };

    // Load saved custom position if user adjusted it
    chrome.storage.local.get('cardViewfinderBox', (data) => {
      if (data && data.cardViewfinderBox) {
        this.box = data.cardViewfinderBox;
        this.applyBoxStyle();
      }
    });

    this.animationId = null;
  }

  init(videoElement) {
    if (!videoElement) return;
    this.video = videoElement;
    try {
      this.video.crossOrigin = 'anonymous';
    } catch (e) {}

    this.createTrackingUI();
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
        <span style="background: rgba(15, 23, 42, 0.85); color: #cbd5e1; font-family: sans-serif; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
          Ziehen zum Bewegen ✥
        </span>
      </div>

      <div style="display: flex; justify-content: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.88); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);">
          Drücke <b style="color: #34d399;">[ S ]</b> zum Scannen
        </span>
      </div>

      <!-- Bottom-Right Resize Handle -->
      <div class="cs-box-resize-handle" style="position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: se-resize; pointer-events: auto; display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;">
        <svg style="width:10px; height:10px; color:#34d399;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
    `;

    this.container.appendChild(this.trackingBox);
    parent.appendChild(this.container);

    this.applyBoxStyle();
    this.bindEvents();
  }

  applyBoxStyle() {
    if (!this.trackingBox) return;
    this.trackingBox.style.left = `${(this.box.left * 100).toFixed(2)}%`;
    this.trackingBox.style.top = `${(this.box.top * 100).toFixed(2)}%`;
    this.trackingBox.style.width = `${(this.box.width * 100).toFixed(2)}%`;
    this.trackingBox.style.height = `${(this.box.height * 100).toFixed(2)}%`;
  }

  bindEvents() {
    if (!this.trackingBox || !this.container) return;

    this.trackingBox.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cs-box-resize-handle')) {
        this.isResizing = true;
      } else {
        this.isDragging = true;
        this.trackingBox.style.cursor = 'grabbing';
      }

      this.dragStart = { x: e.clientX, y: e.clientY };
      const contRect = this.container.getBoundingClientRect();
      const boxRect = this.trackingBox.getBoundingClientRect();

      this.boxStart = {
        left: boxRect.left - contRect.left,
        top: boxRect.top - contRect.top,
        width: boxRect.width,
        height: boxRect.height,
        contW: contRect.width,
        contH: contRect.height
      };

      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging && !this.isResizing) return;

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const { contW, contH } = this.boxStart;

      if (this.isDragging) {
        let newLeft = Math.max(0, Math.min(contW - this.boxStart.width, this.boxStart.left + dx));
        let newTop = Math.max(0, Math.min(contH - this.boxStart.height, this.boxStart.top + dy));

        this.box.left = newLeft / contW;
        this.box.top = newTop / contH;
        this.applyBoxStyle();
      } else if (this.isResizing) {
        let newW = Math.max(120, Math.min(contW - this.boxStart.left, this.boxStart.width + dx));
        // Keep 1 : 1.40 standard trading card ratio during resize
        let newH = Math.min(contH - this.boxStart.top, newW * 1.40);

        this.box.width = newW / contW;
        this.box.height = newH / contH;
        this.applyBoxStyle();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging || this.isResizing) {
        this.isDragging = false;
        this.isResizing = false;
        this.trackingBox.style.cursor = 'grab';
        chrome.storage.local.set({ cardViewfinderBox: this.box });
      }
    });
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
