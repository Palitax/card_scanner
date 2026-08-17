/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Multi-Scale Resolution Enhancer & Precision Card Grabber
 */

(function () {
  console.log('[Card Scanner+] Content Script active.');

  let backendUrl = 'http://localhost:3001';
  let hotkeyChar = 's';
  let isCapturing = false;

  // 1. Load config
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (resp) => {
    if (resp && resp.success && resp.config) {
      if (resp.config.backendUrl) backendUrl = resp.config.backendUrl.replace(/\/+$/, '');
      if (resp.config.hotkey) hotkeyChar = resp.config.hotkey.toLowerCase();
    }
  });

  // 2. Pre-warm OCR Engine
  if (window.cardScannerOCR) {
    window.cardScannerOCR.init().catch(err => {
      console.warn('[Card Scanner+] OCR Pre-warm warning:', err);
    });
  }

  // 3. Locate Video Stream
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
      console.log(`[Card Scanner+] Hotkey '${e.key}' pressed.`);
      performCapture();
    }
  }, true);

  if (window.cardScannerOverlay) {
    window.cardScannerOverlay.onCaptureClick = () => {
      performCapture();
    };

    window.cardScannerOverlay.onManualSearch = (query) => {
      searchBackendByQuery(query);
    };
  }

  /**
   * Multi-Scale Frame Capture & OCR
   */
  async function performCapture() {
    if (isCapturing) return;
    isCapturing = true;

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      const video = findWhatnotVideoStream();
      const auctionHint = getWhatnotLiveAuctionHint();
      console.log('[Card Scanner+] Whatnot Auction Context:', auctionHint);

      let crops = null;

      if (video) {
        try {
          crops = grabMultiScaleCrops(video);
        } catch (err) {
          console.warn('[Card Scanner+] Direct canvas tainted. Trying fallback...', err);
        }
      }

      if (!crops) {
        crops = await grabMultiScaleFallback(video);
      }

      if (!crops && !auctionHint) {
        throw new Error('Kein Videobild verfügbar.');
      }

      let detectedResult = null;

      // 1. Scan the Upscaled Lower Card Region (where modern & vintage set numbers live)
      if (crops && crops.lowerCard) {
        const resLower = await window.cardScannerOCR.recognize(crops.lowerCard);
        if (resLower && resLower.parsed) {
          detectedResult = resLower.parsed;
        }
      }

      // 2. Scan the High-Contrast Bottom Strip
      if (!detectedResult && crops && crops.bottomStrip) {
        const resStrip = await window.cardScannerOCR.recognize(crops.bottomStrip);
        if (resStrip && resStrip.parsed) {
          detectedResult = resStrip.parsed;
        }
      }

      // 3. Scan the Top Header (for Vintage HP/Level)
      if (!detectedResult && crops && crops.topHeader) {
        const resTop = await window.cardScannerOCR.recognize(crops.topHeader);
        if (resTop && resTop.parsed) {
          detectedResult = resTop.parsed;
        }
      }

      const capturedThumb = crops && crops.preview ? crops.preview.toDataURL('image/jpeg', 0.8) : null;

      console.log('[Card Scanner+] Scan Completed:', { detectedResult, auctionHint });

      await queryBackendCandidates(detectedResult, auctionHint, capturedThumb);
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
   * Upscaled (2.5x) Multi-Region Canvas Creator
   */
  function grabMultiScaleCrops(video) {
    const vW = video.videoWidth || video.clientWidth || 720;
    const vH = video.videoHeight || video.clientHeight || 1280;
    const scale = 2.5;

    // Preview Frame
    const preview = document.createElement('canvas');
    preview.width = Math.floor(vW * 0.70);
    preview.height = Math.floor(vH * 0.65);
    const ctxPrev = preview.getContext('2d');
    ctxPrev.drawImage(video, Math.floor(vW * 0.15), Math.floor(vH * 0.18), preview.width, preview.height, 0, 0, preview.width, preview.height);

    // 1. Lower Card Area (Y: 45% -> 85%, X: 10% -> 90%) - Upscaled 2.5x
    const srcW1 = Math.floor(vW * 0.80);
    const srcH1 = Math.floor(vH * 0.40);
    const lowerCard = document.createElement('canvas');
    lowerCard.width = Math.floor(srcW1 * scale);
    lowerCard.height = Math.floor(srcH1 * scale);
    const ctx1 = lowerCard.getContext('2d', { willReadFrequently: true });
    ctx1.imageSmoothingEnabled = true;
    ctx1.imageSmoothingQuality = 'high';
    ctx1.drawImage(video, Math.floor(vW * 0.10), Math.floor(vH * 0.45), srcW1, srcH1, 0, 0, lowerCard.width, lowerCard.height);
    enhanceContrast(ctx1, lowerCard.width, lowerCard.height);

    // 2. High-Contrast Bottom Strip (Y: 65% -> 85%) - Upscaled 2.5x
    const srcW2 = Math.floor(vW * 0.80);
    const srcH2 = Math.floor(vH * 0.20);
    const bottomStrip = document.createElement('canvas');
    bottomStrip.width = Math.floor(srcW2 * scale);
    bottomStrip.height = Math.floor(srcH2 * scale);
    const ctx2 = bottomStrip.getContext('2d', { willReadFrequently: true });
    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(video, Math.floor(vW * 0.10), Math.floor(vH * 0.65), srcW2, srcH2, 0, 0, bottomStrip.width, bottomStrip.height);
    enhanceContrast(ctx2, bottomStrip.width, bottomStrip.height);

    // 3. Top Header (Y: 16% -> 32%) - Upscaled 2.5x
    const srcW3 = Math.floor(vW * 0.80);
    const srcH3 = Math.floor(vH * 0.16);
    const topHeader = document.createElement('canvas');
    topHeader.width = Math.floor(srcW3 * scale);
    topHeader.height = Math.floor(srcH3 * scale);
    const ctx3 = topHeader.getContext('2d', { willReadFrequently: true });
    ctx3.imageSmoothingEnabled = true;
    ctx3.imageSmoothingQuality = 'high';
    ctx3.drawImage(video, Math.floor(vW * 0.10), Math.floor(vH * 0.16), srcW3, srcH3, 0, 0, topHeader.width, topHeader.height);
    enhanceContrast(ctx3, topHeader.width, topHeader.height);

    return { preview, lowerCard, bottomStrip, topHeader };
  }

  /**
   * Screen Capture Fallback with 2.5x Upscaling
   */
  async function grabMultiScaleFallback(video) {
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
          const scale = 2.5;

          const preview = document.createElement('canvas');
          preview.width = Math.floor(vW * 0.70);
          preview.height = Math.floor(vH * 0.65);
          const ctxPrev = preview.getContext('2d');
          ctxPrev.drawImage(img, Math.floor(vLeft + vW * 0.15), Math.floor(vTop + vH * 0.18), preview.width, preview.height, 0, 0, preview.width, preview.height);

          const srcW1 = Math.floor(vW * 0.80);
          const srcH1 = Math.floor(vH * 0.40);
          const lowerCard = document.createElement('canvas');
          lowerCard.width = Math.floor(srcW1 * scale);
          lowerCard.height = Math.floor(srcH1 * scale);
          const ctx1 = lowerCard.getContext('2d', { willReadFrequently: true });
          ctx1.drawImage(img, Math.floor(vLeft + vW * 0.10), Math.floor(vTop + vH * 0.45), srcW1, srcH1, 0, 0, lowerCard.width, lowerCard.height);
          enhanceContrast(ctx1, lowerCard.width, lowerCard.height);

          const srcW2 = Math.floor(vW * 0.80);
          const srcH2 = Math.floor(vH * 0.20);
          const bottomStrip = document.createElement('canvas');
          bottomStrip.width = Math.floor(srcW2 * scale);
          bottomStrip.height = Math.floor(srcH2 * scale);
          const ctx2 = bottomStrip.getContext('2d', { willReadFrequently: true });
          ctx2.drawImage(img, Math.floor(vLeft + vW * 0.10), Math.floor(vTop + vH * 0.65), srcW2, srcH2, 0, 0, bottomStrip.width, bottomStrip.height);
          enhanceContrast(ctx2, bottomStrip.width, bottomStrip.height);

          const srcW3 = Math.floor(vW * 0.80);
          const srcH3 = Math.floor(vH * 0.16);
          const topHeader = document.createElement('canvas');
          topHeader.width = Math.floor(srcW3 * scale);
          topHeader.height = Math.floor(srcH3 * scale);
          const ctx3 = topHeader.getContext('2d', { willReadFrequently: true });
          ctx3.drawImage(img, Math.floor(vLeft + vW * 0.10), Math.floor(vTop + vH * 0.16), srcW3, srcH3, 0, 0, topHeader.width, topHeader.height);
          enhanceContrast(ctx3, topHeader.width, topHeader.height);

          resolve({ preview, lowerCard, bottomStrip, topHeader });
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Preprocessing: Grayscale & Contrast Boosting
   */
  function enhanceContrast(ctx, w, h) {
    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // Contrast stretching
        const enhanced = gray > 130 ? Math.min(255, gray * 1.2) : Math.max(0, gray * 0.7);
        d[i] = enhanced;
        d[i + 1] = enhanced;
        d[i + 2] = enhanced;
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (e) {}
  }

  /**
   * Queries Backend API with Clean Card Codes
   */
  async function queryBackendCandidates(detected, auctionHint, capturedThumbnail) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const payload = {
        number: detected ? detected.number : '',
        total: detected ? detected.total : '',
        promoCode: detected ? detected.promoCode : '',
        setCode: detected ? detected.setCode : '',
        code: detected ? detected.code : '',
        artist: detected ? detected.artist : '',
        hp: detected ? detected.hp : '',
        auctionHint: auctionHint || ''
      };

      console.log(`[Card Scanner+] Fetching from ${endpoint}:`, payload);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Backend returned HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log('[Card Scanner+] Backend candidates response:', data);

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(data.candidates || [], 0, {
          detectedCode: detected ? detected.code : null,
          capturedThumbnail: capturedThumbnail
        });
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          detectedCode: detected ? detected.code : null,
          capturedThumbnail: capturedThumbnail
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
        body: JSON.stringify({ query: query })
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
