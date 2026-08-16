/**
 * Card Scanner+ OCR Engine
 * Uses pre-warmed local Tesseract.js (Offline WASM) with specialized Pokémon Regex & Typo Correction
 */

class CardScannerOCREngine {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
    this.ready = false;
    this.initPromise = null;
  }

  /**
   * Pre-warms the Tesseract WASM worker in background
   */
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

        await this.worker.setParameters({
          tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- #.',
          tessedit_pageseg_mode: '11' // Sparse text with OSD (better for card layout)
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
   * Performs OCR recognition on a canvas or image source
   */
  async recognize(imageSource) {
    if (!this.ready) {
      await this.init();
    }

    if (!this.worker) {
      throw new Error('OCR Worker not available');
    }

    const startTime = performance.now();
    const result = await this.worker.recognize(imageSource);
    const duration = Math.round(performance.now() - startTime);
    
    const rawText = (result && result.data && result.data.text) ? result.data.text : '';
    const confidence = (result && result.data && result.data.confidence) ? result.data.confidence : 0;
    
    console.log(`[Card Scanner+ OCR] Scanned in ${duration}ms (Confidence: ${confidence}%). Raw Text: "${rawText.trim().replace(/\n+/g, ' ')}"`);

    const parsed = this.parseText(rawText);
    return {
      rawText: rawText.trim(),
      parsed: parsed,
      durationMs: duration,
      confidence: confidence
    };
  }

  /**
   * Normalizes OCR text and applies Regex for Pokémon card numbering
   */
  parseText(text) {
    if (!text || typeof text !== 'string') return null;

    let normalized = text.toUpperCase();
    
    // Normalize slashes: replace 'I', '|', '\', 'l' between numbers with '/'
    normalized = normalized.replace(/(\d+)\s*[I|\\l]\s*(\d+)/g, '$1/$2');
    normalized = normalized.replace(/(\b\w+)\s*[I|\\l]\s*(\d{2,3}\b)/g, '$1/$2');
    
    // Normalize 'O' or 'D' as '0' when directly part of number sequences
    normalized = normalized.replace(/\bO(\d+)/g, '0$1');
    normalized = normalized.replace(/(\d+)O\b/g, '$10');
    normalized = normalized.replace(/(\d+)\s*[\/]\s*O(\d+)/g, '$1/0$2');
    normalized = normalized.replace(/O(\d+)\s*[\/]\s*(\d+)/g, '0$1/$2');
    normalized = normalized.replace(/(\d+)B(\d+)/g, '$18$2');

    // 1. Japanese / Modern Set Code + Number: e.g. sv4K 073/066, sv2a 170/165, sv3 114, s9a 073, s12a 210
    const jpSetMatch = normalized.match(/\b(SV\d+[A-Z]?|S\d+[A-Z]?|SM\d+[A-Z]?|XY\d+[A-Z]?|CSM\d+[A-Z]?|MEW|OBF|PAR|TEF|TWM|SCR|SSP|PRE)\s*[-]?\s*(\d{1,3})\s*(?:[\/\\]\s*(\d{1,3}))?\b/i);
    if (jpSetMatch) {
      const setCode = jpSetMatch[1].toUpperCase();
      const num = jpSetMatch[2].padStart(3, '0');
      const total = jpSetMatch[3] ? jpSetMatch[3].padStart(3, '0') : null;
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

    // 2. One Piece Card Game Code: OP07-073, EB01-012, ST01-001
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

    // 3. Trainer Gallery / Galarian Gallery: TG01/TG30, GG15/GG70
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

    // 4. Promos: SVP 001, SWSH 123, SM 45, PR-01
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

    // 5. Standard Set Numbering: e.g. 073/066, 025/165, 216/091, 151/165
    const standardMatch = normalized.match(/\b(\d{1,3})\s*[\/\\]\s*(\d{1,3})\b/);
    if (standardMatch) {
      const rawNum = standardMatch[1];
      const rawTotal = standardMatch[2];
      const paddedNum = rawTotal.length >= 3 ? rawNum.padStart(3, '0') : rawNum;
      const paddedTotal = rawTotal;

      return {
        type: 'standard',
        code: `${paddedNum}/${paddedTotal}`,
        number: paddedNum,
        total: paddedTotal,
        promoCode: null,
        confidence: 95
      };
    }

    // 6. Standalone 3-digit card number (e.g. 073 or 170 or 183)
    const threeDigitMatch = normalized.match(/\b(\d{3})\b/);
    if (threeDigitMatch) {
      return {
        type: 'number_only',
        code: threeDigitMatch[1],
        number: threeDigitMatch[1],
        total: null,
        promoCode: null,
        confidence: 70
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
