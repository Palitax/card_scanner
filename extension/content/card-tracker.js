/**
 * Card Scanner+ Universal Viewfinder & Smart Card Snapper
 * Accurately locks onto foreground card images, background-images & pre-bid product photos
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
      top: Math.round(window.innerHeight * 0.16),
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
      transition: border-color 0.2s ease, box-shadow 0.2s ease, top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease;
    `;

    this.trackingBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">
        <span style="background: rgba(15, 23, 42, 0.92); color: #34d399; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(52,211,153,0.4); display: flex; align-items: center; gap: 4px; backdrop-filter: blur(6px);">
          <span style="display:inline-block; width:6px; height:6px; background:#34d399; border-radius:50%; box-shadow: 0 0 6px #34d399;"></span>
          ⚡ KARTEN-ZIEL
        </span>
        <button id="cs-btn-snap-img" style="pointer-events: auto; background: rgba(15, 23, 42, 0.9); color: #34d399; font-family: sans-serif; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(52,211,153,0.4); cursor: pointer;" title="Automatisch auf offene Karte einrasten">
          🎯 Auf Karte einrasten
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

    // Auto-snap on start
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
   * Intelligently locks onto the foreground card (Filtering out 9:16 stream backgrounds)
   */
  autoSnapToProminentImage() {
    // Collect all potential card elements (img, video, div with background-image)
    const elements = Array.from(document.querySelectorAll('img, video, [style*="background-image"], [class*="Image"], [class*="media"], [class*="thumbnail"], [class*="photo"]')).filter(el => {
      if (el.closest('#cardscanner-root') || el.closest('#cardscanner-tracker-layer')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 150) return false;
      if (r.top < -50 || r.top > window.innerHeight || r.left < 0 || r.left > window.innerWidth) return false;

      // Check card aspect ratio
      const ratio = r.height / r.width;
      return ratio >= 1.15 && ratio <= 1.65;
    });

    if (elements.length === 0) {
      // Fallback: Check elements around center of viewport
      const centerEl = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (centerEl && !centerEl.closest('#cardscanner-root') && !centerEl.closest('#cardscanner-tracker-layer')) {
        const r = centerEl.getBoundingClientRect();
        if (r.width >= 140 && r.height >= 180) {
          elements.push(centerEl);
        }
      }
    }

    if (elements.length > 0) {
      // Sort by proximity to center of viewport
      elements.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        const distA = Math.hypot((rA.left + rA.width / 2) - window.innerWidth / 2, (rA.top + rA.height / 2) - window.innerHeight / 2);
        const distB = Math.hypot((rB.left + rB.width / 2) - window.innerWidth / 2, (rB.top + rB.height / 2) - window.innerHeight / 2);
        return distA - distB;
      });

      const best = elements[0];
      const r = best.getBoundingClientRect();

      this.pos = {
        left: Math.max(8, Math.round(r.left - 2)),
        top: Math.max(8, Math.round(r.top - 2)),
        width: Math.round(r.width + 4),
        height: Math.round(r.height + 4)
      };

      this.applyBoxStyle();
      console.log('[Card Scanner+] ✓ Auto-snapped directly to card:', best, this.pos);
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

      // When clicking on a product or image, poll for 800ms to catch the opened card picture
      [150, 350, 600, 900].forEach(delay => {
        setTimeout(() => {
          this.autoSnapToProminentImage();
        }, delay);
      });
    }, true);

    // Also observe DOM additions (modals/drawers)
    const observer = new MutationObserver(() => {
      this.autoSnapToProminentImage();
    });

    observer.observe(document.body, { childList: true, subtree: true });
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
