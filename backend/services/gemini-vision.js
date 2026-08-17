/**
 * Gemini Flash Vision Service for Card Scanner+
 * High-speed multimodal AI card recognition
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const CARD_PROMPT = `
You are an expert Pokemon & Trading Card Game identifier.
Analyze this card shown in the livestream frame.
Identify the exact card, even if in German, Japanese, English, or partially obstructed.

Return a JSON object with this exact schema:
{
  "card_name": string (English name, e.g. "Chikorita", "Charizard ex", "Mewtwo"),
  "card_name_de": string or null (German name if printed in German, e.g. "Endivie", "Glurak"),
  "card_name_jp": string or null (Japanese name if printed in Japanese),
  "set_name": string (Set or expansion name, e.g. "Neo Genesis", "151", "Paldean Fates"),
  "card_number": string (e.g. "025", "073", "199", "54"),
  "total_set_number": string or null (e.g. "165", "066", "111"),
  "full_number_code": string (e.g. "025/165", "54/111", "sv4K 073/066"),
  "set_code": string or null (e.g. "MEW", "sv4K", "sv2a", "OP07"),
  "rarity": string (e.g. "Common", "Holo", "Illustration Rare", "Secret Rare"),
  "language": string ("DE", "EN", "JP", "FR"),
  "hp": string or null (e.g. "70", "150"),
  "attacks": array of strings or null
}

If no trading card is visible in the image, return: { "card_name": null }
`;

/**
 * Identifies a card from a Base64 image using Gemini Flash
 */
export async function identifyCardWithGemini(imageBase64, customApiKey = "") {
  const apiKey = (customApiKey || GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    console.warn('[Gemini Vision] No GEMINI_API_KEY available.');
    return { error: 'NO_API_KEY', message: 'Bitte Gemini API Key im Extension-Popup eintragen.' };
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

  // Try gemini-1.5-flash (most reliable and free)
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
      max_output_tokens: 600
    }
  };

  const startTime = performance.now();

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
    console.log(`[Gemini Vision] ✓ Identified in ${duration}ms:`, parsedJson);
    return { data: parsedJson };
  } catch (err) {
    console.error("[Gemini Vision Exception]:", err.message);
    return { error: 'EXCEPTION', message: err.message };
  }
}
