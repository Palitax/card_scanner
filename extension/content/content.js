/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Multi-Region Frame Grabber, Whatnot Context Scraper & API Client
 */

(function () {
  console.log('[Card Scanner+] Content Script initialized on Whatnot.');

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

      // Check for prominent bottom banner text
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
   * Performs Intelligent Multi-Region Capture & OCR
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
      console.log('[Card Scanner+] Whatnot Live Auction DOM Hint:', auctionHint);

      let primaryCanvas = null;
      let bottomCardCanvas = null;

      // Pipeline A: Direct DOM Canvas Multi-Crop
      if (video) {
        try {
          const crops = grabMultiRegionCrops(video);
          primaryCanvas = crops.cardAreaCanvas;
          bottomCardCanvas = crops.cardBottomCanvas;
        } catch (err) {
          console.warn('[Card Scanner+] Direct grab tainted (CORS/MSE). Trying Pipeline B...', err);
        }
      }

      // Pipeline B Fallback: Background Screen Capture
      if (!primaryCanvas) {
        console.log('[Card Scanner+] Executing Pipeline B: Service Worker Screen Capture...');
        const crops = await grabMultiRegionFallback(video);
        if (crops) {
          primaryCanvas = crops.cardAreaCanvas;
          bottomCardCanvas = crops.cardBottomCanvas;
        }
      }

      if (!primaryCanvas && !auctionHint) {
        throw new Error('Kein Videobild verfügbar.');
      }

      // Run OCR on the Bottom Region first (most accurate for set codes & numbers)
      let ocrResult = null;
      if (bottomCardCanvas) {
        ocrResult = await window.cardScannerOCR.recognize(bottomCardCanvas);
      }

      // If bottom region gave no clear code, run on the wider Card Area Canvas
      if ((!ocrResult || !ocrResult.parsed) && primaryCanvas) {
        console.log('[Card Scanner+] Scanning full card area...');
        const fullCardResult = await window.cardScannerOCR.recognize(primaryCanvas);
        if (fullCardResult && (fullCardResult.parsed || fullCardResult.rawText.length > (ocrResult ? ocrResult.rawText.length : 0))) {
          ocrResult = fullCardResult;
        }
      }

      const parsed = ocrResult ? ocrResult.parsed : null;
      const rawText = ocrResult ? ocrResult.rawText : '';
      const capturedThumbnail = primaryCanvas ? primaryCanvas.toDataURL('image/jpeg', 0.8) : null;

      console.log('[Card Scanner+] Final OCR Result:', { parsed, rawText, auctionHint });

      // Query Backend
      await queryBackendCandidates(parsed, rawText, auctionHint, capturedThumbnail);
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
   * Multi-Region Cropper from DOM Video
   */
  function grabMultiRegionCrops(video) {
    const vWidth = video.videoWidth || video.clientWidth || 720;
    const vHeight = video.videoHeight || video.clientHeight || 1280;

    // 1. Central Card Area: Y 20% -> 80%, X 15% -> 85% (where cards are held)
    const cardX = Math.floor(vWidth * 0.15);
    const cardY = Math.floor(vHeight * 0.20);
    const cardW = Math.floor(vWidth * 0.70);
    const cardH = Math.floor(vHeight * 0.60);

    const cardAreaCanvas = document.createElement('canvas');
    cardAreaCanvas.width = cardW;
    cardAreaCanvas.height = cardH;
    const ctx1 = cardAreaCanvas.getContext('2d', { willReadFrequently: true });
    ctx1.drawImage(video, cardX, cardY, cardW, cardH, 0, 0, cardW, cardH);

    // 2. Card Bottom Zone: Lower portion of the central area (Y 45% -> 78%)
    const botX = Math.floor(vWidth * 0.15);
    const botY = Math.floor(vHeight * 0.45);
    const botW = Math.floor(vWidth * 0.70);
    const botH = Math.floor(vHeight * 0.33);

    const cardBottomCanvas = document.createElement('canvas');
    cardBottomCanvas.width = botW;
    cardBottomCanvas.height = botH;
    const ctx2 = cardBottomCanvas.getContext('2d', { willReadFrequently: true });
    ctx2.drawImage(video, botX, botY, botW, botH, 0, 0, botW, botH);

    // Binarize Bottom Region for clean character edges
    const imgData2 = ctx2.getImageData(0, 0, botW, botH);
    binarizeImageData(imgData2);
    ctx2.putImageData(imgData2, 0, 0);

    return { cardAreaCanvas, cardBottomCanvas };
  }

  /**
   * Multi-Region Screen Capture Fallback
   */
  async function grabMultiRegionFallback(video) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_TAB_FRAME' }, (response) => {
        if (!response || !response.success || !response.dataUrl) {
          return resolve(null);
        }

        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          let rect = video ? video.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

          const cardX = Math.round((rect.left + rect.width * 0.15) * dpr);
          const cardY = Math.round((rect.top + rect.height * 0.20) * dpr);
          const cardW = Math.round(rect.width * 0.70 * dpr);
          const cardH = Math.round(rect.height * 0.60 * dpr);

          const cardAreaCanvas = document.createElement('canvas');
          cardAreaCanvas.width = cardW;
          cardAreaCanvas.height = cardH;
          const ctx1 = cardAreaCanvas.getContext('2d', { willReadFrequently: true });
          ctx1.drawImage(img, cardX, cardY, cardW, cardH, 0, 0, cardW, cardH);

          const botX = Math.round((rect.left + rect.width * 0.15) * dpr);
          const botY = Math.round((rect.top + rect.height * 0.45) * dpr);
          const botW = Math.round(rect.width * 0.70 * dpr);
          const botH = Math.round(rect.height * 0.33 * dpr);

          const cardBottomCanvas = document.createElement('canvas');
          cardBottomCanvas.width = botW;
          cardBottomCanvas.height = botH;
          const ctx2 = cardBottomCanvas.getContext('2d', { willReadFrequently: true });
          ctx2.drawImage(img, botX, botY, botW, botH, 0, 0, botW, botH);

          try {
            const imgData2 = ctx2.getImageData(0, 0, botW, botH);
            binarizeImageData(imgData2);
            ctx2.putImageData(imgData2, 0, 0);
          } catch (e) {}

          resolve({ cardAreaCanvas, cardBottomCanvas });
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Grayscale & Contrast Enhancement
   */
  function binarizeImageData(imgData) {
    const d = imgData.data;
    const len = d.length;
    for (let i = 0; i < len; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = gray;
      d[i + 1] = gray;
      d[i + 2] = gray;
    }
  }

  /**
   * Queries Backend API for Real Matches
   */
  async function queryBackendCandidates(parsed, rawText, auctionHint, capturedThumbnail) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const payload = {
        number: parsed ? parsed.number : '',
        total: parsed ? parsed.total : '',
        promoCode: parsed ? parsed.promoCode : '',
        setCode: parsed ? parsed.setCode : '',
        code: parsed ? parsed.code : '',
        rawText: rawText || '',
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
          rawText: rawText,
          detectedCode: parsed ? parsed.code : (rawText || auctionHint),
          capturedThumbnail: capturedThumbnail
        });
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([], 0, {
          rawText: rawText,
          detectedCode: parsed ? parsed.code : rawText,
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
        body: JSON.stringify({ query: query, rawText: query })
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
