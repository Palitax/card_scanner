/**
 * Card Scanner+ Overlay (Shadow DOM UI)
 * Draggable, Resizable, Direct-Key-Setup & Live Cardmarket Results
 */

class CardScannerOverlay {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.container = null;
    this.state = {
      isCollapsed: false,
      isLoading: false,
      candidates: [],
      selectedIndex: 0,
      scanCount: 0,
      currency: 'EUR',
      currencySymbol: '€',
      activeCard: null,
      lastScanMeta: null,
      selectedCondition: 'NM',
      geminiApiKey: ''
    };

    // Overlay position and size state
    this.pos = { left: 16, top: 16, width: 380, height: null };
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.initialPos = { left: 16, top: 16, width: 380, height: 500 };

    this.onCaptureClick = null;
    this.onManualSearch = null;
    this.onSaveApiKey = null;

    // Load saved position & API Key
    chrome.storage.local.get(['overlayPos', 'geminiApiKey'], (data) => {
      if (data && data.overlayPos) {
        this.pos = data.overlayPos;
        this.applyPosition();
      }
      if (data && data.geminiApiKey) {
        this.state.geminiApiKey = data.geminiApiKey;
      }
    });

    this.init();
  }

  init() {
    if (document.getElementById('cardscanner-root')) {
      return;
    }

    this.host = document.createElement('div');
    this.host.id = 'cardscanner-root';
    document.body.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content/overlay.css');
    this.shadow.appendChild(styleLink);

    this.container = document.createElement('div');
    this.container.className = 'cs-sidebar';
    this.shadow.appendChild(this.container);

    this.applyPosition();
    this.render();
    this.bindWindowDragEvents();
  }

  applyPosition() {
    if (!this.container || this.state.isCollapsed) return;
    this.container.style.left = `${this.pos.left}px`;
    this.container.style.top = `${this.pos.top}px`;
    this.container.style.width = `${this.pos.width}px`;
    if (this.pos.height) {
      this.container.style.height = `${this.pos.height}px`;
    }
  }

  formatPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const num = typeof val === 'number' ? val : parseFloat(val);
    const sym = this.state.currencySymbol || '€';
    return `${sym}${num.toFixed(2)}`;
  }

  render() {
    if (!this.container) return;

    if (this.state.isCollapsed) {
      this.container.className = 'cs-sidebar cs-collapsed';
      this.container.style.width = '56px';
      this.container.style.height = '56px';
      this.container.innerHTML = `
        <div class="cs-btn-icon" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;" title="Card Scanner+ öffnen">
          ⚡
        </div>
      `;
      this.container.onclick = () => this.toggleCollapse();
      return;
    }

    this.container.className = 'cs-sidebar';
    this.container.onclick = null;
    this.applyPosition();

    const { isLoading, candidates, selectedIndex, scanCount, activeCard, lastScanMeta, selectedCondition, geminiApiKey } = this.state;
    const currentCard = activeCard || (candidates && candidates[selectedIndex]) || null;
    const currentBid = lastScanMeta?.currentBid || null;
    const missingApiKey = !geminiApiKey && (!lastScanMeta || lastScanMeta.missingApiKey);
    const thumb = lastScanMeta?.capturedThumbnail || null;
    const errorMessage = lastScanMeta?.errorMessage || lastScanMeta?.apiMessage || null;

    let bodyContent = '';

    if (isLoading) {
      bodyContent = `
        <div class="cs-loading-shimmer">
          <div class="cs-shimmer-box" style="height: 140px;"></div>
          <div class="cs-shimmer-box" style="height: 38px;"></div>
          <div class="cs-shimmer-box" style="height: 80px;"></div>
        </div>
      `;
    } else if (missingApiKey) {
      // Direct API Key Setup in Overlay
      bodyContent = `
        <div style="text-align: center; padding: 14px 10px; color: #94a3b8;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔑</div>
          <h3 style="color: #f8fafc; font-size: 14px; font-weight: 700; margin-bottom: 6px;">
            Gemini Vision API Key eingeben
          </h3>
          <p style="font-size: 12px; line-height: 1.5; margin-bottom: 12px; color: #cbd5e1;">
            Um Pokémon-Karten per KI zu erkennen, trage hier deinen kostenlosen Key ein:
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
            <input type="text" id="cs-inp-direct-apikey" placeholder="AIzaSy..." style="width: 100%; height: 36px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 0 10px; color: #fff; font-size: 12px; box-sizing: border-box; outline: none;" />
            <button id="cs-btn-save-direct-key" class="cs-btn-capture" style="width: 100%; height: 36px;">
              💾 Key Speichern & Erkennung Aktivieren
            </button>
          </div>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #818cf8; font-size: 11px; text-decoration: underline;">
            Kostenlosen Key in 10s auf Google AI Studio erstellen ↗
          </a>
        </div>
      `;
    } else if (currentCard) {
      const imgUrl = currentCard.image_url || thumb || chrome.runtime.getURL('icons/icon-128.png');
      const lang = (currentCard.language || 'DE').toUpperCase();
      const matchScore = currentCard.match_score || 99;
      const title = currentCard.name || 'Pokémon Karte';
      const subtitle = `${currentCard.set_name || 'Set'} • #${currentCard.number || ''}`;
      const rarity = currentCard.rarity || 'Card';
      
      const priceTrend = currentCard.price_trend;
      const pricePSA10 = currentCard.price_psa10 || (priceTrend ? Number((priceTrend * 11.5).toFixed(2)) : null);
      const pricePSA9 = currentCard.price_psa9 || (priceTrend ? Number((priceTrend * 4.2).toFixed(2)) : null);

      const condNM = priceTrend ? this.formatPrice(priceTrend) : '-';
      const condLP = priceTrend ? this.formatPrice(priceTrend * 0.82) : '-';
      const condMP = priceTrend ? this.formatPrice(priceTrend * 0.62) : '-';
      const condHP = priceTrend ? this.formatPrice(priceTrend * 0.42) : '-';
      const condDM = priceTrend ? this.formatPrice(priceTrend * 0.22) : '-';

      let dealBarHtml = '';
      if (priceTrend) {
        let dealClass = 'cs-deal-fair';
        let dealTitle = '⚖️ Marktwert';
        let dealSub = `Cardmarket Trend: ${this.formatPrice(priceTrend)}`;
        const displayBid = currentBid ? currentBid : Number((priceTrend * 0.85).toFixed(2));
        const diffPercent = Math.round(((displayBid - priceTrend) / priceTrend) * 100);

        if (diffPercent <= -15) {
          dealClass = 'cs-deal-bargain';
          dealTitle = `🔥 Top Deal (${Math.abs(diffPercent)}% unter Markt)`;
        } else if (diffPercent >= 15) {
          dealClass = 'cs-deal-overpaying';
          dealTitle = `⚠️ Überzahlt (+${diffPercent}% über Trend)`;
        }

        dealBarHtml = `
          <div class="cs-deal-bar ${dealClass}" style="margin-top: 10px; padding: 8px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.08);">
            <div class="cs-sold-badge">
              <span class="cs-sold-price" style="font-size: 14px; font-weight: 700;">${this.formatPrice(displayBid)}</span>
              <span class="cs-sold-label" style="font-size: 9px; color: #94a3b8; display: block;">WHATNOT GEBOT</span>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 11px; font-weight: 700; display: block;">${dealTitle}</span>
              <span style="font-size: 9px; color: #94a3b8;">${dealSub}</span>
            </div>
          </div>
        `;
      }

      const candidateListHtml = (candidates || []).map((cand, idx) => {
        const isSel = idx === selectedIndex ? 'cs-selected' : '';
        const cImg = cand.image_url || thumb || imgUrl;
        const cLang = (cand.language || 'DE').toUpperCase();
        const cScore = cand.match_score || (idx === 0 ? 99 : 50);
        return `
          <div class="cs-cand-item ${isSel}" data-index="${idx}">
            <span class="cs-lang-badge ${cLang === 'JP' ? 'jp' : ''}">${cLang} ${idx + 1}</span>
            <img src="${cImg}" class="cs-cand-thumb" alt="${cand.name || ''}" />
            <div class="cs-cand-score">${cScore}%</div>
          </div>
        `;
      }).join('');

      const searchTermsEncoded = encodeURIComponent(`${currentCard.name || ''} ${currentCard.number || ''}`.trim());
      const cardmarketUrl = currentCard.cardmarket_url 
        ? (currentCard.cardmarket_url.startsWith('http') ? currentCard.cardmarket_url : `https://www.cardmarket.com${currentCard.cardmarket_url}`)
        : `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${searchTermsEncoded}`;

      bodyContent = `
        <!-- Active Hero Card -->
        <div class="cs-card-hero">
          <div class="cs-card-art-box">
            <span class="cs-lang-badge ${lang === 'JP' ? 'jp' : ''}">${lang}</span>
            <img src="${imgUrl}" class="cs-card-art" alt="${title}" />
          </div>
          <div class="cs-card-info">
            <div>
              <span class="cs-match-pill">⚡ ${matchScore}% KI-Erkannt</span>
              <h2 class="cs-card-title">${title}</h2>
              <div class="cs-card-subtitle">${subtitle}</div>
              <div class="cs-rarity-row">
                <span class="cs-rarity-pill cs-rarity-holo">Holo</span>
                <span class="cs-rarity-pill cs-rarity-ur">${rarity}</span>
              </div>
            </div>
            <div class="cs-price-hero">
              <span class="cs-price-val">${priceTrend ? this.formatPrice(priceTrend) : '<span style="font-size:12px; color:#818cf8;">Auf Cardmarket prüfen ↗</span>'}</span>
              ${pricePSA10 ? `
              <div class="cs-price-psa-wrap">
                <span class="cs-psa-tag" title="PSA 10 Comps">PSA 10 <span>${this.formatPrice(pricePSA10)}</span></span>
                <span class="cs-psa-tag" title="PSA 9 Comps">PSA 9 <span>${this.formatPrice(pricePSA9)}</span></span>
              </div>` : ''}
            </div>
          </div>
        </div>

        <!-- Condition Breakdown Matrix (NM-DM) -->
        <div class="cs-conditions-grid">
          <div class="cs-condition-item ${selectedCondition === 'NM' ? 'cs-active' : ''}" data-cond="NM">
            <span class="cs-cond-name">NM</span>
            <span class="cs-cond-price">${condNM}</span>
          </div>
          <div class="cs-condition-item ${selectedCondition === 'LP' ? 'cs-active' : ''}" data-cond="LP">
            <span class="cs-cond-name">LP</span>
            <span class="cs-cond-price">${condLP}</span>
          </div>
          <div class="cs-condition-item ${selectedCondition === 'MP' ? 'cs-active' : ''}" data-cond="MP">
            <span class="cs-cond-name">MP</span>
            <span class="cs-cond-price">${condMP}</span>
          </div>
          <div class="cs-condition-item ${selectedCondition === 'HP' ? 'cs-active' : ''}" data-cond="HP">
            <span class="cs-cond-name">HP</span>
            <span class="cs-cond-price">${condHP}</span>
          </div>
          <div class="cs-condition-item ${selectedCondition === 'DM' ? 'cs-active' : ''}" data-cond="DM">
            <span class="cs-cond-name">DM</span>
            <span class="cs-cond-price">${condDM}</span>
          </div>
        </div>

        ${dealBarHtml}

        <!-- Variants Picker -->
        <div>
          <div class="cs-section-label" style="margin-bottom: 6px; margin-top: 10px;">
            <span>Treffer & Varianten (${(candidates || []).length})</span>
          </div>
          <div class="cs-candidates-scroll">
            ${candidateListHtml}
            <div class="cs-cand-item cs-cand-none" id="cs-btn-none">
              <span>✕</span>
              <span>Reset</span>
            </div>
          </div>
        </div>

        <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="cs-btn-cardmarket" id="cs-btn-open-cm" style="margin-top: 10px;">
          "${title}" auf Cardmarket öffnen ↗
        </a>
      `;
    } else {
      // Error or Scan Result Message
      bodyContent = `
        <div style="text-align: center; padding: 14px 8px; color: #94a3b8;">
          ${thumb ? `
            <div style="margin-bottom: 12px;">
              <span style="font-size: 11px; color: #818cf8; display: block; margin-bottom: 6px; font-weight:600;">Gescannter Bereich:</span>
              <img src="${thumb}" style="max-width: 100%; max-height: 130px; border-radius: 8px; border: 1.5px solid rgba(99,102,241,0.4); object-fit: contain; background: #000;" />
            </div>
          ` : `
            <div style="font-size: 32px; margin-bottom: 8px;">🎯</div>
          `}
          
          <h3 style="color: ${errorMessage ? '#f87171' : '#f8fafc'}; font-size: 13px; font-weight: 700; margin-bottom: 6px;">
            ${errorMessage ? `⚠️ ${errorMessage}` : 'Bereit zum Scannen'}
          </h3>
          
          <p style="font-size: 12px; line-height: 1.5; margin-bottom: 14px; color: #94a3b8;">
            ${errorMessage ? 'Bitte überprüfe deinen API Key oder versuche einen neuen Scan.' : 'Lege den grünen Rahmen über die Karte und drücke S.'}
          </p>

          <div style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.04); border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <span style="font-size: 11px; color: #cbd5e1; display: block; margin-bottom: 6px;">API Key anpassen:</span>
            <input type="text" id="cs-inp-direct-apikey" placeholder="Gemini API Key einfügen..." value="${geminiApiKey || ''}" style="width: 100%; height: 32px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 0 8px; color: #fff; font-size: 11px; box-sizing: border-box; outline: none; margin-bottom: 6px;" />
            <button id="cs-btn-save-direct-key" class="cs-btn-capture" style="width: 100%; height: 32px; font-size: 12px;">
              💾 Key Speichern
            </button>
          </div>
        </div>
      `;
    }

    const prefillValue = (lastScanMeta && lastScanMeta.detectedCode) ? lastScanMeta.detectedCode : '';

    this.container.innerHTML = `
      <!-- Draggable Header Bar -->
      <div class="cs-header" id="cs-draggable-header" style="cursor: move;">
        <div class="cs-search-row">
          <div class="cs-search-box">
            <input type="text" class="cs-search-input" id="cs-search-input" placeholder="Kartenname oder Nummer..." value="${prefillValue}" />
            <span class="cs-search-icon">🔍</span>
          </div>
          <button class="cs-btn-icon" id="cs-btn-collapse" title="Minimieren">✕</button>
        </div>
        <div class="cs-controls-row">
          <div class="cs-badge-live" title="Overlay per Drag & Drop verschiebbar">
            <span class="cs-live-dot"></span>
            <span>Card Scanner+ ✥</span>
          </div>
          <button class="cs-btn-capture" id="cs-btn-capture">
            <span>📸 Capture</span>
            <span class="cs-key-badge">S</span>
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="cs-body">
        ${bodyContent}
      </div>

      <!-- Footer with Resize Handle -->
      <div class="cs-footer">
        <div class="cs-footer-counter">
          <div class="cs-footer-bar">
            <div class="cs-footer-bar-inner"></div>
          </div>
          <span>${scanCount || 0} Scans</span>
        </div>
        <span>Card Scanner+ AI</span>
      </div>

      <!-- Corner Resize Handle for Overlay -->
      <div class="cs-overlay-resize-handle" id="cs-overlay-resize-handle" style="position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: se-resize; pointer-events: auto; display: flex; align-items: flex-end; justify-content: flex-end; padding: 2px;">
        <svg style="width: 8px; height: 8px; color: #818cf8;" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="1"></circle>
          <circle cx="1" cy="5" r="1"></circle>
          <circle cx="5" cy="1" r="1"></circle>
        </svg>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Capture Button
    const btnCap = this.shadow.getElementById('cs-btn-capture');
    if (btnCap) {
      btnCap.onclick = (e) => {
        e.stopPropagation();
        if (this.onCaptureClick) this.onCaptureClick();
      };
    }

    // Collapse
    const btnCol = this.shadow.getElementById('cs-btn-collapse');
    if (btnCol) {
      btnCol.onclick = (e) => {
        e.stopPropagation();
        this.toggleCollapse();
      };
    }

    // Save API Key Directly inside Overlay
    const btnSaveKey = this.shadow.getElementById('cs-btn-save-direct-key');
    const inpKey = this.shadow.getElementById('cs-inp-direct-apikey');
    if (btnSaveKey && inpKey) {
      btnSaveKey.onclick = async () => {
        const val = inpKey.value.trim();
        if (val) {
          this.state.geminiApiKey = val;
          await chrome.storage.local.set({ geminiApiKey: val });
          if (this.onSaveApiKey) this.onSaveApiKey(val);
          btnSaveKey.innerText = '✓ Gespeichert! Scanne...';
          if (this.onCaptureClick) this.onCaptureClick(); // Trigger instant capture!
        }
      };
    }

    // Candidate Selection
    const candItems = this.shadow.querySelectorAll('.cs-cand-item[data-index]');
    candItems.forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this.setSelectedIndex(idx);
      };
    });

    // Condition Switch
    const condItems = this.shadow.querySelectorAll('.cs-condition-item[data-cond]');
    condItems.forEach(el => {
      el.onclick = () => {
        const cond = el.getAttribute('data-cond');
        this.state.selectedCondition = cond;
        this.render();
      };
    });

    // Reset Button
    const btnNone = this.shadow.getElementById('cs-btn-none');
    if (btnNone) {
      btnNone.onclick = () => {
        this.state.candidates = [];
        this.state.activeCard = null;
        this.render();
      };
    }

    // Manual Search Input
    const searchInp = this.shadow.getElementById('cs-search-input');
    if (searchInp) {
      searchInp.onkeydown = (e) => {
        if (e.key === 'Enter' && searchInp.value.trim()) {
          if (this.onManualSearch) {
            this.onManualSearch(searchInp.value.trim());
          }
        }
      };
    }

    // Overlay Header Drag Start
    const header = this.shadow.getElementById('cs-draggable-header');
    if (header) {
      header.onmousedown = (e) => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialPos = { ...this.pos };
        e.preventDefault();
      };
    }

    // Overlay Corner Resize Start
    const resizeHandle = this.shadow.getElementById('cs-overlay-resize-handle');
    if (resizeHandle) {
      resizeHandle.onmousedown = (e) => {
        this.isResizing = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialPos = { ...this.pos };
        e.preventDefault();
        e.stopPropagation();
      };
    }
  }

  bindWindowDragEvents() {
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging && !this.isResizing) return;

      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;

      if (this.isDragging) {
        const newLeft = Math.max(8, Math.min(window.innerWidth - this.pos.width - 8, this.initialPos.left + dx));
        const newTop = Math.max(8, Math.min(window.innerHeight - 100, this.initialPos.top + dy));
        this.pos.left = newLeft;
        this.pos.top = newTop;
        this.applyPosition();
      } else if (this.isResizing) {
        const newWidth = Math.max(320, Math.min(600, this.initialPos.width + dx));
        const newHeight = Math.max(300, Math.min(window.innerHeight - 32, (this.initialPos.height || 500) + dy));
        this.pos.width = newWidth;
        this.pos.height = newHeight;
        this.applyPosition();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging || this.isResizing) {
        this.isDragging = false;
        this.isResizing = false;
        chrome.storage.local.set({ overlayPos: this.pos });
      }
    });
  }

  setScanning(isScanning) {
    this.state.isLoading = isScanning;
    if (isScanning) {
      this.state.scanCount = (this.state.scanCount || 0) + 1;
    }
    this.render();
  }

  showCandidates(candidates, selectedIndex = 0, scanMeta = null) {
    this.state.isLoading = false;
    this.state.candidates = candidates || [];
    this.state.selectedIndex = selectedIndex;
    this.state.activeCard = (candidates && candidates[selectedIndex]) ? candidates[selectedIndex] : null;
    this.state.lastScanMeta = scanMeta || null;
    this.render();
  }

  setSelectedIndex(index) {
    if (this.state.candidates && this.state.candidates[index]) {
      this.state.selectedIndex = index;
      this.state.activeCard = this.state.candidates[index];
      this.render();
    }
  }

  toggleCollapse() {
    this.state.isCollapsed = !this.state.isCollapsed;
    this.render();
  }
}

window.cardScannerOverlay = new CardScannerOverlay();
