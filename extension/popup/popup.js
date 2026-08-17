/**
 * Popup Script for Card Scanner+
 * Settings management and backend connectivity check
 */

document.addEventListener('DOMContentLoaded', () => {
  const backendUrlInput = document.getElementById('backendUrl');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const hotkeySelect = document.getElementById('hotkey');
  const currencySelect = document.getElementById('currency');
  const btnSave = document.getElementById('btnSave');
  const btnTest = document.getElementById('btnTest');
  const statusBox = document.getElementById('statusBox');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  // 1. Load saved settings from chrome.storage.local
  chrome.storage.local.get(['backendUrl', 'geminiApiKey', 'hotkey', 'currency'], (data) => {
    backendUrlInput.value = data.backendUrl || 'https://cardscanner-nine.vercel.app';
    if (data.geminiApiKey) geminiApiKeyInput.value = data.geminiApiKey;
    if (data.hotkey) hotkeySelect.value = data.hotkey;
    if (data.currency) currencySelect.value = data.currency;
  });

  // 2. Save settings
  btnSave.addEventListener('click', () => {
    const backendUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
    const geminiApiKey = geminiApiKeyInput.value.trim();
    const hotkey = hotkeySelect.value;
    const currency = currencySelect.value;

    chrome.storage.local.set({
      backendUrl: backendUrl,
      geminiApiKey: geminiApiKey,
      hotkey: hotkey,
      currency: currency
    }, () => {
      showStatus('success', 'Einstellungen erfolgreich gespeichert!');
      setTimeout(() => {
        showStatus('ready', 'Bereit für Whatnot Livestreams');
      }, 2000);
    });
  });

  // 3. Test backend connection
  btnTest.addEventListener('click', async () => {
    const rawUrl = backendUrlInput.value.trim().replace(/\/+$/, '');
    if (!rawUrl) {
      showStatus('error', 'Bitte Backend-URL eingeben');
      return;
    }

    showStatus('loading', 'Prüfe Verbindung...');

    try {
      const res = await fetch(`${rawUrl}/api/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        showStatus('success', `Verbunden! (${data.service || 'Card Scanner+ API'})`);
      } else {
        showStatus('error', `Server antwortete mit Code ${res.status}`);
      }
    } catch (err) {
      showStatus('error', `Verbindungsfehler: ${err.message}`);
    }
  });

  function showStatus(type, message) {
    statusBox.className = 'status-box';
    statusDot.className = 'status-indicator';

    if (type === 'success') {
      statusBox.classList.add('status-success');
      statusDot.classList.add('status-dot-success');
    } else if (type === 'error') {
      statusBox.classList.add('status-error');
      statusDot.classList.add('status-dot-error');
    } else if (type === 'loading') {
      statusBox.classList.add('status-loading');
      statusDot.classList.add('status-dot-loading');
    }

    statusText.innerText = message;
  }
});
