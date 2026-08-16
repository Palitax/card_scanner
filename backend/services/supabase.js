/**
 * Supabase Service for Card Scanner+
 * Connects directly to https://api-supabase.rohdedigital.de
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

/**
 * Executes a Supabase REST query with timeout
 */
async function supabaseFetch(endpoint, queryParams = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(6000)
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`[Supabase Fetch Warning] ${endpoint}: ${res.status}`, errorText);
    return [];
  }

  return await res.json();
}

/**
 * Searches price_history table for matching card entries
 */
export async function searchPriceHistory(searchPatterns = []) {
  if (!searchPatterns || searchPatterns.length === 0) return [];

  const results = [];
  const seenCardIds = new Set();

  for (const term of searchPatterns) {
    if (!term || term.length < 2) continue;
    const sanitized = term.replace(/[\/\\%_]/g, '');
    const encodedTerm = encodeURIComponent(`%${term}%`);
    const encodedSanitized = encodeURIComponent(`%${sanitized}%`);

    try {
      const query = {
        select: 'card_id,price,condition,seller_country,language,comment,scanned_at',
        or: `(card_id.ilike.${encodedTerm},comment.ilike.${encodedTerm},card_id.ilike.${encodedSanitized},comment.ilike.${encodedSanitized})`,
        order: 'scanned_at.desc',
        limit: '15'
      };

      const rows = await supabaseFetch('price_history', query);
      if (rows && rows.length > 0) {
        for (const row of rows) {
          if (!seenCardIds.has(row.card_id)) {
            seenCardIds.add(row.card_id);
            results.push(row);
          }
        }
      }

      if (results.length >= 5) break;
    } catch (err) {
      console.warn(`[Supabase Service] Search error for term '${term}':`, err.message);
    }
  }

  return results;
}

/**
 * Fetches card images from card_images table for a list of card_ids
 */
export async function fetchCardImages(cardIds = []) {
  if (!cardIds || cardIds.length === 0) return {};

  const imageMap = {};
  const cleanedIds = Array.from(new Set(cardIds.map(id => id.replace(/^\/+/, ''))));

  for (let i = 0; i < cleanedIds.length; i += 10) {
    const chunk = cleanedIds.slice(i, i + 10);
    try {
      const formattedList = chunk.map(id => `"${id.replace(/"/g, '""')}"`).join(',');
      const query = {
        select: 'card_id,image_url',
        card_id: `in.(${encodeURIComponent(formattedList)})`,
        limit: '10'
      };

      const rows = await supabaseFetch('card_images', query);
      if (rows && rows.length > 0) {
        for (const r of rows) {
          if (r.card_id && r.image_url) {
            imageMap[r.card_id] = r.image_url;
            imageMap[r.card_id.replace(/^\/+/, '')] = r.image_url;
          }
        }
      }
    } catch (err) {
      console.warn('[Supabase Service] Image fetch error:', err.message);
    }
  }

  return imageMap;
}

/**
 * Formats a raw Cardmarket card_id path into clean Card Name, Set Name, and Number
 */
export function parseCardDetailsFromId(cardId) {
  if (!cardId || typeof cardId !== 'string') {
    return { name: 'Pokémon Karte', setName: 'Unbekanntes Set', number: '000', rarity: 'Rare' };
  }

  const clean = decodeURIComponent(cardId).replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);

  let setName = 'Pokémon Expansion';
  let cardPart = parts[parts.length - 1] || clean;

  if (parts.length >= 2) {
    const rawSet = parts[parts.length - 2];
    if (rawSet.toLowerCase() !== 'singles' && rawSet.toLowerCase() !== 'products') {
      setName = rawSet.replace(/[-_]/g, ' ').trim();
    }
  }

  // Extract name & number from filename/slug
  let name = cardPart.replace(/[-_]/g, ' ').trim();
  
  // Extract number (e.g. 216 or 025 or TG04)
  const numMatch = name.match(/(\b\d{1,3}\b|\bTG\d{1,2}\b|\bGG\d{1,2}\b|\bSVP\s*\d{1,3}\b)/i);
  const number = numMatch ? numMatch[1] : '';

  // Extract rarity clues
  let rarity = 'Ultra Rare';
  if (name.includes('SIR') || name.includes('Special Illustration')) rarity = 'SIR';
  else if (name.includes('UR') || name.includes('Ultra Rare')) rarity = 'UR';
  else if (name.includes('RR') || name.includes('Double Rare')) rarity = 'RR';
  else if (name.includes('Holo')) rarity = 'Holo Rare';

  // Clean title
  name = name.replace(/\s+(V\d+|RR|UR|SIR|AR|Holo|Non-Holo|\d{1,3})\b/gi, '').trim();

  return {
    name: name || 'Pokémon Karte',
    setName: setName,
    number: number,
    rarity: rarity
  };
}
