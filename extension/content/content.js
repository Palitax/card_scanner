/**
 * Card Scanner+ Content Script
 * High-Speed Live Stream Reticle Tracking, Turbo Direct-Vision AI & TCGplayer Pricing
 */

(function () {
  console.log('[Card Scanner+] Content script active on Whatnot stream.');

  let backendUrl = 'https://cardscanner-nine.vercel.app';
  let isCapturing = false;
  let hotkeyChar = 's';
  let geminiApiKey = '';

  // Load User Preferences
  chrome.storage.local.get(['backendUrl', 'hotkey', 'geminiApiKey'], (data) => {
    if (data.backendUrl) backendUrl = data.backendUrl.replace(/\/+$/, '');
    if (data.hotkey) hotkeyChar = data.hotkey.toLowerCase();
    if (data.geminiApiKey) geminiApiKey = data.geminiApiKey.trim();
  });

  // Watch for dynamic video element on Whatnot Stream
  const streamObserver = new MutationObserver(() => {
    setupStreamTracker();
  });

  streamObserver.observe(document.body, { childList: true, subtree: true });
  setTimeout(setupStreamTracker, 1000);

  function setupStreamTracker() {
    const video = document.querySelector('video');
    if (video && window.cardTracker && !document.getElementById('cardscanner-tracker-layer')) {
      window.cardTracker.init(video);
      console.log('[Card Scanner+] Attached precision card viewfinder to stream video.');
    }
  }

  // Keyboard Shortcuts: 'S' for Instant Capture
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) {
      return;
    }

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

    window.cardScannerOverlay.onSaveApiKey = (key) => {
      geminiApiKey = key.trim();
      console.log('[Card Scanner+] Gemini API Key updated directly from Overlay.');
    };

    window.cardScannerOverlay.onManualSearch = (query) => {
      searchBackendByQuery(query);
    };
  }

  /**
   * Captures the exact Tracked Card Reticle Boundary & Runs Turbo AI Vision Scan
   */
  async function performAICapture() {
    if (isCapturing) return;
    isCapturing = true;
    const scanStartTime = performance.now();

    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.setScanning(true);
    }

    try {
      setupStreamTracker();
      const auctionHint = getWhatnotLiveAuctionHint();
      const currentLiveBid = getCurrentWhatnotBid();

      // Ultra-optimized lightweight card crop (380x532px @ 0.70 JPEG)
      const imageBase64 = await grabTrackedCardImage();

      if (!imageBase64 && !auctionHint) {
        throw new Error('Kein Videobild der getrackten Karte verfügbar.');
      }

      console.log('[Card Scanner+] Ultra-Fast AI Capture initiated...');

      // TURBO DIRECT-VISION: If API key is present, execute zero-hop direct call to Gemini 2.5 Flash
      const stored = await chrome.storage.local.get(['geminiApiKey', 'backendUrl']);
      if (stored.geminiApiKey) geminiApiKey = stored.geminiApiKey.trim();
      if (stored.backendUrl) backendUrl = stored.backendUrl.replace(/\/+$/, '');

      let geminiCard = null;
      let latencyMs = 0;

      if (geminiApiKey && imageBase64) {
        try {
          const directRes = await performDirectGeminiVision(imageBase64, geminiApiKey);
          if (directRes && directRes.name) {
            geminiCard = directRes;
          }
        } catch (e) {
          console.warn('[Card Scanner+] Direct vision fallback to backend:', e.message);
        }
      }

      // Query Backend for Cardmarket & TCGplayer Pricing
      await queryAIBackend(imageBase64, auctionHint, currentLiveBid, geminiCard, scanStartTime);
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
   * High-Speed Direct Browser-to-Gemini Call (Zero-Hop Turbo Vision)
   */
  async function performDirectGeminiVision(imageBase64, apiKey) {
    let cleanBase64 = imageBase64;
    let mimeType = 'image/jpeg';
    if (imageBase64.startsWith('data:')) {
      const parts = imageBase64.split(',');
      const match = parts[0].match(/data:(.*?);base64/);
      if (match) mimeType = match[1];
      cleanBase64 = parts[1] || '';
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [
          {
            text: `You are an expert Pokemon card identifier. Analyze this card.
Return JSON:
{
  "name": string (Card name, e.g. "Paldea-Suelord ex", "Mew V", "Iron Treads ex"),
  "name_de": string or null,
  "set_name": string (e.g. "Paldea Evolved", "Fusion Strike"),
  "number": string (e.g. "130/193", "069/264"),
  "rarity": string (e.g. "Double Rare", "Ultra Rare", "Art Rare"),
  "language": "DE" | "EN" | "JP"
}`
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64
            }
          }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.0,
        max_output_tokens: 160
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Gemini Vision HTTP ${res.status}`);
    }

    const data = await res.json();
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return null;

    const parsed = JSON.parse(txt);
    const name = parsed.name_de || parsed.name || parsed.card_name || null;
    if (!name || name === 'null') return null;

    return {
      name: name,
      name_de: parsed.name_de || name,
      set_name: parsed.set_name || 'Pokémon TCG',
      number: parsed.number || parsed.card_number || '',
      rarity: parsed.rarity || 'Ultra Rare',
      language: (parsed.language || 'DE').toUpperCase()
    };
  }

  /**
   * Slices the exact inner tracked card boundary (Optimized 380x532px for max speed)
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
          canvas.width = 380;
          canvas.height = 532;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 380, 532);

          resolve(canvas.toDataURL('image/jpeg', 0.70));
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
  }

  /**
   * Queries Vercel Backend for Cardmarket & TCGplayer Pricing
   */
  async function queryAIBackend(imageBase64, auctionHint, currentLiveBid, directGeminiCard = null, scanStartTime = 0) {
    try {
      const endpoint = `${backendUrl}/api/search-candidates`;
      const queryStr = directGeminiCard ? `${directGeminiCard.name} ${directGeminiCard.number}`.trim() : '';

      const payload = {
        imageBase64: directGeminiCard ? null : imageBase64, // Only send image if direct vision was not performed
        customApiKey: geminiApiKey,
        query: queryStr,
        auctionHint: auctionHint || '',
        currentBid: currentLiveBid
      };

      console.log(`[Card Scanner+] Fetching prices from ${endpoint}...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Backend antwortete mit HTTP ${res.status}`);
      }

      const data = await res.json();
      const totalLatency = scanStartTime > 0 ? Math.round(performance.now() - scanStartTime) : 0;
      console.log(`[Card Scanner+] Scan completed in ${totalLatency}ms:`, data);

      let candidateList = [];
      if (Array.isArray(data.candidates)) {
        candidateList = data.candidates;
      } else if (Array.isArray(data.candidates?.candidates)) {
        candidateList = data.candidates.candidates;
      } else if (Array.isArray(data.result?.candidates)) {
        candidateList = data.result.candidates;
      }

      // If directGeminiCard exists and candidateList is empty, create instant hero candidate
      if (candidateList.length === 0 && directGeminiCard) {
        const numStr = directGeminiCard.number || '';
        const sQuery = `${directGeminiCard.name} ${numStr}`.trim();
        candidateList.push({
          id: `turbo_match_${Date.now()}`,
          name: directGeminiCard.name,
          set_name: directGeminiCard.set_name,
          number: numStr,
          rarity: directGeminiCard.rarity,
          language: directGeminiCard.language,
          match_score: 99,
          price_trend: null,
          tcgplayer_price_usd: null,
          tcgplayer_url: `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(sQuery)}&view=grid`,
          cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(sQuery)}`,
          image_url: null
        });
      }

      const firstCand = candidateList[0];
      const detectedTitle = firstCand ? `${firstCand.name} (${firstCand.number || firstCand.set_name || ''})` : null;
      const isMissingKey = data.status === 'NO_API_KEY' || data.candidates?.status === 'NO_API_KEY';

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidateList, 0, {
          detectedCode: detectedTitle,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid,
          missingApiKey: isMissingKey,
          apiMessage: data.apiMessage || data.candidates?.apiMessage,
          latencyMs: totalLatency
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
        body: JSON.stringify({ query: query })
      });

      const data = await res.json();
      let candidateList = [];
      if (Array.isArray(data.candidates)) candidateList = data.candidates;
      else if (Array.isArray(data.candidates?.candidates)) candidateList = data.candidates.candidates;

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidateList, 0, {
          detectedCode: query
        });
      }
    } catch (e) {
      console.error('[Card Scanner+] Manual search failed:', e);
    }
  }

  function getWhatnotLiveAuctionHint() {
    const selectors = [
      '[class*="ListingTitle"]',
      '[class*="listing-title"]',
      '[data-testid="listing-title"]',
      'h1[class*="title"]',
      'h2[class*="title"]',
      '.live-product-title'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return null;
  }

  function getCurrentWhatnotBid() {
    const selectors = [
      '[class*="CurrentBid"]',
      '[class*="current-bid"]',
      '[data-testid="current-bid"]',
      '[class*="BidAmount"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        const match = el.innerText.match(/[\d.,]+/);
        if (match) return parseFloat(match[0].replace(',', '.'));
      }
    }
    return null;
  }
})();
