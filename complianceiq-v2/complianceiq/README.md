# ComplianceIQ — Live RBI/SEBI Feed

A real compliance intelligence tool that pulls **live circulars from RBI and SEBI** and lets your team ask AI questions about each one.

---

## What's in here

```
complianceiq/
├── server/          ← Node.js API (fetches live RBI/SEBI RSS feeds)
│   ├── index.js
│   └── package.json
└── frontend/
    └── index.html   ← The web app (works offline with demo data)
```

---

## Step 1 — Run locally (to test it works)

### Prerequisites
- [Node.js 18+](https://nodejs.org) installed

### Start the server
```bash
cd server
npm install
npm start
```
You should see: `ComplianceIQ API running on port 3001`

Test it: open http://localhost:3001/api/feed in your browser — you should see JSON with real RBI/SEBI items.

### Open the frontend
Just open `frontend/index.html` in your browser. The live dot in the header will turn **green** when it connects to your server.

---

## Step 2 — Deploy the server free (Render.com)

1. Create a free account at https://render.com
2. Click **New → Web Service**
3. Connect your GitHub repo (or upload the `server/` folder)
4. Set these options:
   - **Root directory**: `server`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
5. Click Deploy — Render gives you a URL like `https://complianceiq-api.onrender.com`

---

## Step 3 — Connect frontend to live server

In `frontend/index.html`, find this line near the top of the `<script>`:

```javascript
const API_URL = 'http://localhost:3001';
```

Change it to your Render URL:
```javascript
const API_URL = 'https://complianceiq-api.onrender.com';
```

---

## Step 4 — Host the frontend free (Netlify / GitHub Pages)

**Netlify (easiest):**
1. Go to https://netlify.com → drag and drop the `frontend/` folder
2. Done — you get a live URL like `https://complianceiq.netlify.app`

**GitHub Pages:**
1. Push `frontend/index.html` to a GitHub repo
2. Go to Settings → Pages → Deploy from branch → `main`

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/feed` | GET | Returns up to 60 latest circulars, cached 30 min |
| `/api/feed/refresh` | POST | Clears cache, forces live refetch |
| `/health` | GET | Health check |

---

## Live Sources

| Feed | URL |
|---|---|
| SEBI Circulars | https://www.sebi.gov.in/sebirss.xml |
| SEBI Press Releases | https://www.sebi.gov.in/sebi_data/rss/pressrelease.xml |
| RBI Press Releases | https://www.rbi.org.in/scripts/rss.aspx |
| RBI Circulars | https://rbidocs.rbi.org.in/rdocs/content/docs/CIRU.xml |

---

## Auto-tagged topics
The server automatically tags each circular: KYC, AML/CFT, SAR/STR, Basel III, Liquidity, PCA/NPA, Cybersecurity, Crypto/VDA, FEMA, Insider Trading, Monetary Policy, Payments, NBFC.

---

## Adding email alerts (next step)
Once deployed, you can add a daily cron job (free on Render) that checks for new circulars and emails your dad's team. Ask ComplianceIQ to build this next!
