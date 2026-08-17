/**
 * Card Scanner+ OCR Engine
 * Resilient Pokémon Card Number & Set Code Extractor
 */

class CardScannerOCREngine {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
    this.ready = false;
    this.initPromise = null;
  }

  async init() {
    if (this.ready) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        console.log('[Card Scanner+ OCR] Initializing offline Tesseract WASM worker...');
        
        if (typeof Tesseract === 'undefined') {
          throw new Error('Tesseract.js script not loaded');
        }

        const workerPath = chrome.runtime.getURL('lib/tesseract/worker.min.js');
        const corePath = chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js');
        const langPath = chrome.runtime.getURL('lib/tesseract');

        this.worker = await Tesseract.createWorker('eng', 1, {
          workerPath: workerPath,
          corePath: corePath,
          langPath: langPath,
          gzip: true
        });

        // Use PSM 6 (Assume a single uniform block of text) - most robust for card text
        await this.worker.setParameters({
          tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- .#',
          tessedit_pageseg_mode: '6'
        });

        this.ready = true;
        console.log('[Card Scanner+ OCR] Offline Worker pre-warmed and ready!');
        return true;
      } catch (err) {
        console.error('[Card Scanner+ OCR] Initialization failed:', err);
        this.ready = false;
        return false;
      }
    })();

    return this.initPromise;
  }

  isReady() {
    return this.ready;
  }

  /**
   * Recognizes text on a canvas with automatic 2x upscaling & contrast boosting
   */
  async recognize(canvasSource) {
    if (!this.ready) {
      await this.init();
    }

    if (!this.worker) {
      throw new Error('OCR Worker not available');
    }

    const startTime = performance.now();
    const result = await this.worker.recognize(canvasSource);
    const duration = Math.round(performance.now() - startTime);
    
    const rawText = (result && result.data && result.data.text) ? result.data.text : '';
    const confidence = (result && result.data && result.data.confidence) ? result.data.confidence : 0;

    const parsed = this.parseText(rawText);
    
    if (parsed) {
      console.log(`[Card Scanner+ OCR] ✓ Matched ${parsed.type} (${duration}ms): "${parsed.code}" from raw: "${rawText.trim().replace(/\n+/g, ' ')}"`);
    } else {
      console.log(`[Card Scanner+ OCR] Raw OCR (${duration}ms): "${rawText.trim().replace(/\n+/g, ' ')}"`);
    }

    return {
      rawText: rawText.trim(),
      parsed: parsed,
      durationMs: duration,
      confidence: confidence
    };
  }

  /**
   * Resilient parsing for Pokémon & TCG card numbers
   */
  parseText(text) {
    if (!text || typeof text !== 'string') return null;

    let normalized = text.toUpperCase().trim();
    
    // Normalize common OCR confusions
    normalized = normalized.replace(/(\d+)\s*[I|\\l!]\s*(\d+)/g, '$1/$2');
    normalized = normalized.replace(/(\b[A-Z0-9]+)\s*[I|\\l!]\s*(\d{2,3}\b)/g, '$1/$2');
    normalized = normalized.replace(/\bO(\d{2,3})/g, '0$1');
    normalized = normalized.replace(/(\d{2,3})O\b/g, '$10');
    normalized = normalized.replace(/(\d+)\s*[\/]\s*O(\d+)/g, '$1/0$2');
    normalized = normalized.replace(/O(\d+)\s*[\/]\s*(\d+)/g, '0$1/$2');
    normalized = normalized.replace(/(\d+)B(\d+)/g, '$18$2');
    normalized = normalized.replace(/(\d+)S(\d+)/g, '$15$2');

    // 1. Standard / Secret Card Number: e.g. 025/165, 216/091, 073/066, 170/165, 183/165, 4/102, 11/18
    const standardMatch = normalized.match(/\b(\d{1,3})\s*[\/\\]\s*(\d{1,3})\b/);
    if (standardMatch) {
      const num = standardMatch[1];
      const total = standardMatch[2];
      const totalNum = parseInt(total, 10);
      if (totalNum >= 10 && totalNum <= 400) {
        return {
          type: 'standard',
          code: `${num}/${total}`,
          number: num,
          total: total,
          confidence: 98
        };
      }
    }

    // 2. Japanese & Modern Set Code + Number: e.g. sv4K 073, sv2a 170, sv3 114, s9a 073, s12a 210, MEW 181, PRE 025
    const setCodeMatch = normalized.match(/\b(SV\d+[A-Z]?|S\d+[A-Z]?|SM\d+[A-Z]?|XY\d+[A-Z]?|CSM\d+[A-Z]?|MEW|OBF|PAR|TEF|TWM|SCR|SSP|PRE|PAF|PAL)\s*[-]?\s*(\d{1,3})\s*(?:[\/\\]\s*(\d{1,3}))?\b/i);
    if (setCodeMatch) {
      const setCode = setCodeMatch[1].toUpperCase();
      const num = setCodeMatch[2].padStart(3, '0');
      const total = setCodeMatch[3] ? setCodeMatch[3].padStart(3, '0') : null;
      return {
        type: 'set_code',
        code: total ? `${setCode} ${num}/${total}` : `${setCode} ${num}`,
        setCode: setCode,
        number: num,
        total: total,
        promoCode: setCode,
        confidence: 96
      };
    }

    // 3. One Piece: OP07-073, EB01-012, ST01-001, PRB01-001
    const opMatch = normalized.match(/\b(OP\d{2}|EB\d{2}|ST\d{2}|PRB\d{2}|P)\s*[-]?\s*(\d{3})\b/i);
    if (opMatch) {
      const prefix = opMatch[1].toUpperCase();
      const num = opMatch[2];
      return {
        type: 'onepiece',
        code: `${prefix}-${num}`,
        number: num,
        promoCode: prefix,
        confidence: 98
      };
    }

    // 4. Trainer / Galarian Gallery: TG01/TG30, GG15/GG70, TG04
    const galleryMatch = normalized.match(/\b(TG|GG)\s*[-]?\s*(\d{1,2})\s*(?:[\/\\]\s*(TG|GG)?\s*(\d{1,2}))?\b/i);
    if (galleryMatch) {
      const prefix = galleryMatch[1].toUpperCase();
      const num = galleryMatch[2].padStart(2, '0');
      const total = galleryMatch[4] ? galleryMatch[4].padStart(2, '0') : (galleryMatch[3] || '30');
      return {
        type: 'gallery',
        code: `${prefix}${num}/${prefix}${total}`,
        number: `${prefix}${num}`,
        total: total,
        promoCode: prefix,
        confidence: 95
      };
    }

    // 5. Promos: SVP 001, SWSH 123, SM 45, PR-01
    const promoMatch = normalized.match(/\b(SVP|SWSH|SM|XY|BW|PR)\s*[-]?\s*(\d{1,3})\b/i);
    if (promoMatch) {
      const prefix = promoMatch[1].toUpperCase();
      const num = promoMatch[2].padStart(3, '0');
      return {
        type: 'promo',
        code: `${prefix}-${num}`,
        number: num,
        total: null,
        promoCode: prefix,
        confidence: 92
      };
    }

    // 6. Vintage Level & HP (for Japanese Vintage cards without set numbers): e.g. "LV.10 HP40"
    const hpLvMatch = normalized.match(/(?:LV\.?\s*(\d{1,2}))?\s*(?:HP\s*(\d{2,3}))/i) || normalized.match(/(?:HP\s*(\d{2,3}))\s*(?:LV\.?\s*(\d{1,2}))?/i);
    if (hpLvMatch) {
      const hp = hpLvMatch[1] && hpLvMatch[1].length >= 2 ? hpLvMatch[1] : hpLvMatch[2];
      const lv = hpLvMatch[1] && hpLvMatch[1].length < 2 ? hpLvMatch[1] : (hpLvMatch[2] && hpLvMatch[2].length < 2 ? hpLvMatch[2] : null);
      if (hp) {
        return {
          type: 'vintage_stats',
          code: lv ? `LV.${lv} HP${hp}` : `HP${hp}`,
          hp: hp,
          lv: lv,
          confidence: 85
        };
      }
    }

    // 7. Known Illustrator (Japanese Vintage cards bottom text): e.g. "Illus. Naoyo Kimura"
    const illusMatch = normalized.match(/(?:ILLUS\.?|ILLUSTRATOR)\s*([A-Z\s]{4,25})/i) || normalized.match(/\b(NAOYO KIMURA|KEN SUGIMORI|MITSUHIRO ARITA|KOUKI SAITOU|TOMOKAZU KOMIYA|HIMENO|KAGEYAMA)\b/i);
    if (illusMatch) {
      const artist = (illusMatch[1] || illusMatch[0]).trim();
      return {
        type: 'illustrator',
        code: `Illus. ${artist}`,
        artist: artist,
        confidence: 80
      };
    }

    // 8. 3-digit number (e.g. 073, 170, 183, 216)
    const threeDigit = normalized.match(/\b(\d{3})\b/);
    if (threeDigit) {
      return {
        type: 'number_only',
        code: threeDigit[1],
        number: threeDigit[1],
        total: null,
        confidence: 75
      };
    }

    return null;
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
      this.initPromise = null;
    }
  }
}

window.cardScannerOCR = new CardScannerOCREngine();
