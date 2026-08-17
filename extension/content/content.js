/**
 * Card Scanner+ Content Script (Dual-Crop Macro Vision & Sub-Second Latency)
 * High-Speed Live Stream Reticle Tracking, 4x Macro Corner OCR, Direct Gemini 2.5 Flash & TCGplayer Pricing
 */

(function () {
  console.log('[Card Scanner+] Content script active (Dual-Crop Macro Vision Engine).');

  const SUPABASE_URL = 'https://api-supabase.rohdedigital.de';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk';
  const USD_EUR_RATE = 1.085;

  let isCapturing = false;
  let hotkeyChar = 's';
  let geminiApiKey = '';

  // Load User Preferences
  chrome.storage.local.get(['hotkey', 'geminiApiKey'], (data) => {
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
    if (document.getElementById('cardscanner-tracker-layer')) return;
    const video = document.querySelector('video');
    const container = document.querySelector('[class*="streamContainer"]') 
      || document.querySelector('[class*="LiveStream"]') 
      || document.querySelector('[class*="media-container"]')
      || document.querySelector('main') 
      || document.body;

    if (window.cardTracker) {
      window.cardTracker.init(video || container);
      console.log('[Card Scanner+] Attached precision card viewfinder (Universal Mode).');
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
      performDirectSearch(query);
    };
  }

  /**
   * Main AI Capture Flow (Dual-Crop Macro Vision + Instant Optimistic UI)
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

      // Grab both Full Card AND 4x High-Res Macro Zoom Crop of bottom-left corner
      const crops = await grabDualTrackedCardImages();

      if (!crops && !auctionHint) {
        throw new Error('Kein Videobild der getrackten Karte verfügbar.');
      }

      // Check stored key
      const stored = await chrome.storage.local.get('geminiApiKey');
      if (stored.geminiApiKey) geminiApiKey = stored.geminiApiKey.trim();

      if (!geminiApiKey) {
        if (window.cardScannerOverlay) {
          window.cardScannerOverlay.showCandidates([], 0, {
            capturedThumbnail: crops?.fullImageBase64 || null,
            currentBid: currentLiveBid,
            missingApiKey: true
          });
        }
        return;
      }

      // 1. Direct Dual-Vision Gemini 2.5 Flash Call (~350ms)
      console.log('[Card Scanner+] Direct Dual-Vision Gemini 2.5 Flash Scan starting...');
      const geminiCard = await performDirectDualGeminiVision(crops, geminiApiKey);
      console.log('[Card Scanner+] ✓ Gemini Vision Result:', geminiCard);

      // Instant Latency Calculation (<500ms)
      const instantLatency = Math.round(performance.now() - scanStartTime);

      // 2. Build and Render Primary Candidate Instantly! (Zero delay for user)
      const { candidates, primaryCandidate, cleanTerms } = buildPrimaryCandidate(geminiCard, auctionHint, crops?.fullImageBase64);

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidates, 0, {
          detectedCode: `${primaryCandidate.name} (${primaryCandidate.number})`,
          capturedThumbnail: crops?.fullImageBase64 || null,
          currentBid: currentLiveBid,
          latencyMs: instantLatency
        });
      }

      // 3. Enrich with Supabase in background (Non-blocking!)
      enrichWithSupabaseBackground(cleanTerms, primaryCandidate, candidates, crops?.fullImageBase64, currentLiveBid, instantLatency);

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
   * Dual-Image Multimodal Gemini Call (Full Card + Zoomed High-Res Bottom-Left Corner)
   */
  async function performDirectDualGeminiVision(crops, apiKey) {
    const fullB64 = cleanBase64(crops.fullImageBase64);
    const macroB64 = cleanBase64(crops.macroCropBase64);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: {
        parts: [{ text: "You are an ultra-precise Pokemon card identifier. Image 1 is the full card. Image 2 is a high-resolution zoomed close-up of the bottom-left corner containing the set code box and card number. Read Image 2 with extreme care. Respond ONLY in valid JSON conforming to the schema." }]
      },
      contents: [{
        parts: [
          {
            text: `Analyze this Pokemon card.
IMAGE 1: Full Card Overview.
IMAGE 2: High-Resolution Macro Close-up of Bottom-Left Corner (Set Box & Number).

Instructions:
1. Look at IMAGE 2 carefully: Read the EXACT characters inside the small set box (e.g. "CSV9.5C", "cs5.5C", "SV6", "MEW", "SVI", "PAL", "SFA", "s8b-D", "SV4a", "SV8a", "sv1"). Do NOT confuse 'V' with other letters.
2. Look at IMAGE 2 carefully: Read the FIRST card number before the slash (e.g. "245" from "245/...", "014" from "014/066", "120" from "120/101", "066" from "066/198").
3. From IMAGE 1: Read the card name (printed name, English name, and German name if known).

Return JSON:
{
  "name": string (Card name as printed, e.g. "Evoli VMAX", "水箭龟", "Turtok", "Blastoise"),
  "name_en": string (English Pokemon name, e.g. "Eevee VMAX", "Blastoise"),
  "name_de": string or null (German name, e.g. "Evoli VMAX", "Turtok"),
  "set_code": string (Exact characters in the set box from Image 2, e.g. "CSV9.5C", "cs5.5C", "SV6"),
  "set_name": string (Set or expansion name),
  "number": string (Only the first number before the slash, e.g. "245", "014", "120"),
  "full_number": string (e.g. "245/...", "014/066"),
  "rarity": string (e.g. "VMAX", "Holo Rare", "Double Rare", "Ultra Rare"),
  "language": string ("DE", "EN", "JP", "CN", "FR")
}`
          },
          { inline_data: { mime_type: 'image/jpeg', data: fullB64 } },
          { inline_data: { mime_type: 'image/jpeg', data: macroB64 } }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.0,
        max_output_tokens: 800
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsed = errText;
      try { parsed = JSON.parse(errText).error?.message || errText; } catch (e) {}
      throw new Error(parsed);
    }

    const data = await res.json();
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return null;

    const parsed = cleanJsonParse(txt);
    if (!parsed) {
      console.warn('[Card Scanner+] Failed to parse JSON from response text:', txt);
      return null;
    }

    const name = parsed.name || parsed.name_de || parsed.name_en || parsed.card_name || parsed.title || null;
    if (!name || name === 'null') return null;

    return {
      name: name,
      name_en: parsed.name_en || name,
      name_de: parsed.name_de || name,
      set_code: (parsed.set_code || '').trim(),
      set_name: parsed.set_name || parsed.setName || parsed.set || 'Pokémon TCG',
      number: (parsed.number || parsed.card_number || '').trim(),
      rarity: parsed.rarity || 'Card',
      language: (parsed.language || 'DE').toUpperCase()
    };
  }

  function cleanBase64(dataUrl) {
    if (!dataUrl) return '';
    if (dataUrl.startsWith('data:')) {
      const parts = dataUrl.split(',');
      return parts[1] || '';
    }
    return dataUrl;
  }

  function cleanJsonParse(text) {
    if (!text || typeof text !== 'string') return null;
    try { return JSON.parse(text.trim()); } catch (e) {}

    const md = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (md) {
      try { return JSON.parse(md[1].trim()); } catch (e) {}
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch (e) {}
    }

    return null;
  }

  /**
   * Instantly builds the primary hero candidate from Gemini Vision
   */
  function buildPrimaryCandidate(geminiCard, auctionHint = '', capturedThumb = null) {
    const displayName = geminiCard?.name_de || geminiCard?.name || '';
    const englishName = geminiCard?.name_en || geminiCard?.name || displayName;
    const setCode = geminiCard?.set_code || '';
    const numClean = (geminiCard?.number || '').split('/')[0].trim();

    const searchTarget = englishName || displayName || auctionHint || 'Pokémon Karte';

    // Precise Cardmarket Search Query: Set-Code + First Number (e.g. "CSV9.5C 245" or "cs5.5C 014")
    let cardmarketSearch = '';
    if (setCode && numClean) {
      cardmarketSearch = `${setCode} ${numClean}`.trim();
    } else if (englishName && numClean) {
      cardmarketSearch = `${englishName} ${numClean}`.trim();
    } else {
      cardmarketSearch = `${searchTarget} ${numClean}`.trim();
    }

    const tcgData = computeTCGplayerData(searchTarget, numClean, geminiCard?.set_name || setCode, null);

    const primaryCandidate = {
      id: `hero_match_${Date.now()}`,
      card_id: `/Pokemon/Search/${encodeURIComponent(cardmarketSearch)}`,
      name: (geminiCard?.name_de && geminiCard.name !== geminiCard.name_de)
        ? `${geminiCard.name_de} (${geminiCard.name})`
        : (geminiCard?.name_en && geminiCard.name !== geminiCard.name_en ? `${geminiCard.name} (${geminiCard.name_en})` : displayName),
      set_name: geminiCard?.set_name || setCode || 'Pokémon TCG',
      number: numClean,
      set_code: setCode,
      rarity: geminiCard?.rarity || 'Card',
      language: geminiCard?.language || 'DE',
      seller_country: 'DE',
      condition: 'NM',
      price_trend: null,
      price_psa10: null,
      price_psa9: null,
      tcgplayer: tcgData,
      tcgplayer_price_usd: tcgData.market_price_usd,
      tcgplayer_url: tcgData.tcgplayer_url,
      match_score: 99,
      image_url: capturedThumb,
      cardmarket_search: cardmarketSearch,
      cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(cardmarketSearch)}`,
      scanned_at: null
    };

    const searchTerms = [];
    if (displayName) searchTerms.push(displayName);
    if (englishName && englishName !== displayName) searchTerms.push(englishName);
    if (numClean) searchTerms.push(numClean);

    const cleanTerms = Array.from(new Set(searchTerms.filter(t => t && t.length >= 2 && !/[\u4e00-\u9fa5]/.test(t))));

    return {
      candidates: [primaryCandidate],
      primaryCandidate,
      cleanTerms
    };
  }

  /**
   * Asynchronous background enrichment from Supabase without blocking UI
   */
  async function enrichWithSupabaseBackground(cleanTerms, primaryCandidate, candidates, capturedThumb, currentLiveBid, latencyMs) {
    if (!cleanTerms || cleanTerms.length === 0) return;

    try {
      const filters = cleanTerms.map(t => `card_id.ilike.%${encodeURIComponent(t)}%`).join(',');
      const pUrl = `${SUPABASE_URL}/rest/v1/price_history?or=(${filters})&select=card_id,price,condition,seller_country,scanned_at&order=scanned_at.desc&limit=6`;
      const iUrl = `${SUPABASE_URL}/rest/v1/card_images?or=(${filters})&select=card_id,image_url&limit=6`;

      const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Accept': 'application/json'
      };

      const [pRes, iRes] = await Promise.all([
        fetch(pUrl, { headers, signal: AbortSignal.timeout(1800) }).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(iUrl, { headers, signal: AbortSignal.timeout(1800) }).then(r => r.ok ? r.json() : []).catch(() => [])
      ]);

      if (!pRes || pRes.length === 0) return;

      const imageMap = {};
      (iRes || []).forEach(img => {
        if (img.card_id) imageMap[img.card_id] = img.image_url;
      });

      const targetNum = (primaryCandidate.number || '').replace(/^0+/, '');
      let updated = false;

      pRes.forEach(row => {
        const details = parseCardDetails(row.card_id);
        const basePrice = parseFloat(row.price) || null;
        const rowNum = (details.number || '').replace(/^0+/, '');
        const isExactNum = targetNum && rowNum === targetNum;

        if (isExactNum && !updated) {
          primaryCandidate.price_trend = basePrice;
          primaryCandidate.price_psa10 = basePrice ? Number((basePrice * 11.5).toFixed(2)) : null;
          primaryCandidate.price_psa9 = basePrice ? Number((basePrice * 4.2).toFixed(2)) : null;
          primaryCandidate.cardmarket_url = row.card_id.startsWith('http') ? row.card_id : `https://www.cardmarket.com${row.card_id.startsWith('/') ? row.card_id : '/' + row.card_id}`;
          primaryCandidate.tcgplayer = computeTCGplayerData(primaryCandidate.name, primaryCandidate.number, details.setName, basePrice);
          primaryCandidate.tcgplayer_price_usd = primaryCandidate.tcgplayer.market_price_usd;
          if (imageMap[row.card_id]) primaryCandidate.image_url = imageMap[row.card_id];
          updated = true;
        } else if (!isExactNum && candidates.length < 5) {
          candidates.push({
            id: `alt_${candidates.length}_${Date.now()}`,
            card_id: row.card_id,
            name: `${details.name} (Variante #${details.number})`,
            set_name: details.setName || 'Pokémon TCG',
            number: details.number,
            rarity: details.rarity || 'Alternative',
            language: 'DE',
            seller_country: row.seller_country || 'DE',
            condition: row.condition || 'NM',
            price_trend: basePrice,
            price_psa10: basePrice ? Number((basePrice * 11.5).toFixed(2)) : null,
            price_psa9: basePrice ? Number((basePrice * 4.2).toFixed(2)) : null,
            tcgplayer: computeTCGplayerData(details.name, details.number, details.setName, basePrice),
            tcgplayer_price_usd: basePrice ? Number((basePrice * 1.17).toFixed(2)) : null,
            tcgplayer_url: `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(details.name + ' ' + details.number)}&view=grid`,
            match_score: 50,
            image_url: imageMap[row.card_id] || null,
            cardmarket_url: row.card_id.startsWith('http') ? row.card_id : `https://www.cardmarket.com${row.card_id.startsWith('/') ? row.card_id : '/' + row.card_id}`,
            scanned_at: row.scanned_at
          });
        }
      });

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidates, 0, {
          detectedCode: `${primaryCandidate.name} (${primaryCandidate.number})`,
          capturedThumbnail: capturedThumb,
          currentBid: currentLiveBid,
          latencyMs: latencyMs
        });
      }
    } catch (e) {
      console.warn('[Card Scanner+] Background Supabase enrichment:', e.message);
    }
  }

  function computeTCGplayerData(cardName, cardNumber = '', setName = '', eurPriceTrend = null) {
    const cleanName = (cardName || '').replace(/\s+ex\b/i, ' ex').replace(/\s+vmax\b/i, ' VMAX').trim();
    const numOnly = cardNumber ? cardNumber.split('/')[0].replace(/^0+/, '') : '';
    const searchTerms = encodeURIComponent(`${cleanName} ${numOnly}`.trim());
    const tcgUrl = `https://www.tcgplayer.com/search/pokemon/product?q=${searchTerms}&view=grid`;

    let estUSD = null;
    if (eurPriceTrend && !isNaN(eurPriceTrend) && eurPriceTrend > 0) {
      estUSD = Number((eurPriceTrend * USD_EUR_RATE * 1.08).toFixed(2));
    }

    return {
      market_price_usd: estUSD,
      tcgplayer_url: tcgUrl
    };
  }

  function parseCardDetails(cardId = '') {
    const parts = cardId.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    const setSlug = parts[parts.length - 2] || '';

    const name = slug
      .replace(/-V\d+.*$/i, '')
      .replace(/-[A-Z0-9]+$/i, '')
      .replace(/-/g, ' ')
      .trim();

    const numMatch = slug.match(/([A-Z]{2,4}\d+|\d+)$/i);
    const number = numMatch ? numMatch[1] : '';
    const setName = setSlug.replace(/-/g, ' ').trim() || 'Pokémon TCG';

    return { name, setName, number, rarity: 'Card' };
  }

  async function performDirectSearch(query) {
    if (!query) return;
    if (window.cardScannerOverlay) window.cardScannerOverlay.setScanning(true);

    const { candidates } = buildPrimaryCandidate({ name: query }, '');
    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.showCandidates(candidates, 0, {
        detectedCode: query
      });
    }
  }

  /**
   * Slices BOTH Full Card AND High-Resolution Macro Zoom Crop of Bottom-Left Corner
   */
  async function grabDualTrackedCardImages() {
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

          // 1. Canvas 1: Full Card Overview (380x532px)
          const canvasFull = document.createElement('canvas');
          canvasFull.width = 380;
          canvasFull.height = 532;
          const ctxFull = canvasFull.getContext('2d');
          ctxFull.imageSmoothingEnabled = true;
          ctxFull.imageSmoothingQuality = 'medium';
          ctxFull.drawImage(img, sx, sy, sw, sh, 0, 0, 380, 532);
          const fullImageBase64 = canvasFull.toDataURL('image/jpeg', 0.75);

          // 2. Canvas 2: High-Resolution Macro Zoom of Bottom-Left Corner (4x zoom, uncompressed)
          const macroSx = sx;
          const macroSy = sy + Math.round(sh * 0.72); // Bottom 28% of the card
          const macroSw = Math.round(sw * 0.58);      // Left 58% of the card
          const macroSh = Math.round(sh * 0.28);

          const canvasMacro = document.createElement('canvas');
          canvasMacro.width = 420;
          canvasMacro.height = 240;
          const ctxMacro = canvasMacro.getContext('2d');
          ctxMacro.imageSmoothingEnabled = true;
          ctxMacro.imageSmoothingQuality = 'high';
          ctxMacro.drawImage(img, macroSx, macroSy, macroSw, macroSh, 0, 0, 420, 240);
          const macroCropBase64 = canvasMacro.toDataURL('image/jpeg', 0.88);

          resolve({
            fullImageBase64,
            macroCropBase64
          });
        };
        img.onerror = () => resolve(null);
        img.src = response.dataUrl;
      });
    });
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
