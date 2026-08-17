/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Auto Card Tracking, Whatnot Live Bid Extraction & Gemini Vision Client
 */

(function () {
  console.log('[Card Scanner+] Content Script with Auto-Tracker loaded.');

  let backendUrl = 'https://cardscanner-nine.vercel.app';
  let hotkeyChar = 's';
  let geminiApiKey = '';
  let isCapturing = false;
  let activeVideo = null;

  // 1. Fetch user configuration
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (resp) => {
    if (resp && resp.success && resp.config) {
      if (resp.config.backendUrl) backendUrl = resp.config.backendUrl.replace(/\/+$/, '');
      if (resp.config.hotkey) hotkeyChar = resp.config.hotkey.toLowerCase();
      if (resp.config.geminiApiKey) geminiApiKey = resp.config.geminiApiKey.trim();
    }
  });

  // 2. Locate Active Whatnot Video Stream & Attach Tracker
  function setupStreamTracker() {
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 150 && rect.height > 150 && !v.paused && v.readyState >= 2) {
        if (activeVideo !== v) {
          activeVideo = v;
          if (window.cardTracker) {
            console.log('[Card Scanner+] Initializing Real-Time Card Tracker on video...');
            window.cardTracker.init(activeVideo);
          }
        }
        return activeVideo;
      }
    }
    return activeVideo || videos[0];
  }

  // Periodic stream check in case Whatnot switches stream containers
  setInterval(setupStreamTracker, 1500);

  // 3. Scrape Current Whatnot Live Bid Amount (€)
  function getCurrentWhatnotBid() {
    try {
      const bidSelectors = [
        '[data-testid*="current-bid"]',
        '[data-testid*="auction-price"]',
        '.live-auction-bid',
        '[class*="CurrentBid"]',
        '[class*="PriceDisplay"]',
        'div[class*="bid-amount"]'
      ];

      for (const sel of bidSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText) {
          const match = el.innerText.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|EUR|\$)?/);
          if (match) {
            const val = parseFloat(match[1].replace(',', '.'));
            if (!isNaN(val) && val > 0) return val;
          }
        }
      }

      // Check text in auction action buttons
      const buttons = document.querySelectorAll('button, div');
      for (const btn of buttons) {
        if (btn.innerText && (btn.innerText.includes('Gebot:') || btn.innerText.includes('Bid:') || btn.innerText.includes('Aktuell:'))) {
          const m = btn.innerText.match(/(?:Gebot|Bid|Aktuell)[:\s]+(\d+(?:[.,]\d{1,2})?)/i);
          if (m) {
            const val = parseFloat(m[1].replace(',', '.'));
            if (!isNaN(val) && val > 0) return val;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // 4. Scrape Whatnot Active Auction / Pinned Item Text
  function getWhatnotLiveAuctionHint() {
    try {
      const selectors = [
        '[data-testid*="pinned-item"]',
        '[data-testid*="auction-item"]',
        '.live-auction-item',
        '[class*="ItemOnScreen"]',
        '[class*="AuctionCard"]',
        'div[class*="pinned"]'
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 3) {
          return el.innerText.trim();
        }
      }

      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        if (div.innerText && (div.innerText.includes('(sv') || div.innerText.includes('151') || div.innerText.includes('GX') || div.innerText.includes('ex'))) {
          if (div.children.length < 5 && div.innerText.length < 100) {
            return div.innerText.trim();
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // 5. Hotkey Listener with Chat-Guard
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox' ||
      activeEl.closest('.chat-input, [data-testid*="chat"], .whatnot-chat')
    );

    if (isInputActive) return;

    if (e.key && e.key.toLowerCase() === hotkeyChar.toLowerCase()) {
      e.preventDefault();
      console.log(`[Card Scanner+] Hotkey '${e.key}' triggered capture.`);
      performAICapture();
    }
  }, true);

  if (window.cardScannerOverlay) {
    window.cardScannerOverlay.onCaptureClick = () => {
      performAICapture();
    };

    window.cardScannerOverlay.onManualSearch = (query) => {
      searchBackendByQuery(query);
    };
  }

  /**
   * Captures the tracked card frame and runs AI identification
   */
  async function performAICapture() {
    if (isCapturing) return;
    isCapturing = true;

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      const video = setupStreamTracker();
      const auctionHint = getWhatnotLiveAuctionHint();
      const currentLiveBid = getCurrentWhatnotBid();
      console.log('[Card Scanner+] Scan Triggered:', { auctionHint, currentLiveBid });

      let imageBase64 = null;

      // Primary: Get perspective-tracked card crop
      if (window.cardTracker) {
        try {
          imageBase64 = window.cardTracker.getCroppedCardBase64();
        } catch (err) {
          console.warn('[Card Scanner+] Tracker crop failed, falling back...', err);
        }
      }

      // Fallback screen capture
      if (!imageBase64) {
        imageBase64 = await grabHighResFallback(video);
      }

      if (!imageBase64 && !auctionHint) {
        throw new Error('Kein Videobild verfügbar.');
      }

      console.log('[Card Scanner+] Sending optimized card crop (35 KB) to Gemini AI Vision Backend...');

      await queryAIBackend(imageBase64, auctionHint, currentLiveBid);
    } catch (err) {
      console.error('[Card Scanner+] Capture error:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0);
      }
    } finally {
      isCapturing = false;
    }
  }

  /**
   * Screen Capture Fallback
   */
  async function grabHighResFallback(video) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_TAB_FRAME' }, (response) => {
        if (!response || !response.success || !response.dataUrl) {
          return resolve(null);
        }

        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          let rect = video ? video.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

          const vW = rect.width * dpr;
          const vH = rect.height * dpr;
          const vLeft = rect.left * dpr;
          const vTop = rect.top * dpr;

          const cardX = Math.round(vLeft + vW * 0.15);
          const cardY = Math.round(vTop + vH * 0.18);
          const cardW = Math.round(vW * 0.70);
          const cardH = Math.round(vH * 0.62);

          const canvas = document.createElement('canvas');
          canvas.width = 500;
          canvas.height = 700;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, cardX, cardY, cardW, cardH, 0, 0, 500, 700);

          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Queries Vercel Gemini Vision Backend
   */
  async function queryAIBackend(imageBase64, auctionHint, currentLiveBid) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const payload = {
        imageBase64: imageBase64,
        customApiKey: geminiApiKey,
        auctionHint: auctionHint || '',
        currentBid: currentLiveBid
      };

      console.log(`[Card Scanner+] Fetching from ${endpoint}...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Backend returned HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log('[Card Scanner+] AI Backend response:', data);

      const firstCand = data.candidates?.[0];
      const detectedTitle = firstCand ? `${firstCand.name} (${firstCand.number || firstCand.set_name || ''})` : null;

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(data.candidates || [], 0, {
          detectedCode: detectedTitle,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid
        });
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          detectedCode: null,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid
        });
      }
    }
  }

  /**
   * Manual Search Fallback
   */
  async function searchBackendByQuery(query) {
    if (!query) return;
    if (window.cardScannerOverlay) window.cardScannerOverlay.setScanning(true);

    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, customApiKey: geminiApiKey })
      });

      if (res.ok) {
        const data = await res.json();
        if (window.cardScannerOverlay) {
          window.cardScannerOverlay.showCandidates(data.candidates || [], 0, {
            detectedCode: query
          });
        }
      }
    } catch (err) {
      console.warn('[Card Scanner+] Manual search warning:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          detectedCode: query
        });
      }
    }
  }
})();
