/**
 * Card Scanner+ Background Service Worker (Manifest V3)
 * Handles Tab Capture Fallback, Config Management & Cross-Origin Proxying
 */

const DEFAULT_CONFIG = {
  backendUrl: 'https://cardscanner-nine.vercel.app',
  hotkey: 's',
  currency: 'EUR',
  geminiApiKey: '',
  autoScan: false
};

// Initialize default settings on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(['backendUrl', 'hotkey', 'currency', 'geminiApiKey']);
  if (!current.backendUrl) {
    await chrome.storage.local.set(DEFAULT_CONFIG);
    console.log('[Card Scanner+] Initialized default configuration.');
  }
});

// Handle incoming messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case 'CAPTURE_TAB_FRAME': {
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
      return true;
    }

    case 'GET_CONFIG': {
      (async () => {
        try {
          const stored = await chrome.storage.local.get(['backendUrl', 'hotkey', 'currency', 'geminiApiKey']);
          sendResponse({ success: true, config: { ...DEFAULT_CONFIG, ...stored } });
        } catch (err) {
          sendResponse({ success: false, config: DEFAULT_CONFIG });
        }
      })();
      return true;
    }

    case 'SET_CONFIG': {
      (async () => {
        try {
          await chrome.storage.local.set(message.config);
          sendResponse({ success: true, config: message.config });
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
