/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Grabs the exact inner tracked card boundary on 'S' keypress
 */

(function () {
  console.log('[Card Scanner+] Content Script with Camera-Style Card Tracking loaded.');

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
            console.log('[Card Scanner+] Attaching Camera-Style Autofocus Tracker to stream...');
            window.cardTracker.init(activeVideo);
          }
        }
        return activeVideo;
      }
    }
    return activeVideo || videos[0];
  }

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
   * Captures the exact Tracked Card Reticle Boundary & Sends to Gemini AI Vision Backend
   */
  async function performAICapture() {
    if (isCapturing) return;
    isCapturing = true;

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      setupStreamTracker();
      const auctionHint = getWhatnotLiveAuctionHint();
      const currentLiveBid = getCurrentWhatnotBid();
      console.log('[Card Scanner+] Capture of Tracked Card Initiated:', { auctionHint, currentLiveBid });

      const imageBase64 = await grabTrackedCardImage();

      if (!imageBase64 && !auctionHint) {
        throw new Error('Kein Videobild der getrackten Karte verfügbar.');
      }

      console.log('[Card Scanner+] Sending tight 500x700px Card Image to Gemini Vision...');

      await queryAIBackend(imageBase64, auctionHint, currentLiveBid);
    } catch (err) {
      console.error('[Card Scanner+] Capture error:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          errorMessage: err.message
        });
      }
    } finally {
      isCapturing = false;
    }
  }

  /**
   * Slices the exact inner tracked card boundary
   */
  async function grabTrackedCardImage() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_TAB_FRAME' }, (response) => {
        if (!response || !response.success || !response.dataUrl) {
          return resolve(null);
        }

        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          
          let cardRect = window.cardTracker ? window.cardTracker.getTrackedCardRect() : null;
          if (!cardRect) {
            cardRect = { left: window.innerWidth * 0.25, top: window.innerHeight * 0.2, width: window.innerWidth * 0.5, height: window.innerHeight * 0.6 };
          }

          const sx = Math.max(0, Math.round(cardRect.left * dpr));
          const sy = Math.max(0, Math.round(cardRect.top * dpr));
          const sw = Math.min(img.width - sx, Math.round(cardRect.width * dpr));
          const sh = Math.min(img.height - sy, Math.round(cardRect.height * dpr));

          if (sw <= 10 || sh <= 10) {
            return resolve(null);
          }

          const canvas = document.createElement('canvas');
          canvas.width = 500;
          canvas.height = 700;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 500, 700);

          resolve(canvas.toDataURL('image/jpeg', 0.85));
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
      const stored = await chrome.storage.local.get(['geminiApiKey', 'backendUrl']);
      if (stored.geminiApiKey) geminiApiKey = stored.geminiApiKey.trim();
      if (stored.backendUrl) backendUrl = stored.backendUrl.replace(/\/+$/, '');

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
        throw new Error(`Backend antwortete mit HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log('[Card Scanner+] AI Backend response:', data);

      const candidateList = Array.isArray(data.candidates) ? data.candidates : [];
      const firstCand = candidateList[0];
      const detectedTitle = firstCand ? `${firstCand.name} (${firstCand.number || firstCand.set_name || ''})` : null;
      const isMissingKey = data.status === 'NO_API_KEY';

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidateList, 0, {
          detectedCode: detectedTitle,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid,
          missingApiKey: isMissingKey,
          apiMessage: data.apiMessage
        });
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          detectedCode: null,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid,
          errorMessage: err.message
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
        const candidateList = Array.isArray(data.candidates) ? data.candidates : [];
        if (window.cardScannerOverlay) {
          window.cardScannerOverlay.showCandidates(candidateList, 0, {
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
