/**
 * Card Scanner+ Real-Time Viewfinder & Auto-Scanner
 * Pixel-Perfect Viewport Coordinate Slicer & Continuous Card Presence Detector
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

    this.autoScanEnabled = false;
    this.autoScanTimer = null;
    this.lastFrameHash = 0;
    this.isScanningNow = false;

    // Default target box coordinates (percentages 0.0 -> 1.0)
    this.box = { x: 0.18, y: 0.15, w: 0.64, h: 0.65 };

    // Load saved settings
    chrome.storage.local.get(['viewfinderBox', 'autoScan'], (data) => {
      if (data && data.viewfinderBox) {
        this.box = data.viewfinderBox;
        this.applyBoxStyle();
      }
      if (data && data.autoScan !== undefined) {
        this.autoScanEnabled = Boolean(data.autoScan);
        this.updateAutoScanBadge();
      }
    });
  }

  init(videoElement) {
    if (!videoElement) return;
    this.video = videoElement;
    this.createTrackingUI();
    this.startAutoScanCheckLoop();
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
      border: 2.5px solid rgba(99, 102, 241, 0.95);
      border-radius: 14px;
      box-shadow: 0 0 22px rgba(99, 102, 241, 0.4), inset 0 0 16px rgba(99, 102, 241, 0.10);
      background: rgba(99, 102, 241, 0.03);
      pointer-events: auto;
      cursor: grab;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 8px;
      box-sizing: border-box;
      user-select: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    this.trackingBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">
        <span id="cs-tracker-status-tag" style="background: rgba(15, 23, 42, 0.9); color: #818cf8; font-family: sans-serif; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 5px; border: 1px solid rgba(99,102,241,0.4); display: flex; align-items: center; gap: 5px;">
          <span style="display:inline-block; width:6px; height:6px; background:#10b981; border-radius:50%; box-shadow: 0 0 6px #10b981;"></span>
          SCAN TARGET
        </span>
        <button id="cs-btn-toggle-autoscan" style="pointer-events: auto; background: rgba(15, 23, 42, 0.9); color: #94a3b8; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer;">
          Auto-Scan: OFF
        </button>
      </div>

      <div style="display: flex; justify-content: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.88); color: #f8fafc; font-family: sans-serif; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);">
          Drücke <b style="color: #818cf8;">[ S ]</b> zum Scannen
        </span>
      </div>

      <!-- Resize Corner Handle -->
      <div class="cs-resize-handle" data-dir="se" style="position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: se-resize; pointer-events: auto; display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;">
        <svg style="width:10px; height:10px; color:#818cf8;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
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

    // Toggle Auto-Scan
    const btnAuto = this.trackingBox.querySelector('#cs-btn-toggle-autoscan');
    if (btnAuto) {
      btnAuto.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAutoScan();
      });
    }

    // Mouse Drag Start
    this.trackingBox.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cs-resize-handle')) {
        this.isResizing = true;
        this.resizeHandle = 'se';
      } else if (e.target.id === 'cs-btn-toggle-autoscan') {
        return;
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

    // Mouse Move
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

    // Mouse Drag End
    window.addEventListener('mouseup', () => {
      if (this.isDragging || this.isResizing) {
        this.isDragging = false;
        this.isResizing = false;
        this.trackingBox.style.cursor = 'grab';
        chrome.storage.local.set({ viewfinderBox: this.box });
      }
    });
  }

  toggleAutoScan() {
    this.autoScanEnabled = !this.autoScanEnabled;
    chrome.storage.local.set({ autoScan: this.autoScanEnabled });
    this.updateAutoScanBadge();
    console.log(`[Card Scanner+] Auto-Scan toggled: ${this.autoScanEnabled}`);
  }

  updateAutoScanBadge() {
    if (!this.trackingBox) return;
    const btnAuto = this.trackingBox.querySelector('#cs-btn-toggle-autoscan');
    const tagStatus = this.trackingBox.querySelector('#cs-tracker-status-tag');

    if (this.autoScanEnabled) {
      if (btnAuto) {
        btnAuto.innerText = '⚡ Auto-Scan: ON';
        btnAuto.style.color = '#34d399';
        btnAuto.style.borderColor = 'rgba(52,211,153,0.5)';
      }
      if (tagStatus) {
        tagStatus.innerHTML = `<span style="display:inline-block; width:6px; height:6px; background:#34d399; border-radius:50%; box-shadow: 0 0 8px #34d399;"></span> AUTO ACTIVE`;
        tagStatus.style.color = '#34d399';
      }
      this.trackingBox.style.borderColor = 'rgba(52,211,153,0.9)';
      this.trackingBox.style.boxShadow = '0 0 24px rgba(52,211,153,0.4), inset 0 0 16px rgba(52,211,153,0.12)';
    } else {
      if (btnAuto) {
        btnAuto.innerText = 'Auto-Scan: OFF';
        btnAuto.style.color = '#94a3b8';
        btnAuto.style.borderColor = 'rgba(255,255,255,0.12)';
      }
      if (tagStatus) {
        tagStatus.innerHTML = `<span style="display:inline-block; width:6px; height:6px; background:#818cf8; border-radius:50%; box-shadow: 0 0 6px #818cf8;"></span> SCAN TARGET`;
        tagStatus.style.color = '#818cf8';
      }
      this.trackingBox.style.borderColor = 'rgba(99,102,241,0.95)';
      this.trackingBox.style.boxShadow = '0 0 20px rgba(99,102,241,0.4), inset 0 0 16px rgba(99,102,241,0.10)';
    }
  }

  startAutoScanCheckLoop() {
    if (this.autoScanTimer) clearInterval(this.autoScanTimer);

    this.autoScanTimer = setInterval(async () => {
      if (!this.autoScanEnabled || this.isScanningNow) return;

      if (window.cardScannerTriggerCapture) {
        this.isScanningNow = true;
        try {
          await window.cardScannerTriggerCapture(true); // silent auto-trigger
        } catch (e) {}
        setTimeout(() => { this.isScanningNow = false; }, 2500);
      }
    }, 3000);
  }

  getBoxRect() {
    if (!this.trackingBox) return null;
    return this.trackingBox.getBoundingClientRect();
  }

  destroy() {
    if (this.autoScanTimer) clearInterval(this.autoScanTimer);
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

window.cardTracker = new CardTracker();
