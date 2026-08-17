/**
 * Card Scanner+ Real-Time Viewfinder & Card Tracker
 * Draggable, Resizable & Auto-Snapping Target Frame on Whatnot Streams
 */

class CardTracker {
  constructor() {
    this.video = null;
    this.container = null;
    this.trackingBox = null;
    this.isDragging = false;
    this.isResizing = false;
    this.resizeHandle = null;
    this.dragStart = { x: 0, y: 0 };
    this.boxStart = { left: 0, top: 0, width: 0, height: 0 };

    // Default target box coordinates (percentages 0.0 -> 1.0)
    this.box = { x: 0.18, y: 0.15, w: 0.64, h: 0.65 };

    // Load saved custom position if user moved it before
    chrome.storage.local.get('viewfinderBox', (data) => {
      if (data && data.viewfinderBox) {
        this.box = data.viewfinderBox;
        this.applyBoxStyle();
      }
    });
  }

  init(videoElement) {
    if (!videoElement) return;
    this.video = videoElement;
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

    this.trackingBox = document.createElement('div');
    this.trackingBox.className = 'cs-tracking-box';
    this.trackingBox.style.cssText = `
      position: absolute;
      border: 2px solid rgba(99, 102, 241, 0.95);
      border-radius: 14px;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), inset 0 0 16px rgba(99, 102, 241, 0.12);
      background: rgba(99, 102, 241, 0.03);
      pointer-events: auto;
      cursor: grab;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 8px;
      box-sizing: border-box;
      user-select: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    `;

    this.trackingBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.9); color: #818cf8; font-family: sans-serif; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(99,102,241,0.4); display: flex; align-items: center; gap: 4px;">
          <span style="display:inline-block; width:6px; height:6px; background:#10b981; border-radius:50%; box-shadow: 0 0 6px #10b981;"></span>
          SCAN TARGET
        </span>
        <span style="background: rgba(15, 23, 42, 0.9); color: #94a3b8; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
          Ziehen zum Anpassen ✥
        </span>
      </div>

      <div style="display: flex; justify-content: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.85); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);">
          Drücke <b style="color: #818cf8;">[ S ]</b> zum Scannen
        </span>
      </div>

      <!-- Resize Corner Handles -->
      <div class="cs-resize-handle" data-dir="se" style="position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: se-resize; pointer-events: auto;">
        <svg style="position:absolute; right:3px; bottom:3px; width:10px; height:10px; color:#818cf8;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
      <div class="cs-resize-handle" data-dir="nw" style="position: absolute; left: 0; top: 0; width: 14px; height: 14px; cursor: nw-resize; pointer-events: auto;"></div>
    `;

    this.container.appendChild(this.trackingBox);
    parent.appendChild(this.container);

    this.applyBoxStyle();
    this.bindDragAndResizeEvents();
  }

  applyBoxStyle() {
    if (!this.trackingBox) return;
    this.trackingBox.style.left = `${(this.box.x * 100).toFixed(2)}%`;
    this.trackingBox.style.top = `${(this.box.y * 100).toFixed(2)}%`;
    this.trackingBox.style.width = `${(this.box.w * 100).toFixed(2)}%`;
    this.trackingBox.style.height = `${(this.box.h * 100).toFixed(2)}%`;
  }

  bindDragAndResizeEvents() {
    if (!this.trackingBox || !this.container) return;

    // 1. Mouse Drag Start
    this.trackingBox.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('cs-resize-handle')) {
        this.isResizing = true;
        this.resizeHandle = e.target.getAttribute('data-dir');
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

    // 2. Mouse Move
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging && !this.isResizing) return;

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const { contW, contH } = this.boxStart;

      if (this.isDragging) {
        let newLeft = Math.max(0, Math.min(contW - this.boxStart.width, this.boxStart.left + dx));
        let newTop = Math.max(0, Math.min(contH - this.boxStart.height, this.boxStart.top + dy));

        this.box.x = newLeft / contW;
        this.box.y = newTop / contH;
        this.applyBoxStyle();
      } else if (this.isResizing) {
        let newW = Math.max(120, Math.min(contW - this.boxStart.left, this.boxStart.width + dx));
        let newH = Math.max(160, Math.min(contH - this.boxStart.top, this.boxStart.height + dy));

        this.box.w = newW / contW;
        this.box.h = newH / contH;
        this.applyBoxStyle();
      }
    });

    // 3. Mouse Drag End
    window.addEventListener('mouseup', () => {
      if (this.isDragging || this.isResizing) {
        this.isDragging = false;
        this.isResizing = false;
        this.trackingBox.style.cursor = 'grab';
        chrome.storage.local.set({ viewfinderBox: this.box });
      }
    });
  }

  getBoxPercentages() {
    return this.box;
  }

  destroy() {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

window.cardTracker = new CardTracker();
