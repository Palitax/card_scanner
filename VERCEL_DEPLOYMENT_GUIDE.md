# 🚀 Vercel Deployment Guide für Card Scanner+ Backend

Dieses Backend ist als **Serverless Functions** für Vercel optimiert (Zero-Cold-Start, Sub-15ms Response-Time, native Supabase-Integration).

---

## Option A: Deployment per Vercel CLI (Empfohlen & Schnellste Methode)

### 1. Vercel CLI installieren (falls nicht vorhanden)
```bash
npm install -g vercel
```

### 2. Im Backend-Ordner einloggen & deployen
Öffne dein Terminal und navigiere in den `backend`-Ordner:
```bash
cd "/Users/levinrohde/Desktop/_projects/Card Scanner+/backend"
vercel login
vercel
```

Folge den Eingabeaufforderungen:
- **Set up and deploy?** `Y`
- **Which scope?** Dein Vercel Account
- **Link to existing project?** `N`
- **What's your project's name?** `card-scanner-plus-api`
- **In which directory is your code located?** `./`

### 3. Umgebungsvariablen auf Vercel hinterlegen
Füge in Vercel (über das Dashboard oder CLI) folgende Environment Variables hinzu:
- `SUPABASE_URL`: `https://api-supabase.rohdedigital.de`
- `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk`

### 4. Production Release
```bash
vercel --prod
```
Du erhältst eine URL wie: `https://card-scanner-plus-api.vercel.app`.

---

## Option B: Deployment via GitHub

1. Erstelle ein neues Repository auf GitHub (oder pushe diesen Ordner in ein bestehendes Repo).
2. Gehe auf [vercel.com/new](https://vercel.com/new).
3. Wähle das Repository aus.
4. Setze das **Root Directory** auf `backend`.
5. Füge unter **Environment Variables** hinzu:
   - `SUPABASE_URL` = `https://api-supabase.rohdedigital.de`
   - `SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk`
6. Klicke auf **Deploy**.

---

## ⚡ Extension mit Vercel verbinden

1. Klicke in Chrome auf das **Card Scanner+** Extension-Icon in der Menüleiste.
2. Trage bei **Backend API Server** deine Vercel URL ein (z. B. `https://card-scanner-plus-api.vercel.app`).
3. Klicke auf **"Backend-Verbindung Prüfen"** -> Status wechselt auf *Verbunden!*.
4. Klicke auf **"Einstellungen Speichern"**.

Fertig! Die Extension nutzt nun dein cloud-gehostetes Vercel-Backend.
