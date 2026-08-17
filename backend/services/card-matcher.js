/**
 * Card Matcher Service for Card Scanner+
 * Precision Card Matching across Supabase price_history & card_images
 */

import { searchPriceHistory, searchCardImages, fetchCardImages, parseCardDetailsFromId } from './supabase.js';
import { memoryCache } from './cache.js';

export async function matchCandidates(params = {}) {
  const { number, total, promoCode, setCode, code, artist, hp, auctionHint, query } = params;
  const searchKey = `${number || ''}_${total || ''}_${promoCode || ''}_${setCode || ''}_${code || ''}_${artist || ''}_${hp || ''}_${auctionHint || ''}_${query || ''}`.trim();

  if (!searchKey) return [];

  // 1. Check L1 Memory Cache
  const cached = memoryCache.get(searchKey);
  if (cached) {
    console.log(`[Card Matcher] Cache Hit for '${searchKey}' (${cached.length} candidates)`);
    return cached;
  }

  // 2. Build Precise Search Terms
  const searchTerms = [];

  // Auction Hint from Whatnot DOM (e.g. "Schiggy (sv2a 170)" or "Marill #11")
  if (auctionHint) {
    const hintMatch = auctionHint.match(/([a-zA-Z\u00C0-\u017F\s]+)\s*\(([^)]+)\)/);
    if (hintMatch) {
      searchTerms.push(hintMatch[1].trim());
      searchTerms.push(hintMatch[2].trim());
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

  if (code && !searchTerms.includes(code)) {
    searchTerms.push(code);
    searchTerms.push(code.replace('/', '-'));
  }

  if (number && !searchTerms.includes(number)) {
    searchTerms.push(number);
    if (number.length === 3 && number.startsWith('0')) {
      searchTerms.push(number.replace(/^0+/, ''));
    }
  }

  if (artist) {
    searchTerms.push(artist);
  }

  console.log('[Card Matcher] Searching Supabase with clean terms:', searchTerms);

  // 3. Search Price History & Images
  const [priceRows, imageRows] = await Promise.all([
    searchPriceHistory(searchTerms),
    searchCardImages(searchTerms)
  ]);

  const candidateMap = new Map();

  // Process Price History Rows (With Verified Market Prices)
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

  // Process Additional Image Rows
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
