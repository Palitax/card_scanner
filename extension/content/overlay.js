/**
 * Card Scanner+ Overlay (Shadow DOM UI)
 * Live Cardmarket Comps, Live Bid & Overpaying Analyzer & Graded Comps
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
      selectedCondition: 'NM'
    };
    this.onCaptureClick = null;
    this.onManualSearch = null;
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

    const { isLoading, candidates, selectedIndex, scanCount, activeCard, lastScanMeta, selectedCondition } = this.state;
    const currentCard = activeCard || (candidates && candidates[selectedIndex]) || null;
    const currentBid = lastScanMeta?.currentBid || null;

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
      const imgUrl = currentCard.image_url || chrome.runtime.getURL('icons/icon-128.png');
      const lang = (currentCard.language || 'EN').toUpperCase();
      const matchScore = currentCard.match_score || 99;
      const title = currentCard.name || 'Pokémon Karte';
      const subtitle = `${currentCard.set_name || 'Set'} • #${currentCard.number || ''}`;
      const rarity = currentCard.rarity || 'Ultra Rare';
      
      const priceTrend = currentCard.price_trend;
      const pricePSA10 = currentCard.price_psa10 || (priceTrend ? Number((priceTrend * 11.5).toFixed(2)) : null);
      const pricePSA9 = currentCard.price_psa9 || (priceTrend ? Number((priceTrend * 4.2).toFixed(2)) : null);

      // Condition Multipliers from TCG Engine
      const condNM = priceTrend ? this.formatPrice(priceTrend) : '-';
      const condLP = priceTrend ? this.formatPrice(priceTrend * 0.82) : '-';
      const condMP = priceTrend ? this.formatPrice(priceTrend * 0.62) : '-';
      const condHP = priceTrend ? this.formatPrice(priceTrend * 0.42) : '-';
      const condDM = priceTrend ? this.formatPrice(priceTrend * 0.22) : '-';

      // Live Bid & Overpaying Analyzer (Feature 3)
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
          <!-- Live Bid & Deal Analyzer Bar -->
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

      // Candidates Variant Carousel (Feature 2)
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
              <span class="cs-price-val">${priceTrend ? this.formatPrice(priceTrend) : 'Preise laden...'}</span>
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
            <span>Variants (${(candidates || []).length})</span>
          </div>
          <div class="cs-candidates-scroll">
            ${candidateListHtml}
            <div class="cs-cand-item cs-cand-none" id="cs-btn-none">
              <span>✕</span>
              <span>None</span>
            </div>
          </div>
        </div>

        <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="cs-btn-cardmarket" id="cs-btn-open-cm" style="margin-top: 10px;">
          Auf Cardmarket öffnen ↗
        </a>
      `;
    } else {
      // Empty State
      const detectedCode = lastScanMeta && lastScanMeta.detectedCode ? lastScanMeta.detectedCode : null;
      const thumb = lastScanMeta && lastScanMeta.capturedThumbnail ? lastScanMeta.capturedThumbnail : null;

      const cmSearchUrl = detectedCode
        ? `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(detectedCode)}`
        : 'https://www.cardmarket.com/de/Pokemon/Products/Search';

      bodyContent = `
        <div style="text-align: center; padding: 14px 6px; color: #94a3b8;">
          ${thumb ? `
            <div style="margin-bottom: 10px;">
              <span style="font-size: 11px; color: #818cf8; display: block; margin-bottom: 4px;">⚡ Auto-Tracked Card:</span>
              <img src="${thumb}" style="max-width: 100%; max-height: 115px; border-radius: 8px; border: 1px solid rgba(99,102,241,0.3); object-fit: contain; background: #000;" />
            </div>
          ` : `
            <div style="font-size: 28px; margin-bottom: 6px;">🎯</div>
          `}
          
          <h3 style="color: #f8fafc; font-size: 13px; margin-bottom: 4px;">
            ${detectedCode ? `Erkannt: "${detectedCode}"` : 'Auto-Tracker Aktiv'}
          </h3>
          
          <p style="font-size: 12px; line-height: 1.4; margin-bottom: 12px; color: #94a3b8;">
            ${detectedCode ? 'Nummer nicht in der Datenbank gefunden.' : 'Der grüne Rahmen folgt der Karte im Stream. Drücke einfach <b style="color:#818cf8;">S</b> zum Scannen.'}
          </p>
          
          <a href="${cmSearchUrl}" target="_blank" class="cs-btn-cardmarket" id="cs-btn-fallback-cm" style="max-width:260px; margin: 0 auto;">
            🔍 ${detectedCode ? `"${detectedCode}" auf Cardmarket suchen ↗` : 'Auf Cardmarket suchen ↗'}
          </a>
        </div>
      `;
    }

    const prefillValue = (lastScanMeta && lastScanMeta.detectedCode) ? lastScanMeta.detectedCode : '';

    this.container.innerHTML = `
      <!-- Header -->
      <div class="cs-header">
        <div class="cs-search-row">
          <div class="cs-search-box">
            <input type="text" class="cs-search-input" id="cs-search-input" placeholder="Kartenname oder Nummer..." value="${prefillValue}" />
            <span class="cs-search-icon">🔍</span>
          </div>
          <button class="cs-btn-icon" id="cs-btn-collapse" title="Minimieren">✕</button>
        </div>
        <div class="cs-controls-row">
          <div class="cs-badge-live">
            <span class="cs-live-dot"></span>
            <span>Live Tracker</span>
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
          <span>${scanCount || 0} Scans</span>
        </div>
        <span>Card Scanner+ AI</span>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const btnCap = this.shadow.getElementById('cs-btn-capture');
    if (btnCap) {
      btnCap.onclick = (e) => {
        e.stopPropagation();
        if (this.onCaptureClick) this.onCaptureClick();
      };
    }

    const btnCol = this.shadow.getElementById('cs-btn-collapse');
    if (btnCol) {
      btnCol.onclick = (e) => {
        e.stopPropagation();
        this.toggleCollapse();
      };
    }

    const candItems = this.shadow.querySelectorAll('.cs-cand-item[data-index]');
    candItems.forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this.setSelectedIndex(idx);
      };
    });

    const condItems = this.shadow.querySelectorAll('.cs-condition-item[data-cond]');
    condItems.forEach(el => {
      el.onclick = () => {
        const cond = el.getAttribute('data-cond');
        this.state.selectedCondition = cond;
        this.render();
      };
    });

    const btnNone = this.shadow.getElementById('cs-btn-none');
    if (btnNone) {
      btnNone.onclick = () => {
        this.state.candidates = [];
        this.state.activeCard = null;
        this.render();
      };
    }

    const searchInp = this.shadow.getElementById('cs-search-input');
    if (searchInp) {
      searchInp.onkeydown = (e) => {
        if (e.key === 'Enter' && searchInp.value.trim()) {
          if (this.onManualSearch) {
            this.onManualSearch(searchInp.value.trim());
          }
        }
      };

      const fallbackBtn = this.shadow.getElementById('cs-btn-fallback-cm');
      if (fallbackBtn) {
        fallbackBtn.onclick = (e) => {
          const query = searchInp.value.trim() || (this.state.lastScanMeta && this.state.lastScanMeta.detectedCode);
          if (query) {
            fallbackBtn.href = `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}`;
          } else {
            fallbackBtn.href = 'https://www.cardmarket.com/de/Pokemon/Products/Search';
          }
        };
      }
    }
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
