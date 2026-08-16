/**
 * Card Matcher Service for Card Scanner+
 * Translates OCR-extracted set numbers and codes into verified Cardmarket candidate cards
 */

import { searchPriceHistory, searchCardImages, fetchCardImages, parseCardDetailsFromId } from './supabase.js';
import { memoryCache } from './cache.js';

export async function matchCandidates(params = {}) {
  const { number, total, promoCode, setCode, code, rawText, auctionHint, query } = params;
  const searchKey = `${number || ''}_${total || ''}_${promoCode || ''}_${setCode || ''}_${code || ''}_${rawText || ''}_${auctionHint || ''}_${query || ''}`.trim();

  // 1. Check L1 Memory Cache
  const cached = memoryCache.get(searchKey);
  if (cached) {
    console.log(`[Card Matcher] Cache Hit for '${searchKey}' (${cached.length} candidates)`);
    return cached;
  }

  // 2. Build Multi-Tiered Search Terms
  const searchTerms = [];

  // If Whatnot DOM had an auction hint (e.g. "Schiggy (sv2a 170)")
  if (auctionHint) {
    const hintMatch = auctionHint.match(/([a-zA-Z\u00C0-\u017F\s]+)\s*\(([^)]+)\)/);
    if (hintMatch) {
      searchTerms.push(hintMatch[1].trim()); // e.g. Schiggy
      searchTerms.push(hintMatch[2].trim()); // e.g. sv2a 170
      searchTerms.push(hintMatch[2].replace(/\s+/g, '-').trim());
    } else {
      searchTerms.push(auctionHint.trim());
    }
  }

  if (query) {
    searchTerms.push(query.trim());
    searchTerms.push(query.trim().replace(/\s+/g, '-'));
  }

  if (setCode && number) {
    searchTerms.push(`${setCode}${number}`);
    searchTerms.push(`${setCode}-${number}`);
    searchTerms.push(`${setCode} ${number}`);
  }

  if (promoCode && number) {
    searchTerms.push(`${promoCode}-${number}`);
    searchTerms.push(`${promoCode}${number}`);
    searchTerms.push(`${promoCode} ${number}`);
  }

  if (number && total) {
    searchTerms.push(`${number}/${total}`);
    searchTerms.push(`${number}-${total}`);
    searchTerms.push(`${number}%${total}`);
  }

  if (code) {
    searchTerms.push(code);
    searchTerms.push(code.replace('/', '-'));
  }

  if (number) {
    searchTerms.push(number);
    if (number.length === 3 && number.startsWith('0')) {
      searchTerms.push(number.replace(/^0+/, '')); // e.g. 073 -> 73
    }
  }

  // Extract standalone 3-digit numbers from raw text
  if (rawText) {
    const numMatches = rawText.match(/\b\d{2,3}\b/g);
    if (numMatches) {
      for (const m of numMatches) {
        if (!searchTerms.includes(m)) searchTerms.push(m);
      }
    }
    const wordMatches = rawText.match(/\b[A-Za-z]{3,}\b/g);
    if (wordMatches) {
      for (const w of wordMatches) {
        if (w.length >= 4 && !searchTerms.includes(w)) searchTerms.push(w);
      }
    }
  }

  console.log('[Card Matcher] Searching Supabase with terms:', searchTerms);

  // 3. Search Price History & Images
  const [priceRows, imageRows] = await Promise.all([
    searchPriceHistory(searchTerms),
    searchCardImages(searchTerms)
  ]);

  const candidateMap = new Map();

  // Process Price History Rows (Highest priority because they have verified market prices)
  if (priceRows && priceRows.length > 0) {
    const cardIds = priceRows.map(r => r.card_id).filter(Boolean);
    const imageMap = await fetchCardImages(cardIds);

    for (const row of priceRows) {
      if (candidateMap.has(row.card_id)) continue;

      const details = parseCardDetailsFromId(row.card_id);
      const img = imageMap[row.card_id] || imageMap[row.card_id.replace(/^\/+/, '')] || null;
      const basePrice = parseFloat(row.price) || null;

      candidateMap.set(row.card_id, {
        id: `match_${candidateMap.size}_${Date.now()}`,
        card_id: row.card_id,
        name: details.name,
        set_name: details.setName,
        number: details.number || number || '',
        rarity: details.rarity,
        language: (row.language || 'EN').toUpperCase(),
        seller_country: row.seller_country || 'DE',
        condition: row.condition || 'NM',
        price_trend: basePrice,
        price_psa10: basePrice ? Number((basePrice * 11.5).toFixed(2)) : null,
        price_psa9: basePrice ? Number((basePrice * 4.2).toFixed(2)) : null,
        match_score: candidateMap.size === 0 ? 99 : Math.max(50, 60 - candidateMap.size * 5),
        image_url: img,
        cardmarket_url: row.card_id.startsWith('http') ? row.card_id : `https://www.cardmarket.com${row.card_id.startsWith('/') ? row.card_id : '/' + row.card_id}`,
        scanned_at: row.scanned_at
      });

      if (candidateMap.size >= 5) break;
    }
  }

  // Process Additional Image Rows (if not already found in price history)
  if (candidateMap.size < 5 && imageRows && imageRows.length > 0) {
    for (const imgRow of imageRows) {
      if (candidateMap.has(imgRow.card_id)) continue;

      const details = parseCardDetailsFromId(imgRow.card_id);
      candidateMap.set(imgRow.card_id, {
        id: `img_match_${candidateMap.size}_${Date.now()}`,
        card_id: imgRow.card_id,
        name: details.name,
        set_name: details.setName,
        number: details.number || number || '',
        rarity: details.rarity,
        language: 'JP',
        seller_country: 'DE',
        condition: 'NM',
        price_trend: null,
        price_psa10: null,
        price_psa9: null,
        match_score: candidateMap.size === 0 ? 90 : 50,
        image_url: imgRow.image_url,
        cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(details.name)}`,
        scanned_at: null
      });

      if (candidateMap.size >= 5) break;
    }
  }

  const candidates = Array.from(candidateMap.values());

  // Store in L1 Cache
  if (candidates.length > 0) {
    memoryCache.set(searchKey, candidates);
  }

  return candidates;
}
