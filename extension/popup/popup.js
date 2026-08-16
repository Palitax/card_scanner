/**
 * Card Scanner+ Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const inpBackendUrl = document.getElementById('backendUrl');
  const selHotkey = document.getElementById('hotkey');
  const selCurrency = document.getElementById('currency');
  const btnSave = document.getElementById('btnSave');
  const btnTest = document.getElementById('btnTest');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  // Load existing config
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (res) => {
    if (res && res.success && res.config) {
      inpBackendUrl.value = res.config.backendUrl || 'http://localhost:3001';
      selHotkey.value = res.config.hotkey || 's';
      selCurrency.value = res.config.currency || 'EUR';
    }
  });

  // Save config
  btnSave.addEventListener('click', async () => {
    const config = {
      backendUrl: inpBackendUrl.value.trim() || 'http://localhost:3001',
      hotkey: selHotkey.value || 's',
      currency: selCurrency.value || 'EUR'
    };

    chrome.runtime.sendMessage({ action: 'SET_CONFIG', config }, (res) => {
      if (res && res.success) {
        statusDot.className = 'status-indicator';
        statusText.textContent = 'Gespeichert!';
        setTimeout(() => {
          statusText.textContent = 'Bereit';
        }, 2000);
      } else {
        statusDot.className = 'status-indicator error';
        statusText.textContent = 'Fehler beim Speichern';
      }
    });
  });

  // Test backend connection
  btnTest.addEventListener('click', async () => {
    const url = (inpBackendUrl.value.trim() || 'http://localhost:3001').replace(/\/+$/, '');
    statusText.textContent = 'Verbindung wird geprüft...';
    statusDot.className = 'status-indicator';

    try {
      const resp = await fetch(`${url}/api/health`);
      if (resp.ok) {
        const data = await resp.json();
        statusDot.className = 'status-indicator';
        statusText.textContent = `Verbunden! (${data.service || 'Backend OK'})`;
      } else {
        statusDot.className = 'status-indicator error';
        statusText.textContent = `HTTP Fehler: ${resp.status}`;
      }
    } catch (err) {
      statusDot.className = 'status-indicator error';
      statusText.textContent = 'Keine Verbindung zum Backend';
    }
  });
});
