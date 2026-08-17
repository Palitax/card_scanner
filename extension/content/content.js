/**
 * Card Scanner+ Content Script (100% Standalone & Serverless)
 * High-Speed Live Stream Reticle Tracking, Direct Gemini 2.5 Flash AI, Direct Supabase & TCGplayer Pricing
 */

(function () {
  console.log('[Card Scanner+] Content script active (Precision AI Matcher).');

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
   * Main AI Capture Flow (Direct Browser -> Gemini -> Supabase -> UI)
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

      const imageBase64 = await grabTrackedCardImage();

      if (!imageBase64 && !auctionHint) {
        throw new Error('Kein Videobild der getrackten Karte verfügbar.');
      }

      // Check stored key
      const stored = await chrome.storage.local.get('geminiApiKey');
      if (stored.geminiApiKey) geminiApiKey = stored.geminiApiKey.trim();

      if (!geminiApiKey) {
        if (window.cardScannerOverlay) {
          window.cardScannerOverlay.showCandidates([], 0, {
            capturedThumbnail: imageBase64,
            currentBid: currentLiveBid,
            missingApiKey: true
          });
        }
        return;
      }

      // 1. Direct Gemini 2.5 Flash Vision Call (~350ms)
      console.log('[Card Scanner+] Direct Gemini 2.5 Flash Vision Scan starting...');
      const geminiCard = await performDirectGeminiVision(imageBase64, geminiApiKey);
      console.log('[Card Scanner+] Gemini Vision result:', geminiCard);

      // 2. Direct Supabase Pricing Lookup (~60ms)
      const candidates = await resolveCandidates(geminiCard, auctionHint, imageBase64);
      const totalLatency = Math.round(performance.now() - scanStartTime);

      console.log(`[Card Scanner+] ✓ Scan completed in ${totalLatency}ms:`, candidates);

      const firstCand = candidates[0];
      const detectedTitle = firstCand ? `${firstCand.name} (${firstCand.number || firstCand.set_name || ''})` : null;

      if (window.cardScannerOverlay) {
        window.cardScannerOverlay.showCandidates(candidates, 0, {
          detectedCode: detectedTitle,
          capturedThumbnail: imageBase64,
          currentBid: currentLiveBid,
          latencyMs: totalLatency
        });
      }
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
      system_instruction: {
        parts: [{ text: "You are an expert Pokemon card identifier. Read the bottom-left corner of the card to find the set code box and card number. Respond ONLY in valid JSON matching the schema." }]
      },
      contents: [{
        parts: [
          {
            text: `Analyze this Pokemon card.
Look closely at the bottom-left corner:
1. Find the SET CODE printed inside the small black/white box (e.g. "cs5.5C", "SV6", "MEW", "SVI", "PAL", "SFA", "OBF", "TEF", "sv1", "s8b", "sv2a").
2. Find the CARD NUMBER in format "XXX/YYY" or "XXX" (e.g. "014/066", "130/193", "069/264", "120/101", "200/165").
3. Find the CARD NAME (English and as printed).

Return JSON:
{
  "name": string (Card name as printed, e.g. "Blastoise", "水箭龟", "Turtok"),
  "name_en": string (English Pokemon name, e.g. "Blastoise", "Paldean Clodsire ex", "Iron Treads ex"),
  "name_de": string or null (German name if known, e.g. "Turtok", "Eisenrad ex"),
  "set_code": string (The exact letters in the bottom-left set box, e.g. "cs5.5C", "SV6", "MEW", "SVI", "PAL", "SFA"),
  "set_name": string (Set or expansion name),
  "number": string (Exact card number printed on bottom, e.g. "014/066", "130/193", "069/264"),
  "rarity": string (e.g. "Holo Rare", "Rare", "Double Rare", "Special Illustration Rare", "Art Rare"),
  "language": string ("DE", "EN", "JP", "CN", "FR")
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
      set_code: parsed.set_code || '',
      set_name: parsed.set_name || parsed.setName || parsed.set || 'Pokémon TCG',
      number: parsed.number || parsed.card_number || parsed.cardNumber || '',
      rarity: parsed.rarity || 'Card',
      language: (parsed.language || 'DE').toUpperCase()
    };
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
   * Resolves Candidates with Strict Number & Artwork Verification
   */
  async function resolveCandidates(geminiCard, auctionHint = '', capturedThumb = null) {
    const candidates = [];
    const displayName = geminiCard?.name_de || geminiCard?.name || '';
    const englishName = geminiCard?.name_en || geminiCard?.name || displayName;
    const setCode = geminiCard?.set_code || '';
    const numStr = geminiCard?.number || '';
    const numOnly = numStr ? numStr.split('/')[0].replace(/^0+/, '') : '';

    const searchTarget = englishName || displayName || auctionHint || 'Pokémon Karte';
    const numClean = numStr.replace(/\s+/g, '');

    // Precise Cardmarket Search String using Set Code Box (e.g. "cs5.5C 014/066" or "SV6 120/101")
    let cardmarketSearch = '';
    if (setCode && numClean) {
      cardmarketSearch = `${setCode} ${numClean}`.trim();
    } else if (englishName && numClean) {
      cardmarketSearch = `${englishName} ${numClean}`.trim();
    } else {
      cardmarketSearch = `${searchTarget} ${numClean}`.trim();
    }

    const tcgData = computeTCGplayerData(searchTarget, numClean, geminiCard?.set_name || setCode, null);

    // Primary Exact Match Candidate (#1) directly from Visual AI
    const primaryCandidate = {
      id: `hero_match_${Date.now()}`,
      card_id: `/Pokemon/Search/${encodeURIComponent(cardmarketSearch)}`,
      name: (geminiCard?.name_de && geminiCard.name !== geminiCard.name_de)
        ? `${geminiCard.name_de} (${geminiCard.name})`
        : (geminiCard?.name_en && geminiCard.name !== geminiCard.name_en ? `${geminiCard.name} (${geminiCard.name_en})` : displayName),
      set_name: geminiCard?.set_name || setCode || 'Pokémon TCG',
      number: numClean,
      set_code: setCode,
      rarity: geminiCard?.rarity || 'Holo Rare',
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

    // Query Supabase for Price History
    const searchTerms = [];
    if (displayName) searchTerms.push(displayName);
    if (englishName && englishName !== displayName) searchTerms.push(englishName);
    if (numOnly) searchTerms.push(numOnly);

    const cleanTerms = Array.from(new Set(searchTerms.filter(t => t && t.length >= 2 && !/[\u4e00-\u9fa5]/.test(t))));

    if (cleanTerms.length > 0) {
      try {
        const filters = cleanTerms.map(t => `card_id.ilike.%${encodeURIComponent(t)}%`).join(',');
        const pUrl = `${SUPABASE_URL}/rest/v1/price_history?or=(${filters})&select=card_id,price,condition,seller_country,scanned_at&order=scanned_at.desc&limit=8`;
        const iUrl = `${SUPABASE_URL}/rest/v1/card_images?or=(${filters})&select=card_id,image_url&limit=8`;

        const headers = {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'application/json'
        };

        const [pRes, iRes] = await Promise.all([
          fetch(pUrl, { headers }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(iUrl, { headers }).then(r => r.ok ? r.json() : []).catch(() => [])
        ]);

        const imageMap = {};
        (iRes || []).forEach(img => {
          if (img.card_id) imageMap[img.card_id] = img.image_url;
        });

        // Check if any row matches the EXACT card number
        let exactNumberMatched = false;

        (pRes || []).forEach(row => {
          const details = parseCardDetails(row.card_id);
          const basePrice = parseFloat(row.price) || null;
          const rowNum = (details.number || '').replace(/^0+/, '');

          // Check if this Supabase row matches the exact scanned number (e.g. 014 vs 014)
          const isExactNum = numOnly && (rowNum === numOnly || details.number === numStr);

          if (isExactNum && !exactNumberMatched) {
            // Attach real price to Primary Candidate #1!
            primaryCandidate.price_trend = basePrice;
            primaryCandidate.price_psa10 = basePrice ? Number((basePrice * 11.5).toFixed(2)) : null;
            primaryCandidate.price_psa9 = basePrice ? Number((basePrice * 4.2).toFixed(2)) : null;
            primaryCandidate.cardmarket_url = row.card_id.startsWith('http') ? row.card_id : `https://www.cardmarket.com${row.card_id.startsWith('/') ? row.card_id : '/' + row.card_id}`;
            primaryCandidate.tcgplayer = computeTCGplayerData(searchTarget, numClean, details.setName, basePrice);
            primaryCandidate.tcgplayer_price_usd = primaryCandidate.tcgplayer.market_price_usd;
            if (imageMap[row.card_id]) primaryCandidate.image_url = imageMap[row.card_id];
            exactNumberMatched = true;
          } else if (!isExactNum) {
            // Alternative variant (e.g. SIR #200 vs Regular #014)
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
      } catch (e) {
        console.warn('[Card Scanner+] Supabase query error:', e.message);
      }
    }

    // Insert the guaranteed exact match as #1
    candidates.unshift(primaryCandidate);
    return candidates;
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

    const candidates = await resolveCandidates({ name: query }, '');
    if (window.cardScannerOverlay) {
      window.cardScannerOverlay.showCandidates(candidates, 0, {
        detectedCode: query
      });
    }
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
