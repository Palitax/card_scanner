/**
 * Gemini Flash Vision Service for Card Scanner+
 * High-speed multimodal AI card recognition (0.8s - 1.5s latency)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const CARD_PROMPT = `
Analyze this Trading Card (Pokemon TCG, One Piece Card Game, etc.) from the livestream image.
Extract all card details accurately, even if the card is in Japanese, German, or English, or held at an angle.

Return a JSON object with this exact schema:
{
  "card_name": string (e.g. "Larry's Staraptor" or "Noibat" or "Marill" or "Charizard ex"),
  "card_name_de": string or null (German name if known, e.g. "Aokis Staraptor"),
  "card_name_jp": string or null (Japanese name if known, e.g. "オンバット" or "マリル"),
  "set_name": string (e.g. "Ascended Heroes" or "Ancient Roar" or "Southern Islands" or "151"),
  "card_number": string (e.g. "249", "073", "025", "11", "170", "OP07-073"),
  "total_set_number": string or null (e.g. "217", "066", "165", "18"),
  "full_number_code": string (e.g. "249/217", "073/066", "sv4K 073/066", "11/18", "OP07-073"),
  "set_code": string or null (e.g. "sv4K", "sv2a", "sv3", "MEW", "OP07", "SI1"),
  "rarity": string (e.g. "Illustration Rare", "Art Rare", "Secret Rare", "Ultra Rare", "Holo", "Common"),
  "language": string ("EN", "JP", "DE", "FR", "ZH", "KO"),
  "hp": string or null (e.g. "150", "40", "330"),
  "illustrator": string or null (e.g. "Naoyo Kimura", "Ken Sugimori", "Aoki")
}

If no card is clearly visible in the image, return: { "card_name": null }
`;

/**
 * Identifies a card from a Base64 image using Gemini Flash
 * @param {string} imageBase64 - Raw base64 or data URL (e.g. "data:image/jpeg;base64,...")
 * @param {string} customApiKey - Optional user-provided API key
 * @returns {Promise<object|null>}
 */
export async function identifyCardWithGemini(imageBase64, customApiKey = "") {
  const apiKey = customApiKey || GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[Gemini Vision] No GEMINI_API_KEY provided in environment variables.');
    return null;
  }

  if (!imageBase64) {
    return null;
  }

  // Clean Base64 string
  let cleanBase64 = imageBase64;
  let mimeType = "image/jpeg";

  if (imageBase64.startsWith("data:")) {
    const parts = imageBase64.split(",");
    const match = parts[0].match(/data:(.*?);base64/);
    if (match) mimeType = match[1];
    cleanBase64 = parts[1] || "";
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

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
      max_output_tokens: 500
    }
  };

  const startTime = performance.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });

    const duration = Math.round(performance.now() - startTime);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Gemini Vision Error ${res.status}] (${duration}ms):`, errText);
      return null;
    }

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      console.warn(`[Gemini Vision] Empty response from model (${duration}ms)`);
      return null;
    }

    const parsedJson = JSON.parse(candidateText);
    console.log(`[Gemini Vision] ✓ Card identified in ${duration}ms:`, parsedJson);
    return parsedJson;
  } catch (err) {
    console.error("[Gemini Vision Exception]:", err.message);
    return null;
  }
}
