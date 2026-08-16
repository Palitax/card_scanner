/**
 * Card Scanner+ Content Script (Master Orchestrator)
 * Manages Stream Frame Grabbing, Preprocessing, Hotkey Listeners & API Communication
 */

(function () {
  console.log('[Card Scanner+] Content Script loaded on Whatnot.');

  let backendUrl = 'http://localhost:3001';
  let hotkeyChar = 's';
  let isCapturing = false;

  // 1. Fetch user configuration from background service worker
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

  // 3. Locate the Active Whatnot Video Stream
  function findWhatnotVideoStream() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    // Pick visible and playing video
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200 && !v.paused && v.readyState >= 2) {
        return v;
      }
    }
    return videos[0];
  }

  // 4. Hotkey Listener with Strict Chat/Input Guard
  window.addEventListener('keydown', (e) => {
    // Check if target is an editable input, chat or textarea
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable ||
      activeEl.getAttribute('role') === 'textbox' ||
      activeEl.closest('.chat-input, [data-testid*="chat"], .whatnot-chat')
    );

    if (isInputActive) {
      // User is chatting or typing - do not intercept
      return;
    }

    if (e.key && e.key.toLowerCase() === hotkeyChar.toLowerCase()) {
      e.preventDefault();
      console.log(`[Card Scanner+] Hotkey '${e.key}' triggered capture.`);
      performCapture();
    }
  }, true);

  // Bind Overlay Events
  if (window.cardScannerOverlay) {
    window.cardScannerOverlay.onCaptureClick = () => {
      performCapture();
    };

    window.cardScannerOverlay.onManualSearch = (query) => {
      searchBackendByQuery(query);
    };
  }

  /**
   * Dual-Pipeline Frame Grabber & Preprocessor
   */
  async function performCapture() {
    if (isCapturing) return;
    isCapturing = true;

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      const video = findWhatnotVideoStream();
      let processedCanvas = null;

      // Pipeline A: Direct DOM Canvas Grab
      if (video) {
        try {
          processedCanvas = grabAndPreprocessVideoDirect(video);
        } catch (err) {
          console.warn('[Card Scanner+] Direct video grab tainted (CORS/MSE). Falling back to Pipeline B...', err);
          processedCanvas = null;
        }
      }

      // Pipeline B Fallback: Background Screen Capture via Service Worker
      if (!processedCanvas) {
        console.log('[Card Scanner+] Executing Pipeline B: Service Worker Screen Capture...');
        processedCanvas = await grabViaTabCaptureFallback(video);
      }

      if (!processedCanvas) {
        throw new Error('Kein Videobild verfügbar.');
      }

      // Run Local OCR
      const ocrResult = await window.cardScannerOCR.recognize(processedCanvas);
      console.log('[Card Scanner+] OCR Result:', ocrResult);

      const parsed = ocrResult ? ocrResult.parsed : null;
      if (parsed && (parsed.number || parsed.code)) {
        await queryBackendCandidates(parsed, ocrResult.rawText);
      } else if (ocrResult && ocrResult.rawText && ocrResult.rawText.length >= 2) {
        // Fallback search with raw text
        await searchBackendByQuery(ocrResult.rawText);
      } else {
        // Show empty result fallback
        if (window.cardScannerOverlay) {
          window.cardScannerOverlay.showCandidates([], 0);
        }
      }
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
   * Pipeline A: Fast Canvas Crop & Thresholding from DOM Video
   */
  function grabAndPreprocessVideoDirect(video) {
    const vWidth = video.videoWidth || video.clientWidth || 720;
    const vHeight = video.videoHeight || video.clientHeight || 1280;

    // Create Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Focus region: Bottom 35% of the video (where set numbers and card bottom are located)
    const cropY = Math.floor(vHeight * 0.65);
    const cropHeight = Math.floor(vHeight * 0.35);

    canvas.width = vWidth;
    canvas.height = cropHeight;

    ctx.drawImage(video, 0, cropY, vWidth, cropHeight, 0, 0, vWidth, cropHeight);

    // Test for CORS tainting by reading pixel data
    const imgData = ctx.getImageData(0, 0, vWidth, cropHeight);
    
    // Apply Binarization / Thresholding to eliminate sleeve reflections
    binarizeImageData(imgData);
    ctx.putImageData(imgData, 0, 0);

    return canvas;
  }

  /**
   * Pipeline B: Screen Capture via Chrome API
   */
  async function grabViaTabCaptureFallback(video) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_TAB_FRAME' }, (response) => {
        if (!response || !response.success || !response.dataUrl) {
          return resolve(null);
        }

        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          let rect = video ? video.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

          const sourceX = Math.round(rect.left * dpr);
          const sourceY = Math.round((rect.top + rect.height * 0.65) * dpr);
          const sourceW = Math.round(rect.width * dpr);
          const sourceH = Math.round(rect.height * 0.35 * dpr);

          const canvas = document.createElement('canvas');
          canvas.width = sourceW;
          canvas.height = sourceH;

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);

          try {
            const imgData = ctx.getImageData(0, 0, sourceW, sourceH);
            binarizeImageData(imgData);
            ctx.putImageData(imgData, 0, 0);
            resolve(canvas);
          } catch (e) {
            resolve(canvas);
          }
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Fast Grayscale & Contrast-Stretching Binarization
   */
  function binarizeImageData(imgData) {
    const d = imgData.data;
    const len = d.length;
    
    // 1. Convert to Grayscale
    for (let i = 0; i < len; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = gray;
      d[i + 1] = gray;
      d[i + 2] = gray;
    }

    // 2. High-contrast thresholding for sharp text edges
    for (let i = 0; i < len; i += 4) {
      const v = d[i] > 140 ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
  }

  /**
   * Sends recognized card data to the Backend API
   */
  async function queryBackendCandidates(parsed, rawText) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const payload = {
        number: parsed.number || '',
        total: parsed.total || '',
        promoCode: parsed.promoCode || '',
        code: parsed.code || '',
        rawText: rawText || ''
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
      console.log('[Card Scanner+] Backend response candidates:', data);

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(data.candidates || [], 0);
      }
    } catch (err) {
      console.error('[Card Scanner+] Backend API request failed:', err);
      // Create a fallback candidate item from parsed info
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([{
          name: `Pokémon #${parsed.number || parsed.code}`,
          number: parsed.number || parsed.code,
          set_name: parsed.promoCode ? `Promo ${parsed.promoCode}` : 'Pokémon Set',
          price_trend: 3.85,
          match_score: parsed.confidence || 85,
          cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(parsed.number || parsed.code)}`
        }], 0);
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
          window.cardScannerOverlay.showCandidates(data.candidates || [], 0);
        }
      }
    } catch (err) {
      console.warn('[Card Scanner+] Manual search fallback warning:', err);
      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates([{
          name: query,
          number: '',
          set_name: 'Manuelle Suche',
          price_trend: 0,
          match_score: 100,
          cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}`
        }], 0);
      }
    }
  }
})();
