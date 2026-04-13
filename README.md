<div align="center">

```
  ██████╗ ██████╗ ███████╗███████╗███╗   ██╗
 ██╔════╝ ██╔══██╗██╔════╝██╔════╝████╗  ██║
 ██║  ███╗██████╔╝█████╗  █████╗  ██╔██╗ ██║
 ██║   ██║██╔══██╗██╔══╝  ██╔══╝  ██║╚██╗██║
 ╚██████╔╝██║  ██║███████╗███████╗██║ ╚████║
  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝
        P  U  L  S  E
```

**Green Energy Intelligence Dashboard**

*Real-time solar generation · Live equity markets · AI-powered news*

[![Live Demo](https://img.shields.io/badge/LIVE-greenpulse.netlify.app-00ff9d?style=for-the-badge&logo=netlify&logoColor=white)]([https://greenpulse.netlify.app](https://greennpulse.netlify.app/))
![React](https://img.shields.io/badge/React_18-61dafb?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite_5-646cff?style=for-the-badge&logo=vite&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-22d3ee?style=for-the-badge)
![Status](https://img.shields.io/badge/status-production-00ff9d?style=for-the-badge)

</div>

---

## What Is This

GreenPulse is an intelligence dashboard for the global green energy sector. It aggregates live data across three independent APIs: US solar generation from the EIA, real-time equity quotes from Finnhub, and green energy headlines from GNews and then renders them as interactive charts, maps, scorecards, and news feeds inside a fully client-side React application.

No backend. No database. No server. Just a single `App.jsx` pulling live data directly from public APIs, built and deployed entirely on free-tier infrastructure.

---

## The Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GreenPulse Client                    │
│                  (React 18 + Vite 5)                    │
├────────────────┬──────────────────┬─────────────────────┤
│   EIA API      │   Finnhub API    │    GNews API        │
│   Solar Gen    │   Equity Quotes  │    Live Headlines   │
│   (monthly)    │   (real-time)    │    (4 topics)       │
├────────────────┴──────────────────┴─────────────────────┤
│              Recharts Visualisation Layer               │
│   AreaChart · BarChart · LineChart · PieChart · Map     │
├─────────────────────────────────────────────────────────┤
│              localStorage Key Persistence               │
│         API keys survive sessions & refreshes           │
└─────────────────────────────────────────────────────────┘
```

The entire application is a **single file** — `src/App.jsx`.It contains all components, data fetching logic, static fallback datasets, and styling constants. No component library, CSS files or an external state manager. Every style is inline, every animation is a CSS keyframe, every layout is flexbox or CSS grid. Every block is written from scratch.

---

## Data Sources & Integration

### 🌞 EIA Open Data API
**What it provides:** Monthly US solar electricity generation figures, broken down by fuel type.

**How it's integrated:**
```javascript
const params = new URLSearchParams({
  frequency: "monthly",
  "data[0]": "generation",
  "facets[fueltypeid][]": "SUN",
  "sort[0][column]": "period",
  "sort[0][direction]": "desc",
  length: "12",
  "api_key": apiKey,
});
const url = `https://api.eia.gov/v2/electricity/electric-power-operational-data/data/?${params}`;
```

The bracket-style query parameters required special handling — naive template literals double-encoded the brackets and returned empty responses. The fix was switching to `URLSearchParams` which handles encoding correctly. Live data powers the Solar section and Overview charts. If the key is absent or the request fails, the dashboard silently falls back to 12 months of curated static data.

---

### 📈 Finnhub Stock API
**What it provides:** Real-time US equity quotes — current price, daily high/low, previous close, and calculated price change.

**Why Finnhub over alternatives:** Alpha Vantage's free tier allows 25 requests per day. GreenPulse loads 8 tickers simultaneously — that's the entire daily quota in a single page load. Finnhub's free tier allows 60 requests per **minute**, making it the only practical choice for a multi-ticker dashboard at zero cost.

**How it's integrated:**
```javascript
async function fetchFinnhub(ticker, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const q = await res.json();
  const change = q.c - q.pc;
  const pct = q.pc ? ((change / q.pc) * 100) : 0;
  return {
    price:  q.c.toFixed(2),
    change: (change >= 0 ? "+" : "") + change.toFixed(2),
    pct:    (pct   >= 0 ? "+" : "") + pct.toFixed(2),
    high:   q.h.toFixed(2),
    low:    q.l.toFixed(2),
  };
}
```

All 8 tickers fetch in parallel. If any single ticker fails, only that card shows an error — the rest render normally. Fallback mock quotes render for all tickers when no API key is configured.

**Tracked tickers:** `FSLR · ENPH · PLUG · BE · NEE · CSIQ · SEDG · ITM`

---

### 📰 GNews API
**What it provides:** Live news articles matching topic queries — filtered to English, sorted by recency and relavence. 

**Why GNews over RSS:** Three separate RSS feed proxies were attempted — `rss2json`, `corsproxy.io`, and `allorigins.win` — all of which proved inconsistent in production due to CORS policy changes, proxy rate limiting, and feed format inconsistencies across sources. GNews is a direct, stable REST API with 100 free requests per day and consistent JSON responses.

**How it's integrated:**
```javascript
const GNEWS_TOPICS = {
  solar:    { q: "solar energy" },
  hydrogen: { q: "green hydrogen energy" },
  markets:  { q: "clean energy stocks" },
  policy:   { q: "renewable energy policy" },
};

async function fetchGNews(topic, apiKey) {
  const q = encodeURIComponent(GNEWS_TOPICS[topic].q);
  const url = `https://gnews.io/api/v4/search?q=${q}&lang=en&max=10&apikey=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const json = await res.json();
  return json.articles.map(a => ({
    title:       a.title,
    link:        a.url,
    pubDate:     a.publishedAt,
    description: a.description,
    thumbnail:   a.image,
    source:      a.source?.name,
  }));
}
```

4 topic tabs: **Solar · Hydrogen · Markets · Policy**

---

## The Dashboard Sections

| Section | Data Source | Visualisation |
|---|---|---|
| **Overview** | EIA + static | 6 stat scorecards + area chart + bar chart |
| **Solar** | EIA (live) | Area chart, regional pie chart, player cards |
| **Hydrogen** | Static (curated) | Bar chart, cost curve, project pipeline table |
| **Markets** | Finnhub (live) | 8 ticker cards with expandable detail panel |
| **Map** | Static (curated) | Interactive SVG bubble map, toggle solar/H₂ |
| **News** | GNews (live) | Filterable article feed, 4 topic tabs |
| **Settings** | localStorage | API key management with live Test Connection |

---

## Design System

All design tokens live in a single constant `T`:

```javascript
const T = {
  bg:      "#050c18",  // deepest background
  surface: "#08111e",  // sidebar, topbar
  card:    "#0e1c2f",  // card backgrounds
  border:  "#162236",  // all borders
  green:   "#00ff9d",  // primary accent
  cyan:    "#22d3ee",  // secondary accent
  yellow:  "#fbbf24",  // warning / hydrogen
  purple:  "#a78bfa",  // news / GNews
  red:     "#f43f5e",  // errors / negative delta
};
```

Typography is a deliberate three-font stack:
- **Orbitron** — display headers, brand name, section titles
- **IBM Plex Mono** — all data values, labels, timestamps, code-like elements
- **IBM Plex Sans** — body text, descriptions, article content

All animations are pure CSS keyframes — `fadeUp`, `blink`, `spin`, `pulse`, `shimmer` — applied via class names. No animation library.

---

## Key Engineering Decisions

**Why a single file?**
Keeping everything in `App.jsx` makes the project trivially portable. One file = one copy = immediately runnable anywhere. No imports to resolve, no component tree to navigate.

**Why localStorage over sessionStorage?**
`sessionStorage` clears on tab close. `localStorage` persists indefinitely. API keys entered once should never need re-entering — particularly important for a dashboard that users bookmark and return to daily.

**Why Vite 5 over Vite 6?**
Vite 6 requires Node.js 20.19+. This project was developed and tested on Node.js 18.20.4 on Windows 8 — a constrained environment that reflects real-world deployment scenarios outside controlled dev setups. Vite 5 is fully compatible and produces identical output.

**Why fallback data?**
A dashboard that shows a blank screen when an API key is missing is a bad dashboard. Every data section has a carefully curated static fallback so the UI always renders meaningfully — communicating what live data would look like and prompting the user to configure their keys.

**Why inline styles over CSS classes?**
Co-locating styles with components eliminates the cognitive overhead of context-switching between files. Every component is visually self-contained and can be read top to bottom without jumping to a stylesheet.

---

## Getting Started

### Prerequisites
- Node.js v18 or higher
- Free API keys from:
  - [EIA](https://www.eia.gov/opendata/register.php) — instant approval, no cost
  - [Finnhub](https://finnhub.io/register) — instant, 60 req/min free
  - [GNews](https://gnews.io) — instant, 100 req/day free

### Installation

```bash
# Clone
git clone https://github.com/achicodess/greenpulse.git
cd greenpulse

# Install dependencies
npm install
npm install recharts

# Start dev server
npm run dev
```

Visit `http://localhost:5173`

### Activate Live Data
1. Open the dashboard → click **Settings** in the sidebar
2. Paste each API key → click **Test Connection** → verify ✓
3. Click **Save Keys** — persists via `localStorage` permanently

---

## Project Structure

```
greenpulse/
├── src/
│   ├── App.jsx        # Entire application — ~1,100 lines
│   └── main.jsx       # React entry point
├── public/
│   └── AI_Diligence_Statement_GreenPulse.pdf
├── index.html
├── vite.config.js
└── package.json
```

---

## Deployment

Deployed on **Netlify** and **Vercel** via GitHub integration. Every `git push` to `main` triggers an automatic redeploy in ~45 seconds or a minute. 

```bash
# Production build
npm run build
# Output: dist/ — deploy to any static host
```

Compatible with Netlify, Vercel, GitHub Pages, Cloudflare Pages.

---

## AI Diligence

This project was built in collaboration with Artificial Intelligence Systems. The [full AI Diligence Statement](https://github.com/achicodess/greenpulse/raw/main/public/AI_Diligence_Statement_GreenPulse.pdf) documents exactly how AI was used, how every output was reviewed, and who is responsible for the final product.

All decisions — architectural, aesthetic, and editorial — were made and approved by the project author. The AI was a tool. The project is the author's.

---

## License

MIT — fork it, adapt it, build on it.

---

<div align="center">
<sub>Built with obsessive attention to detail · Deployed on free-tier infrastructure · Powered by open data</sub>
</div>
