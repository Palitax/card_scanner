/**
 * Card Scanner+ Overlay (Shadow DOM UI)
 * Fully isolated Shadow DOM component matching the reference stream UI
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
      activeCard: null
    };
    this.onCaptureClick = null;
    this.onManualSearch = null;
    this.init();
  }

  init() {
    if (document.getElementById('cardscanner-root')) {
      return;
    }

    // 1. Create Host Container in Host DOM
    this.host = document.createElement('div');
    this.host.id = 'cardscanner-root';
    document.body.appendChild(this.host);

    // 2. Attach Closed/Open Shadow Root for style isolation
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // 3. Inject Stylesheet Link
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content/overlay.css');
    this.shadow.appendChild(styleLink);

    // 4. Create Main Wrapper
    this.container = document.createElement('div');
    this.container.className = 'cs-sidebar';
    this.shadow.appendChild(this.container);

    this.render();
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
      this.container.innerHTML = `
        <div class="cs-btn-icon" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:18px;" title="Card Scanner+ öffnen">
          ⚡
        </div>
      `;
      this.container.onclick = () => this.toggleCollapse();
      return;
    }

    this.container.className = 'cs-sidebar';
    this.container.onclick = null;

    const { isLoading, candidates, selectedIndex, scanCount, activeCard } = this.state;
    const currentCard = activeCard || (candidates && candidates[selectedIndex]) || null;

    let bodyContent = '';

    if (isLoading) {
      bodyContent = `
        <div class="cs-loading-shimmer">
          <div class="cs-shimmer-box" style="height: 140px;"></div>
          <div class="cs-shimmer-box" style="height: 38px;"></div>
          <div class="cs-shimmer-box" style="height: 80px;"></div>
        </div>
      `;
    } else if (currentCard) {
      // Active Hero Card Details
      const imgUrl = currentCard.image_url || chrome.runtime.getURL('icons/icon-128.png');
      const lang = (currentCard.language || 'EN').toUpperCase();
      const matchScore = currentCard.match_score || 99;
      const title = currentCard.name || 'Pokémon Karte';
      const subtitle = `${currentCard.set_name || 'Set'} • #${currentCard.number || '000'}`;
      const rarity = currentCard.rarity || 'Ultra Rare';
      
      const priceTrend = currentCard.price_trend || currentCard.price || 3.85;
      const pricePSA10 = currentCard.price_psa10 || (priceTrend * 12.0).toFixed(2);
      const pricePSA9 = currentCard.price_psa9 || (priceTrend * 4.5).toFixed(2);

      // Conditions NM -> DM
      const condNM = this.formatPrice(priceTrend);
      const condLP = this.formatPrice(priceTrend * 0.8);
      const condMP = this.formatPrice(priceTrend * 0.6);
      const condHP = this.formatPrice(priceTrend * 0.4);
      const condDM = this.formatPrice(priceTrend * 0.2);

      // Candidate picker items
      const candidateListHtml = (candidates || []).map((cand, idx) => {
        const isSel = idx === selectedIndex ? 'cs-selected' : '';
        const cImg = cand.image_url || imgUrl;
        const cLang = (cand.language || 'EN').toUpperCase();
        const cScore = cand.match_score || (idx === 0 ? 99 : 50);
        return `
          <div class="cs-cand-item ${isSel}" data-index="${idx}">
            <span class="cs-lang-badge ${cLang === 'JP' ? 'jp' : ''}">${cLang} ${idx + 1}</span>
            <img src="${cImg}" class="cs-cand-thumb" alt="${cand.name || ''}" />
            <div class="cs-cand-score">${cScore}%</div>
          </div>
        `;
      }).join('');

      // Cardmarket URL
      const cardmarketUrl = currentCard.cardmarket_url 
        ? (currentCard.cardmarket_url.startsWith('http') ? currentCard.cardmarket_url : `https://www.cardmarket.com${currentCard.cardmarket_url}`)
        : `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(currentCard.name || '')}`;

      bodyContent = `
        <!-- Active Hero Card -->
        <div class="cs-card-hero">
          <div class="cs-card-art-box">
            <span class="cs-lang-badge ${lang === 'JP' ? 'jp' : ''}">${lang}</span>
            <img src="${imgUrl}" class="cs-card-art" alt="${title}" />
          </div>
          <div class="cs-card-info">
            <div>
              <span class="cs-match-pill">${matchScore}% match</span>
              <h2 class="cs-card-title">${title}</h2>
              <div class="cs-card-subtitle">${subtitle}</div>
              <div class="cs-rarity-row">
                <span class="cs-rarity-pill cs-rarity-holo">Holo</span>
                <span class="cs-rarity-pill cs-rarity-ur">${rarity}</span>
              </div>
            </div>
            <div class="cs-price-hero">
              <span class="cs-price-val">${this.formatPrice(priceTrend)}</span>
              <div class="cs-price-psa-wrap">
                <span class="cs-psa-tag">PSA 10 <span>${this.formatPrice(pricePSA10)}</span></span>
                <span class="cs-psa-tag">PSA 9 <span>${this.formatPrice(pricePSA9)}</span></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Condition Breakdown Pills -->
        <div class="cs-conditions-grid">
          <div class="cs-condition-item cs-active">
            <span class="cs-cond-name">NM</span>
            <span class="cs-cond-price">${condNM}</span>
          </div>
          <div class="cs-condition-item">
            <span class="cs-cond-name">LP</span>
            <span class="cs-cond-price">${condLP}</span>
          </div>
          <div class="cs-condition-item">
            <span class="cs-cond-name">MP</span>
            <span class="cs-cond-price">${condMP}</span>
          </div>
          <div class="cs-condition-item">
            <span class="cs-cond-name">HP</span>
            <span class="cs-cond-price">${condHP}</span>
          </div>
          <div class="cs-condition-item">
            <span class="cs-cond-name">DM</span>
            <span class="cs-cond-price">${condDM}</span>
          </div>
        </div>

        <!-- Candidates Picker -->
        <div>
          <div class="cs-section-label" style="margin-bottom: 6px;">
            <span>Candidates (${(candidates || []).length})</span>
          </div>
          <div class="cs-candidates-scroll">
            ${candidateListHtml}
            <div class="cs-cand-item cs-cand-none" id="cs-btn-none">
              <span>✕</span>
              <span>None</span>
            </div>
          </div>
        </div>

        <!-- Sold & Market Deal Comparison -->
        <div class="cs-deal-bar">
          <div class="cs-sold-badge">
            <span class="cs-sold-price">${this.formatPrice(priceTrend * 1.8)}</span>
            <span class="cs-sold-label">SOLD</span>
          </div>
          <div class="cs-deal-pill cs-deal-overpaying">
            <span>mkt ${this.formatPrice(priceTrend)}</span>
            <span>↑80% Overpaying</span>
          </div>
        </div>

        <!-- Direct Cardmarket Action -->
        <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="cs-btn-cardmarket">
          Auf Cardmarket öffnen ↗
        </a>
      `;
    } else {
      // Empty / Fallback State
      bodyContent = `
        <div style="text-align: center; padding: 24px 10px; color: #94a3b8;">
          <div style="font-size: 32px; margin-bottom: 8px;">📷</div>
          <h3 style="color: #f8fafc; font-size: 14px; margin-bottom: 4px;">Bereit zum Scannen</h3>
          <p style="font-size: 12px; line-height: 1.4; margin-bottom: 12px;">
            Drücke <b style="color:#818cf8;">S</b> im Livestream oder nutze die Suche oben.
          </p>
          <a href="https://www.cardmarket.com/de/Pokemon" target="_blank" class="cs-btn-cardmarket" style="max-width:200px;margin:0 auto;">
            Cardmarket Suche ↗
          </a>
        </div>
      `;
    }

    this.container.innerHTML = `
      <!-- Header -->
      <div class="cs-header">
        <div class="cs-search-row">
          <div class="cs-search-box">
            <input type="text" class="cs-search-input" id="cs-search-input" placeholder="Karten oder Nummern suchen..." />
            <span class="cs-search-icon">🔍</span>
          </div>
          <button class="cs-btn-icon" id="cs-btn-collapse" title="Minimieren">✕</button>
        </div>
        <div class="cs-controls-row">
          <div class="cs-badge-live">
            <span class="cs-live-dot"></span>
            <span>Live</span>
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

      <!-- Footer -->
      <div class="cs-footer">
        <div class="cs-footer-counter">
          <div class="cs-footer-bar">
            <div class="cs-footer-bar-inner"></div>
          </div>
          <span>${scanCount || 1} Scans</span>
        </div>
        <span>Card Scanner+</span>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Capture Button Click
    const btnCap = this.shadow.getElementById('cs-btn-capture');
    if (btnCap) {
      btnCap.onclick = (e) => {
        e.stopPropagation();
        if (this.onCaptureClick) this.onCaptureClick();
      };
    }

    // Collapse Button Click
    const btnCol = this.shadow.getElementById('cs-btn-collapse');
    if (btnCol) {
      btnCol.onclick = (e) => {
        e.stopPropagation();
        this.toggleCollapse();
      };
    }

    // Candidate item clicks
    const candItems = this.shadow.querySelectorAll('.cs-cand-item[data-index]');
    candItems.forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this.setSelectedIndex(idx);
      };
    });

    // None candidate button click
    const btnNone = this.shadow.getElementById('cs-btn-none');
    if (btnNone) {
      btnNone.onclick = () => {
        this.state.candidates = [];
        this.state.activeCard = null;
        this.render();
      };
    }

    // Search Input Enter
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
  }

  setScanning(isScanning) {
    this.state.isLoading = isScanning;
    if (isScanning) {
      this.state.scanCount = (this.state.scanCount || 0) + 1;
    }
    this.render();
  }

  showCandidates(candidates, selectedIndex = 0) {
    this.state.isLoading = false;
    this.state.candidates = candidates || [];
    this.state.selectedIndex = selectedIndex;
    this.state.activeCard = (candidates && candidates[selectedIndex]) ? candidates[selectedIndex] : null;
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

// Attach singleton to window
window.cardScannerOverlay = new CardScannerOverlay();
