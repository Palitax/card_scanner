/**
 * Gemini Flash Vision Service for Card Scanner+
 * High-speed multimodal AI card recognition with robust schema normalization
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const CARD_PROMPT = `
You are an expert Pokemon and Trading Card Game identifier.
Analyze this card shown in the livestream frame.
Identify the exact card (e.g. "Mew V", "Iron Treads ex", "Primarina", "Charizard", "Venonat", "Medicham"), even if in German, Japanese, or English.

Return a JSON object with this schema:
{
  "name": string (Card name, e.g. "Mew V", "Eisenrad ex", "Venonat"),
  "name_de": string or null (German name if printed in German),
  "set_name": string (Set or expansion, e.g. "Fusion Strike", "Scarlet & Violet", "Jungle", "Mask of Change"),
  "number": string (Card number, e.g. "069/264", "066/198", "63/64", "120/101"),
  "rarity": string (e.g. "Ultra Rare", "Double Rare", "Art Rare", "Common", "Holo"),
  "language": string ("DE", "EN", "JP", "FR"),
  "hp": string or null (e.g. "180", "220", "70")
}

If no trading card is visible at all, return: { "name": null }
`;

/**
 * Normalizes any JSON shape from Gemini into consistent fields
 */
function normalizeGeminiCard(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = raw.name_de || raw.card_name_de || raw.name || raw.card_name || raw.cardName || raw.pokemon_name || raw.pokemon || raw.title || null;
  if (!name || name === 'null' || name.toLowerCase() === 'none') return null;

  const number = raw.number || raw.card_number || raw.cardNumber || raw.full_number_code || raw.card_code || '';
  const setName = raw.set_name || raw.setName || raw.set || raw.expansion || 'Pokémon TCG';
  const rarity = raw.rarity || raw.rarity_name || 'Ultra Rare';
  const language = (raw.language || 'DE').toUpperCase();
  const hp = raw.hp || null;

  return {
    card_name: name,
    card_name_de: raw.name_de || raw.card_name_de || name,
    card_name_en: raw.name_en || raw.card_name || name,
    set_name: setName,
    card_number: number,
    full_number_code: number,
    rarity: rarity,
    language: language,
    hp: hp
  };
}

/**
 * Identifies a card from a Base64 image using Gemini Flash
 */
export async function identifyCardWithGemini(imageBase64, customApiKey = "") {
  const apiKey = (customApiKey || GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    console.warn('[Gemini Vision] No GEMINI_API_KEY available.');
    return { error: 'NO_API_KEY', message: 'Bitte Gemini API Key im Overlay eintragen.' };
  }

  if (!imageBase64) {
    return { error: 'NO_IMAGE', message: 'Kein Bild empfangen.' };
  }

  let cleanBase64 = imageBase64;
  let mimeType = "image/jpeg";

  if (imageBase64.startsWith("data:")) {
    const parts = imageBase64.split(",");
    const match = parts[0].match(/data:(.*?);base64/);
    if (match) mimeType = match[1];
    cleanBase64 = parts[1] || "";
  }

  const modelsToTry = [GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

  const payload = {
    contents: [
      {
        parts: [
          { text: CARD_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0.1,
      max_output_tokens: 600
    }
  };

  const startTime = performance.now();

  for (const model of uniqueModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(9000)
      });

      const duration = Math.round(performance.now() - startTime);

      if (!res.ok) {
        const errText = await res.text();
        let parsedErr = errText;
        try {
          const jsonErr = JSON.parse(errText);
          parsedErr = jsonErr.error?.message || errText;
        } catch (e) {}

        if (res.status === 404 && model !== uniqueModels[uniqueModels.length - 1]) {
          continue;
        }

        console.error(`[Gemini Vision Error ${res.status}] (${duration}ms):`, parsedErr);
        return { error: `HTTP_${res.status}`, message: parsedErr };
      }

      const data = await res.json();
      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText) {
        console.warn(`[Gemini Vision] Empty response (${duration}ms)`);
        return { error: 'EMPTY_RESPONSE', message: 'Keine Antwort vom KI-Modell erhalten.' };
      }

      const parsedJson = JSON.parse(candidateText);
      const normalized = normalizeGeminiCard(parsedJson);

      console.log(`[Gemini Vision] ✓ Identified in ${duration}ms using ${model}:`, normalized);
      return { data: normalized };
    } catch (err) {
      console.error(`[Gemini Vision Exception with ${model}]:`, err.message);
      if (model === uniqueModels[uniqueModels.length - 1]) {
        return { error: 'EXCEPTION', message: err.message };
      }
    }
  }

  return { error: 'ALL_MODELS_FAILED', message: 'Kein Gemini-Modell konnte erreicht werden.' };
}
