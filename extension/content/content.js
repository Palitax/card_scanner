/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Precision Corner ROI Grabber & Whatnot Live Context Scraper
 */

(function () {
  console.log('[Card Scanner+] Content Script loaded.');

  let backendUrl = 'http://localhost:3001';
  let hotkeyChar = 's';
  let isCapturing = false;

  // 1. Fetch user configuration
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

  // 3. Locate Active Whatnot Video Stream
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

  // 4. Scrape Whatnot Active Auction / Pinned Item Text from DOM
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
   * Focused Multi-Corner Capture & Number Recognition
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

      let cornerCrops = null;

      // Pipeline A: Direct DOM Canvas Crop
      if (video) {
        try {
          cornerCrops = grabTargetedCornerCrops(video);
        } catch (err) {
          console.warn('[Card Scanner+] Direct grab failed. Trying Pipeline B...', err);
        }
      }

      // Pipeline B Fallback: Background Screen Capture
      if (!cornerCrops) {
        cornerCrops = await grabTargetedCornerCropsFallback(video);
      }

      if (!cornerCrops && !auctionHint) {
        throw new Error('Kein Videobild verfügbar.');
      }

      let detectedResult = null;

      // 1. Scan Bottom-Left Corner (Modern Set Codes & Numbers: 025/165, sv4k 073, 216/091)
      if (cornerCrops && cornerCrops.bottomLeft) {
        const resBL = await window.cardScannerOCR.recognize(cornerCrops.bottomLeft);
        if (resBL && resBL.parsed) {
          detectedResult = resBL.parsed;
        }
      }

      // 2. Scan Bottom-Right Corner (Vintage Numbers & Illustrators: 4/102, 11/18, OP07-073)
      if (!detectedResult && cornerCrops && cornerCrops.bottomRight) {
        const resBR = await window.cardScannerOCR.recognize(cornerCrops.bottomRight);
        if (resBR && resBR.parsed) {
          detectedResult = resBR.parsed;
        }
      }

      // 3. Scan Top-Right Header (Vintage HP / LV: HP40, LV.10)
      if (!detectedResult && cornerCrops && cornerCrops.topHeader) {
        const resTop = await window.cardScannerOCR.recognize(cornerCrops.topHeader);
        if (resTop && resTop.parsed) {
          detectedResult = resTop.parsed;
        }
      }

      const capturedThumb = cornerCrops && cornerCrops.fullCard ? cornerCrops.fullCard.toDataURL('image/jpeg', 0.8) : null;

      console.log('[Card Scanner+] Final Detection Result:', { detectedResult, auctionHint });

      // Query Backend
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
   * Cuts precise high-contrast corner zones from the video
   */
  function grabTargetedCornerCrops(video) {
    const vW = video.videoWidth || video.clientWidth || 720;
    const vH = video.videoHeight || video.clientHeight || 1280;

    // Full Card Area Thumbnail
    const fullCard = document.createElement('canvas');
    fullCard.width = Math.floor(vW * 0.70);
    fullCard.height = Math.floor(vH * 0.65);
    const ctxFull = fullCard.getContext('2d', { willReadFrequently: true });
    ctxFull.drawImage(video, Math.floor(vW * 0.15), Math.floor(vH * 0.18), fullCard.width, fullCard.height, 0, 0, fullCard.width, fullCard.height);

    // Zone 1: Bottom-Left Corner (Modern Numbers)
    const bLeft = document.createElement('canvas');
    bLeft.width = Math.floor(vW * 0.38);
    bLeft.height = Math.floor(vH * 0.14);
    const ctxBL = bLeft.getContext('2d', { willReadFrequently: true });
    ctxBL.drawImage(video, Math.floor(vW * 0.15), Math.floor(vH * 0.66), bLeft.width, bLeft.height, 0, 0, bLeft.width, bLeft.height);
    preprocessCropCanvas(ctxBL, bLeft.width, bLeft.height);

    // Zone 2: Bottom-Right Corner (Vintage & One Piece Numbers)
    const bRight = document.createElement('canvas');
    bRight.width = Math.floor(vW * 0.38);
    bRight.height = Math.floor(vH * 0.14);
    const ctxBR = bRight.getContext('2d', { willReadFrequently: true });
    ctxBR.drawImage(video, Math.floor(vW * 0.47), Math.floor(vH * 0.66), bRight.width, bRight.height, 0, 0, bRight.width, bRight.height);
    preprocessCropCanvas(ctxBR, bRight.width, bRight.height);

    // Zone 3: Top-Right Header (HP & Level)
    const topHeader = document.createElement('canvas');
    topHeader.width = Math.floor(vW * 0.38);
    topHeader.height = Math.floor(vH * 0.12);
    const ctxTop = topHeader.getContext('2d', { willReadFrequently: true });
    ctxTop.drawImage(video, Math.floor(vW * 0.47), Math.floor(vH * 0.18), topHeader.width, topHeader.height, 0, 0, topHeader.width, topHeader.height);
    preprocessCropCanvas(ctxTop, topHeader.width, topHeader.height);

    return { fullCard, bottomLeft: bLeft, bottomRight: bRight, topHeader };
  }

  /**
   * Screen Capture Fallback
   */
  async function grabTargetedCornerCropsFallback(video) {
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

          const fullCard = document.createElement('canvas');
          fullCard.width = Math.floor(vW * 0.70);
          fullCard.height = Math.floor(vH * 0.65);
          const ctxFull = fullCard.getContext('2d', { willReadFrequently: true });
          ctxFull.drawImage(img, Math.floor(vLeft + vW * 0.15), Math.floor(vTop + vH * 0.18), fullCard.width, fullCard.height, 0, 0, fullCard.width, fullCard.height);

          const bLeft = document.createElement('canvas');
          bLeft.width = Math.floor(vW * 0.38);
          bLeft.height = Math.floor(vH * 0.14);
          const ctxBL = bLeft.getContext('2d', { willReadFrequently: true });
          ctxBL.drawImage(img, Math.floor(vLeft + vW * 0.15), Math.floor(vTop + vH * 0.66), bLeft.width, bLeft.height, 0, 0, bLeft.width, bLeft.height);
          preprocessCropCanvas(ctxBL, bLeft.width, bLeft.height);

          const bRight = document.createElement('canvas');
          bRight.width = Math.floor(vW * 0.38);
          bRight.height = Math.floor(vH * 0.14);
          const ctxBR = bRight.getContext('2d', { willReadFrequently: true });
          ctxBR.drawImage(img, Math.floor(vLeft + vW * 0.47), Math.floor(vTop + vH * 0.66), bRight.width, bRight.height, 0, 0, bRight.width, bRight.height);
          preprocessCropCanvas(ctxBR, bRight.width, bRight.height);

          const topHeader = document.createElement('canvas');
          topHeader.width = Math.floor(vW * 0.38);
          topHeader.height = Math.floor(vH * 0.12);
          const ctxTop = topHeader.getContext('2d', { willReadFrequently: true });
          ctxTop.drawImage(img, Math.floor(vLeft + vW * 0.47), Math.floor(vTop + vH * 0.18), topHeader.width, topHeader.height, 0, 0, topHeader.width, topHeader.height);
          preprocessCropCanvas(ctxTop, topHeader.width, topHeader.height);

          resolve({ fullCard, bottomLeft: bLeft, bottomRight: bRight, topHeader });
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Preprocessing: Grayscale & Adaptive Contrast Stretching
   */
  function preprocessCropCanvas(ctx, w, h) {
    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = gray;
        d[i + 1] = gray;
        d[i + 2] = gray;
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
