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
        
        // Ensure Tesseract library is loaded
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
          gzip: true,
          logger: (m) => {
            if (m.status === 'recognizing text') {
              // OCR progress
            }
          }
        });

        // Set OCR parameters optimized for Pokémon set numbers
        await this.worker.setParameters({
          tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ- ',
          tessedit_pageseg_mode: '6' // Assume uniform block of text
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
   * @param {HTMLCanvasElement|ImageData|string} imageSource
   * @returns {Promise<{ rawText: string, candidates: Array, confidence: number }>}
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
    
    console.log(`[Card Scanner+ OCR] Scanned in ${duration}ms (Confidence: ${confidence}%). Raw Text: "${rawText.trim()}"`);

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

    // 1. Clean and normalize common OCR confusions
    let normalized = text.toUpperCase();
    
    // Normalize slashes: replace 'I', '|', '\', 'l' between numbers with '/'
    normalized = normalized.replace(/(\d+)\s*[I|\\l]\s*(\d+)/g, '$1/$2');
    
    // Normalize 'O' or 'D' as '0' when directly part of number sequences
    normalized = normalized.replace(/\bO(\d+)/g, '0$1');
    normalized = normalized.replace(/(\d+)O\b/g, '$10');
    normalized = normalized.replace(/(\d+)\s*[\/]\s*O(\d+)/g, '$1/0$2');
    normalized = normalized.replace(/O(\d+)\s*[\/]\s*(\d+)/g, '0$1/$2');
    
    // Replace 'B' as '8' if between digits
    normalized = normalized.replace(/(\d+)B(\d+)/g, '$18$2');

    // 2. Pattern Matching in order of specificity

    // A. Trainer Gallery / Galarian Gallery: TG01/TG30, GG15/GG70, TG04/30
    const galleryMatch = normalized.match(/\b(TG|GG)\s*[-]?\s*(\d{1,2})\s*[\/\\]\s*(TG|GG)?\s*(\d{1,2})\b/i);
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

    // B. Promos: SVP 001, SWSH 123, SM 45, PR-01, SV01-002, etc.
    const promoMatch = normalized.match(/\b(SVP|SWSH|SM|XY|BW|PR|SV\d{2}|PAL|OBF|PAR|TEF|TWM|SFA|SCR|SSP|PRE)\s*[-]?\s*(\d{1,3})\b/i);
    if (promoMatch) {
      const prefix = promoMatch[1].toUpperCase();
      const num = promoMatch[2].padStart(3, '0');
      return {
        type: 'promo',
        code: `${prefix}-${num}`,
        number: num,
        total: null,
        promoCode: prefix,
        confidence: 90
      };
    }

    // C. Standard Set Numbering: e.g. 025/165, 216/091, 151/165, 4/102
    const standardMatch = normalized.match(/\b(\d{1,3})\s*[\/\\]\s*(\d{1,3})\b/);
    if (standardMatch) {
      const rawNum = standardMatch[1];
      const rawTotal = standardMatch[2];
      
      // Pad to standard 3 digits if total is 3 digits
      const paddedNum = rawTotal.length >= 3 ? rawNum.padStart(3, '0') : rawNum;
      const paddedTotal = rawTotal;

      return {
        type: 'standard',
        code: `${paddedNum}/${paddedTotal}`,
        number: paddedNum,
        total: paddedTotal,
        promoCode: null,
        confidence: 98
      };
    }

    // D. Japanese Set Numbering / Single Number with Set Prefix: e.g. 025/071
    const jpMatch = normalized.match(/\b(\d{3})\s*[\/\\]\s*(\d{2,3})\b/);
    if (jpMatch) {
      return {
        type: 'japanese',
        code: `${jpMatch[1]}/${jpMatch[2]}`,
        number: jpMatch[1],
        total: jpMatch[2],
        promoCode: null,
        confidence: 90
      };
    }

    // E. Fallback: Standalone number 2-3 digits (e.g. Vintage 4 or 025)
    const fallbackMatch = normalized.match(/\b(\d{2,3})\b/);
    if (fallbackMatch) {
      return {
        type: 'fallback',
        code: fallbackMatch[1],
        number: fallbackMatch[1],
        total: null,
        promoCode: null,
        confidence: 60
      };
    }

    return null;
  }

  /**
   * Terminate worker on unload to free memory
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
      this.initPromise = null;
    }
  }
}

// Attach singleton to window
window.cardScannerOCR = new CardScannerOCREngine();
