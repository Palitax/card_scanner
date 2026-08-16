# ⚡ Card Scanner+ (Whatnot Pokémon Stream Scanner)

Die **Card Scanner+** Chrome Extension (Manifest V3) erkennt in Echtzeit Pokémon-Karten in Whatnot-Livestreams via lokaler Offline-OCR (Tesseract WASM) und ruft Cardmarket-Marktdaten (€ Trend, Min DE, Min EU, PSA 9/10 Schätzungen) aus deiner Supabase-Datenbank ab.

---

## 📁 Projektstruktur

```
Card Scanner+/
├── extension/                      # Chrome Extension (Manifest V3)
│   ├── manifest.json               # MV3 Spezifikation & Berechtigungen
│   ├── rules.json                  # DeclarativeNetRequest Header-Regeln (S3 Referer)
│   ├── background/
│   │   └── service-worker.js       # CORS-sicheres Tab-Capture Fallback & Config
│   ├── content/
│   │   ├── content.js              # Stream-Detector, Hotkey ('S') & Frame-Grabber
│   │   ├── ocr-engine.js           # Offline Tesseract WASM + Pokémon Regex Parser
│   │   ├── overlay.js              # Isoliertes Shadow DOM Overlay (cmlens-root)
│   │   └── overlay.css             # Stream-optimiertes Dark Theme UI
│   ├── lib/
│   │   └── tesseract/              # Lokale Tesseract.js WASM & Language Assets
│   ├── icons/                      # Extension Icons (16px, 48px, 128px)
│   └── popup/                      # Einstellungs-Popup (Backend-URL, Hotkey, Währung)
│
├── backend/                        # Backend API (Node.js & Vercel Serverless)
│   ├── api/
│   │   ├── search-candidates.js    # POST /api/search-candidates (Vercel Serverless)
│   │   ├── card-details.js         # GET /api/card-details
│   │   └── health.js               # GET /api/health
│   ├── services/
│   │   ├── supabase.js             # Supabase Client (api-supabase.rohdedigital.de)
│   │   ├── card-matcher.js         # Kandidaten-Zuordnung & Preisberechnung
│   │   └── cache.js                # L1 In-Memory Cache (<3ms Response)
│   ├── server.js                   # Lokaler Node.js Server (Port 3001)
│   ├── vercel.json                 # Vercel Deployment Konfiguration
│   └── .env.example                # Supabase Konfigurationsvorlage
│
├── VERCEL_DEPLOYMENT_GUIDE.md      # Schritt-für-Schritt Vercel Hosting Guide
└── README.md                       # Projektdokumentation
```

---

## 🛠️ Schnellstart (Lokal)

### 1. Lokales Backend starten
```bash
cd backend
node server.js
```
Der Server läuft unter `http://localhost:3001`.

### 2. Extension in Chrome laden
1. Öffne Google Chrome und gehe zu `chrome://extensions`.
2. Aktiviere oben rechts den **Entwicklermodus** (*Developer mode*).
3. Klicke auf **"Entpackte Erweiterung laden"** (*Load unpacked*).
4. Wähle den Ordner `extension/` in diesem Verzeichnis aus.

### 3. Whatnot Stream öffnen & Testen
1. Gehe auf einen beliebigen Pokémon-Livestream auf `https://www.whatnot.com/live/...`.
2. Das **Card Scanner+** Overlay erscheint am linken Bildschirmrand.
3. Drücke **`S`** (oder klicke auf *Capture*), wenn eine Karte gezeigt wird.
4. Das System binarisiert den Frame, liest die Set-Nummer per OCR aus und liefert die passenden Cardmarket-Preise und Varianten!

---

## 🌐 Vercel Cloud Hosting
Eine detaillierte Anleitung zum Deployment auf Vercel findest du in:
👉 [VERCEL_DEPLOYMENT_GUIDE.md](file:///Users/levinrohde/Desktop/_projects/Card%20Scanner+/VERCEL_DEPLOYMENT_GUIDE.md)
