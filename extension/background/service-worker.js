/**
 * Card Scanner+ Background Service Worker (Manifest V3)
 * Handles Tab Capture Fallback, Config Management & Cross-Origin Proxying
 */

const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:3001',
  hotkey: 's',
  currency: 'EUR',
  autoScan: false,
  cropRegion: 'bottom_half' // 'bottom_third', 'bottom_half', 'center', 'full'
};

// Initialize default settings on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get('config');
  if (!current.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
    console.log('[Card Scanner+] Initialized default configuration.');
  }
});

// Handle incoming messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case 'CAPTURE_TAB_FRAME': {
      // Pipeline B Fallback: Capture screen pixels directly via Chrome API
      (async () => {
        try {
          const windowId = sender.tab ? sender.tab.windowId : undefined;
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
          sendResponse({ success: true, dataUrl });
        } catch (err) {
          console.error('[Card Scanner+] Tab capture error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep message channel open for async response
    }

    case 'GET_CONFIG': {
      (async () => {
        try {
          const { config = DEFAULT_CONFIG } = await chrome.storage.local.get('config');
          sendResponse({ success: true, config: { ...DEFAULT_CONFIG, ...config } });
        } catch (err) {
          sendResponse({ success: false, config: DEFAULT_CONFIG });
        }
      })();
      return true;
    }

    case 'SET_CONFIG': {
      (async () => {
        try {
          const { config: existing = DEFAULT_CONFIG } = await chrome.storage.local.get('config');
          const updated = { ...existing, ...message.config };
          await chrome.storage.local.set({ config: updated });
          sendResponse({ success: true, config: updated });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'FETCH_API': {
      // Optional Proxy fetch in background if content script faces CORS restrictions
      (async () => {
        try {
          const { url, options } = message;
          const response = await fetch(url, options);
          const data = await response.json();
          sendResponse({ success: response.ok, status: response.status, data });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    default:
      return false;
  }
});
