/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Multimodal AI Frame Capture & Whatnot Stream Live Search
 */

(function () {
  console.log('[Card Scanner+] Content Script with AI Vision loaded.');

  let backendUrl = 'http://localhost:3001';
  let hotkeyChar = 's';
  let geminiApiKey = '';
  let isCapturing = false;

  // 1. Fetch user configuration
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (resp) => {
    if (resp && resp.success && resp.config) {
      if (resp.config.backendUrl) backendUrl = resp.config.backendUrl.replace(/\/+$/, '');
      if (resp.config.hotkey) hotkeyChar = resp.config.hotkey.toLowerCase();
      if (resp.config.geminiApiKey) geminiApiKey = resp.config.geminiApiKey.trim();
    }
  });

  // 2. Locate Active Whatnot Video Stream
  function findWhatnotVideoStream() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 150 && rect.height > 150 && !v.paused && v.readyState >= 2) {
        return v;
      }
    }
    return videos[0];
  }

  // 3. Scrape Whatnot Active Auction / Pinned Item Text
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

  // 4. Hotkey Listener with Chat-Guard
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
      console.log(`[Card Scanner+] Hotkey '${e.key}' triggered AI card capture.`);
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
   * Captures High-Resolution Card Frame & Identifies with Gemini AI
   */
  async function performAICapture() {
    if (isCapturing) return;
    isCapturing = true;

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      const video = findWhatnotVideoStream();
      const auctionHint = getWhatnotLiveAuctionHint();
      console.log('[Card Scanner+] Whatnot Context:', auctionHint);

      let imageBase64 = null;

      // Direct Canvas Frame Grab
      if (video) {
        try {
          imageBase64 = grabHighResCardSnapshot(video);
        } catch (err) {
          console.warn('[Card Scanner+] Direct canvas capture failed. Trying fallback...', err);
        }
      }

      // Background Tab Screen Capture Fallback
      if (!imageBase64) {
        imageBase64 = await grabHighResFallback(video);
      }

      if (!imageBase64 && !auctionHint) {
        throw new Error('Kein Videobild verfügbar.');
      }

      console.log('[Card Scanner+] Sending High-Res Card Image to AI Vision Backend...');

      // Query AI Backend
      await queryAIBackend(imageBase64, auctionHint);
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
   * Cuts High-Resolution Card Frame (Center 75% of Stream)
   */
  function grabHighResCardSnapshot(video) {
    const vW = video.videoWidth || video.clientWidth || 720;
    const vH = video.videoHeight || video.clientHeight || 1280;

    const cardX = Math.floor(vW * 0.10);
    const cardY = Math.floor(vH * 0.15);
    const cardW = Math.floor(vW * 0.80);
    const cardH = Math.floor(vH * 0.70);

    const canvas = document.createElement('canvas');
    canvas.width = cardW;
    canvas.height = cardH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, cardX, cardY, cardW, cardH, 0, 0, cardW, cardH);

    return canvas.toDataURL('image/jpeg', 0.88);
  }

  /**
   * Fallback Screen Capture for CORS/MSE Tainted Streams
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

          const cardX = Math.round(vLeft + vW * 0.10);
          const cardY = Math.round(vTop + vH * 0.15);
          const cardW = Math.round(vW * 0.80);
          const cardH = Math.round(vH * 0.70);

          const canvas = document.createElement('canvas');
          canvas.width = cardW;
          canvas.height = cardH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, cardX, cardY, cardW, cardH, 0, 0, cardW, cardH);

          resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Sends Image to Vercel Gemini Vision Backend
   */
  async function queryAIBackend(imageBase64, auctionHint) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const payload = {
        imageBase64: imageBase64,
        customApiKey: geminiApiKey,
        auctionHint: auctionHint || ''
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
          capturedThumbnail: imageBase64
        });
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          detectedCode: null,
          capturedThumbnail: imageBase64
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
