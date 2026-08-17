/**
 * Card Matcher Service for Card Scanner+
 * Combines Gemini Flash Multimodal Vision AI with Supabase Price Database
 */

import { identifyCardWithGemini } from './gemini-vision.js';
import { searchPriceHistory, searchCardImages, fetchCardImages, parseCardDetailsFromId } from './supabase.js';
import { memoryCache } from './cache.js';

export async function matchCandidates(params = {}) {
  const { imageBase64, customApiKey, number, total, promoCode, setCode, code, artist, hp, auctionHint, query } = params;

  let geminiCard = null;

  // 1. If an image is provided, run high-speed Gemini Flash Vision AI
  if (imageBase64) {
    geminiCard = await identifyCardWithGemini(imageBase64, customApiKey);
  }

  // 2. Build Search Keys & Cache Key
  const cardName = geminiCard?.card_name || geminiCard?.card_name_de || geminiCard?.card_name_en || query || '';
  const detectedNumber = geminiCard?.card_number || number || '';
  const detectedSet = geminiCard?.set_name || setCode || '';
  const detectedCode = geminiCard?.full_number_code || code || '';

  const searchKey = `${cardName}_${detectedNumber}_${detectedSet}_${detectedCode}_${auctionHint || ''}`.trim();

  if (searchKey) {
    const cached = memoryCache.get(searchKey);
    if (cached) {
      console.log(`[Card Matcher] Cache Hit for '${searchKey}' (${cached.length} candidates)`);
      return cached;
    }
  }

  // 3. Build Multi-Tiered Search Terms for Supabase
  const searchTerms = [];

  if (auctionHint) {
    const hintMatch = auctionHint.match(/([a-zA-Z\u00C0-\u017F\s]+)\s*\(([^)]+)\)/);
    if (hintMatch) {
      searchTerms.push(hintMatch[1].trim());
      searchTerms.push(hintMatch[2].trim());
    } else {
      searchTerms.push(auctionHint.trim());
    }
  }

  if (geminiCard) {
    if (geminiCard.card_name) searchTerms.push(geminiCard.card_name);
    if (geminiCard.card_name_de) searchTerms.push(geminiCard.card_name_de);
    if (geminiCard.card_number) searchTerms.push(geminiCard.card_number);
    if (geminiCard.full_number_code) searchTerms.push(geminiCard.full_number_code);
    if (geminiCard.set_code && geminiCard.card_number) {
      searchTerms.push(`${geminiCard.set_code}${geminiCard.card_number}`);
      searchTerms.push(`${geminiCard.set_code}-${geminiCard.card_number}`);
    }
  }

  if (query) {
    searchTerms.push(query.trim());
  }

  if (number) searchTerms.push(number);
  if (code) searchTerms.push(code);

  const cleanTerms = Array.from(new Set(searchTerms.filter(t => t && t.length >= 2)));
  console.log('[Card Matcher] Searching Supabase with terms:', cleanTerms);

  // 4. Query Supabase
  const [priceRows, imageRows] = await Promise.all([
    searchPriceHistory(cleanTerms),
    searchCardImages(cleanTerms)
  ]);

  const candidateMap = new Map();

  // Process Supabase Price History (Highest Priority - Real Prices)
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
        name: details.name || geminiCard?.card_name || 'Pokémon Karte',
        set_name: details.setName || geminiCard?.set_name || 'Pokémon TCG',
        number: details.number || detectedNumber,
        rarity: geminiCard?.rarity || details.rarity,
        language: (row.language || geminiCard?.language || 'EN').toUpperCase(),
        seller_country: row.seller_country || 'DE',
        condition: row.condition || 'NM',
        price_trend: basePrice,
        price_psa10: basePrice ? Number((basePrice * 11.5).toFixed(2)) : null,
        price_psa9: basePrice ? Number((basePrice * 4.2).toFixed(2)) : null,
        match_score: candidateMap.size === 0 ? 99 : Math.max(50, 60 - candidateMap.size * 5),
        image_url: img,
        cardmarket_url: row.card_id.startsWith('http') ? row.card_id : `https://www.cardmarket.com${row.card_id.startsWith('/') ? row.card_id : '/' + row.card_id}`,
        scanned_at: row.scanned_at,
        gemini_meta: geminiCard
      });

      if (candidateMap.size >= 5) break;
    }
  }

  // Process Additional Images from Supabase
  if (candidateMap.size < 5 && imageRows && imageRows.length > 0) {
    for (const imgRow of imageRows) {
      if (candidateMap.has(imgRow.card_id)) continue;

      const details = parseCardDetailsFromId(imgRow.card_id);
      candidateMap.set(imgRow.card_id, {
        id: `img_match_${candidateMap.size}_${Date.now()}`,
        card_id: imgRow.card_id,
        name: details.name || geminiCard?.card_name || 'Pokémon Karte',
        set_name: details.setName || geminiCard?.set_name || 'Pokémon Expansion',
        number: details.number || detectedNumber,
        rarity: geminiCard?.rarity || details.rarity,
        language: (geminiCard?.language || 'JP').toUpperCase(),
        seller_country: 'DE',
        condition: 'NM',
        price_trend: null,
        price_psa10: null,
        price_psa9: null,
        match_score: candidateMap.size === 0 ? 95 : 55,
        image_url: imgRow.image_url,
        cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(details.name || geminiCard?.card_name || '')}`,
        scanned_at: null,
        gemini_meta: geminiCard
      });

      if (candidateMap.size >= 5) break;
    }
  }

  // If Gemini found a card but Supabase had no matching row in local DB:
  if (candidateMap.size === 0 && geminiCard && geminiCard.card_name) {
    const displayName = geminiCard.card_name_de || geminiCard.card_name;
    const searchString = `${displayName} ${geminiCard.card_number || ''}`.trim();

    candidateMap.set('gemini_direct_match', {
      id: `ai_match_${Date.now()}`,
      card_id: `/Pokemon/Search/${encodeURIComponent(displayName)}`,
      name: displayName,
      set_name: geminiCard.set_name || 'Pokémon TCG',
      number: geminiCard.full_number_code || geminiCard.card_number || '',
      rarity: geminiCard.rarity || 'Special Rare',
      language: (geminiCard.language || 'JP').toUpperCase(),
      seller_country: 'DE',
      condition: 'NM',
      price_trend: null,
      price_psa10: null,
      price_psa9: null,
      match_score: 98,
      image_url: null,
      cardmarket_url: `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(searchString)}`,
      scanned_at: null,
      gemini_meta: geminiCard
    });
  }

  const candidates = Array.from(candidateMap.values());

  if (candidates.length > 0 && searchKey) {
    memoryCache.set(searchKey, candidates);
  }

  return candidates;
}
