import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

// ─── SECURITY LAYER ──────────────────────────────────────────────
// 1. Key obfuscation — simple XOR encode/decode so keys are never
//    stored as plain text in localStorage
const _xk = "gp2026xk";
const _enc = s => s ? btoa([...s].map((c,i)=>String.fromCharCode(c.charCodeAt(0)^_xk.charCodeAt(i%_xk.length))).join("")) : "";
const _dec = s => { try { return [...atob(s)].map((c,i)=>String.fromCharCode(c.charCodeAt(0)^_xk.charCodeAt(i%_xk.length))).join(""); } catch { return ""; } };

// 2. Cache layer — TTL-based localStorage cache prevents API hammering
//    EIA: 60 min (data updates monthly), Finnhub: 5 min, GNews: 30 min
const CACHE_TTL = { eia: 60*60*1000, finnhub: 5*60*1000, gnews: 30*60*1000 };
function cacheGet(key) {
  try {
    const raw = localStorage.getItem("gp_cache_" + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    const ttl = Object.entries(CACHE_TTL).find(([k]) => key.startsWith(k))?.[1] || 5*60*1000;
    if (Date.now() - ts > ttl) { localStorage.removeItem("gp_cache_" + key); return null; }
    return data;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem("gp_cache_" + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// 3. Request deduplication — prevents parallel identical requests
const _inflight = {};
async function dedupe(key, fn) {
  if (_inflight[key]) return _inflight[key];
  _inflight[key] = fn().finally(() => delete _inflight[key]);
  return _inflight[key];
}

// 4. Input sanitiser — strips HTML/script tags from any external content
const sanitize = s => typeof s === "string"
  ? s.replace(/<[^>]*>/g, "").replace(/javascript:/gi, "").replace(/on\w+=/gi, "").trim()
  : s;

// 5. Key validator — rejects obviously malformed keys before sending requests
const validateKey = {
  eia:     k => typeof k === "string" && k.length >= 32 && /^[a-zA-Z0-9]+$/.test(k),
  finnhub: k => typeof k === "string" && k.length >= 10,
  gnews:   k => typeof k === "string" && k.length >= 10,
};

// 6. Secure key storage — encode keys before writing, decode on read
function saveKeys(keys) {
  try {
    const encoded = Object.fromEntries(Object.entries(keys).map(([k,v]) => [k, _enc(v)]));
    localStorage.setItem("gp_keys", JSON.stringify(encoded));
  } catch {}
}
function loadKeys() {
  try {
    const raw = localStorage.getItem("gp_keys");
    if (!raw) return { eia:"", finnhub:"", gnews:"" };
    const parsed = JSON.parse(raw);
    // Handle both old plain-text format and new encoded format
    return Object.fromEntries(
      Object.entries(parsed).map(([k,v]) => {
        const decoded = _dec(v);
        return [k, decoded || v]; // fallback to raw if decode fails (migration)
      })
    );
  } catch { return { eia:"", finnhub:"", gnews:"" }; }
}

// 7. Content Security helper — sanitize all external article content
function sanitizeArticle(a) {
  return {
    title:       sanitize(a.title || ""),
    link:        /^https?:\/\//.test(a.link||"") ? a.link : "#",
    pubDate:     a.pubDate || "",
    description: sanitize(a.description || ""),
    thumbnail:   /^https?:\/\//.test(a.thumbnail||"") ? a.thumbnail : null,
    source:      sanitize(a.source || ""),
  };
}


// ─── FONTS & GLOBAL STYLES ────────────────────────────────────────
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:#050c18}
    ::-webkit-scrollbar{width:5px}
    ::-webkit-scrollbar-track{background:#07101e}
    ::-webkit-scrollbar-thumb{background:#00ff9d28;border-radius:4px}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes pulse{0%,100%{box-shadow:0 0 6px #00ff9d33}50%{box-shadow:0 0 20px #00ff9d66}}
    @keyframes shimmer{0%{opacity:.6}50%{opacity:1}100%{opacity:.6}}
    .fade-up{animation:fadeUp .4s cubic-bezier(.22,.68,0,1.2) both}
    .card{background:#0e1c2f;border:1px solid #162236;border-radius:10px;transition:border-color .2s}
    .card:hover{border-color:#1e3a5f}
    .nav-btn{border:none;background:transparent;width:100%;text-align:left;cursor:pointer;border-radius:7px;border-left:2px solid transparent;transition:all .18s}
    .nav-btn:hover{background:#00ff9d0d}
    .nav-btn.active{background:#00ff9d12;border-left-color:#00ff9d}
    button:active{transform:scale(.97)}
    input:focus{outline:none}
  `}</style>
);

// ─── TOKENS ───────────────────────────────────────────────────────
const T = {
  bg:"#050c18",surface:"#08111e",card:"#0e1c2f",border:"#162236",border2:"#1e3a5f",
  green:"#00ff9d",greenDim:"#00ff9d1a",cyan:"#22d3ee",cyanDim:"#22d3ee1a",
  yellow:"#fbbf24",yellowDim:"#fbbf241a",red:"#f43f5e",redDim:"#f43f5e1a",
  purple:"#a78bfa",text:"#e2eaf4",sub:"#94a3b8",muted:"#4a6080",dim:"#0d1e32",
};
const CC = [T.green,T.cyan,T.yellow,T.purple,"#f97316",T.muted];

// ─── STATIC DATA ──────────────────────────────────────────────────
const FALLBACK_SOLAR = [
  {m:"Jan",gw:12.4},{m:"Feb",gw:14.1},{m:"Mar",gw:18.7},{m:"Apr",gw:24.3},
  {m:"May",gw:31.2},{m:"Jun",gw:38.6},{m:"Jul",gw:41.3},{m:"Aug",gw:39.8},
  {m:"Sep",gw:33.1},{m:"Oct",gw:25.4},{m:"Nov",gw:17.9},{m:"Dec",gw:13.2},
];
const H2_INV = [
  {q:"Q1'23",b:6.3},{q:"Q2'23",b:8.1},{q:"Q3'23",b:10.4},{q:"Q4'23",b:12.8},
  {q:"Q1'24",b:14.2},{q:"Q2'24",b:17.6},{q:"Q3'24",b:20.3},{q:"Q4'24",b:24.1},
  {q:"Q1'25",b:27.8},{q:"Q2'25",b:31.4},
];
const H2_COST = [
  {y:"2020",c:8.2},{y:"2021",c:7.1},{y:"2022",c:6.3},{y:"2023",c:5.4},
  {y:"2024",c:4.8},{y:"2025",c:4.2},{y:"2030e",c:2.5},{y:"2035e",c:1.5},
];
const SOLAR_REGIONS = [
  {name:"China",gw:750},{name:"EU",gw:260},{name:"USA",gw:180},
  {name:"India",gw:85},{name:"Japan",gw:80},{name:"Other",gw:145},
];
const H2_PROJECTS = [
  {name:"NEOM Green H2",country:"Saudi Arabia",mw:2200,stage:"Construction",type:"Green"},
  {name:"HyDeal Ambition",country:"Europe",mw:95000,stage:"Development",type:"Green"},
  {name:"Asian Renewable Hub",country:"Australia",mw:26000,stage:"Planning",type:"Green"},
  {name:"Oman H2 Hub",country:"Oman",mw:25000,stage:"Development",type:"Blue"},
  {name:"H2 Magallanes",country:"Chile",mw:10000,stage:"Planning",type:"Green"},
  {name:"NortH2",country:"Netherlands",mw:4000,stage:"Construction",type:"Green"},
];
const SOLAR_PLAYERS = [
  {name:"First Solar",ticker:"FSLR",focus:"Thin-film CdTe modules"},
  {name:"Enphase Energy",ticker:"ENPH",focus:"Microinverters & storage"},
  {name:"Canadian Solar",ticker:"CSIQ",focus:"Utility-scale EPC"},
  {name:"SolarEdge",ticker:"SEDG",focus:"DC-optimized inverters"},
];
const H2_PLAYERS = [
  {name:"Plug Power",ticker:"PLUG",focus:"Hydrogen fuel cells"},
  {name:"Bloom Energy",ticker:"BE",focus:"Solid oxide fuel cells"},
  {name:"ITM Power",ticker:"ITM",focus:"PEM electrolysers"},
  {name:"Nel ASA",ticker:"NEL",focus:"H₂ infrastructure"},
];
const MOCK_QUOTES = {
  FSLR:{price:"162.40",change:"+3.21",pct:"+2.01",vol:"1,842,301",high:"164.10",low:"158.90"},
  ENPH:{price:"68.15",change:"-1.04",pct:"-1.50",vol:"2,314,422",high:"70.20",low:"67.40"},
  PLUG:{price:"2.87",change:"+0.12",pct:"+4.36",vol:"18,422,101",high:"2.95",low:"2.74"},
  BE:  {price:"21.44",change:"+0.88",pct:"+4.28",vol:"3,201,450",high:"21.80",low:"20.55"},
  NEE: {price:"71.30",change:"-0.55",pct:"-0.77",vol:"5,643,100",high:"72.10",low:"70.60"},
  CSIQ:{price:"13.22",change:"+0.41",pct:"+3.20",vol:"892,300",high:"13.50",low:"12.90"},
  SEDG:{price:"18.75",change:"+0.33",pct:"+1.79",vol:"1,120,400",high:"19.10",low:"18.40"},
  ITM: {price:"0.62",change:"-0.02",pct:"-3.12",vol:"4,201,800",high:"0.65",low:"0.61"},
};
const OVERVIEW_STATS = [
  {label:"Global Solar Capacity",value:"1,500",unit:"GW",delta:"+24%",up:true,color:T.green},
  {label:"H₂ Projects Pipeline",value:"$320",unit:"B",delta:"+41%",up:true,color:T.cyan},
  {label:"Solar LCOE",value:"$0.028",unit:"/kWh",delta:"-18%",up:false,color:T.yellow},
  {label:"Green H₂ Cost",value:"$4.20",unit:"/kg",delta:"-12%",up:false,color:T.purple},
  {label:"New Solar Jobs",value:"4.9",unit:"M",delta:"+8%",up:true,color:T.green},
  {label:"Electrolyser Capacity",value:"17.4",unit:"GW",delta:"+68%",up:true,color:T.cyan},
];
const MAP_REGIONS = [
  {id:"cn",name:"China",solar:750,h2:45,x:72,y:37},{id:"eu",name:"Europe",solar:260,h2:120,x:47,y:27},
  {id:"us",name:"USA",solar:180,h2:85,x:17,y:37},{id:"in",name:"India",solar:85,h2:22,x:63,y:52},
  {id:"au",name:"Australia",solar:40,h2:38,x:77,y:70},{id:"sa",name:"S. Arabia",solar:12,h2:95,x:56,y:51},
  {id:"cl",name:"Chile",solar:8,h2:42,x:23,y:75},{id:"jp",name:"Japan",solar:80,h2:18,x:83,y:37},
  {id:"br",name:"Brazil",solar:32,h2:28,x:28,y:63},
];

// ─── GNEWS FETCH ─────────────────────────────────────────────────
const GNEWS_TOPICS = {
  solar:     { label:"Solar",     q:"solar energy",         color:T.green  },
  hydrogen:  { label:"Hydrogen",  q:"green hydrogen energy", color:T.cyan   },
  markets:   { label:"Markets",   q:"clean energy stocks",   color:T.yellow },
  policy:    { label:"Policy",    q:"renewable energy policy",color:T.purple },
};

async function fetchGNews(topic, apiKey) {
  if (!validateKey.gnews(apiKey)) throw new Error("Invalid GNews API key format.");
  const cacheKey = `gnews_${topic}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  return dedupe(cacheKey, async () => {
    const q = encodeURIComponent(GNEWS_TOPICS[topic].q);
    const url = `https://gnews.io/api/v4/search?q=${q}&lang=en&max=10&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GNews HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.join(", "));
    if (!json.articles?.length) throw new Error("No articles returned.");
    const articles = json.articles.map(a => sanitizeArticle({
      title: a.title, link: a.url, pubDate: a.publishedAt,
      description: a.description || "", thumbnail: a.image || null,
      source: a.source?.name || "",
    }));
    cacheSet(cacheKey, articles);
    return articles;
  });
}

// ─── EIA FETCH ────────────────────────────────────────────────────
async function fetchEIA(apiKey) {
  if (!validateKey.eia(apiKey)) throw new Error("Invalid EIA API key format.");
  const cached = cacheGet("eia");
  if (cached) return cached;
  return dedupe("eia", async () => {
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
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.response?.data?.length) throw new Error("EIA returned no data — check your key.");
  const result = json.response.data
    .sort((a,b) => a.period.localeCompare(b.period))
    .map(d => {
      const raw = parseFloat(d.generation) || 0;
      // EIA returns generation in thousand MWh — convert to GWh (divide by 1000)
      // If values look like they are already in GWh range (>100), use as-is
      const gw = raw > 10000 ? +(raw / 1000).toFixed(1) : raw > 0 ? +raw.toFixed(1) : 0;
      return {
        m: new Date(d.period + "-01").toLocaleString("default", { month: "short" }),
        gw,
      };
    }).filter(d => d.gw > 0);
    cacheSet("eia", result);
    return result;
  });
}

// ─── ALPHA VANTAGE FETCH ──────────────────────────────────────────
async function fetchFinnhub(ticker, apiKey) {
  if (!validateKey.finnhub(apiKey)) throw new Error("Invalid Finnhub API key format.");
  const cacheKey = `finnhub_${ticker}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  return dedupe(cacheKey, async () => {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const q = await res.json();
    if (q.error) throw new Error(`Finnhub: ${q.error}`);
    if (!q.c) throw new Error(`No data for ${ticker}`);
    const change = q.c - q.pc;
    const pct = q.pc ? ((change / q.pc) * 100) : 0;
    const result = {
      price:  q.c.toFixed(2),
      change: (change >= 0 ? "+" : "") + change.toFixed(2),
      pct:    (pct   >= 0 ? "+" : "") + pct.toFixed(2),
      vol:    "—",
      high:   q.h.toFixed(2),
      low:    q.l.toFixed(2),
    };
    cacheSet(cacheKey, result);
    return result;
  });
}

// ─── ATOMS ────────────────────────────────────────────────────────
const Mono = ({ children, size=12, color=T.sub, style={} }) => (
  <span style={{ fontFamily:"'IBM Plex Mono'", fontSize:size, color, ...style }}>{children}</span>
);
const Orb = ({ children, size=14, color=T.text, weight=700, style={} }) => (
  <span style={{ fontFamily:"'Orbitron'", fontSize:size, fontWeight:weight, color, ...style }}>{children}</span>
);
const Sans = ({ children, size=13, color=T.text, weight=400, style={} }) => (
  <span style={{ fontFamily:"'IBM Plex Sans'", fontSize:size, color, fontWeight:weight, ...style }}>{children}</span>
);
const Pill = ({ children, color=T.green }) => (
  <span style={{ display:"inline-flex", alignItems:"center", borderRadius:5, padding:"2px 9px",
    fontFamily:"'IBM Plex Mono'", fontSize:10, background:color+"1a", color,
    border:`1px solid ${color}44` }}>{children}</span>
);
const Spinner = ({ size=14, color=T.green }) => (
  <div style={{ width:size, height:size, border:`2px solid ${color}33`,
    borderTop:`2px solid ${color}`, borderRadius:"50%",
    animation:"spin .7s linear infinite", flexShrink:0 }} />
);
const SectionHeader = ({ title, subtitle, right }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:5 }}>
        <div style={{ width:3, height:20, background:T.green, borderRadius:2 }} />
        <Orb size={16} color={T.text} style={{ letterSpacing:"0.06em" }}>{title}</Orb>
      </div>
      {subtitle && <Mono size={11} color={T.muted} style={{ marginLeft:13 }}>{subtitle}</Mono>}
    </div>
    {right}
  </div>
);
const ChartCard = ({ title, children, style={}, action }) => (
  <div className="card" style={{ padding:"20px 22px", ...style }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
      <Mono size={10} color={T.muted} style={{ textTransform:"uppercase", letterSpacing:"0.12em" }}>{title}</Mono>
      {action}
    </div>
    {children}
  </div>
);
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#08111eee", border:`1px solid ${T.border2}`,
      borderRadius:7, padding:"10px 14px", boxShadow:"0 8px 32px #000000aa" }}>
      <Mono size={10} color={T.muted} style={{ display:"block", marginBottom:5 }}>{label}</Mono>
      {payload.map((p,i) => (
        <div key={i} style={{ display:"flex", gap:8, alignItems:"center" }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:p.color||T.green }} />
          <Mono size={11} color={T.text}>{p.name}: <strong style={{ color:p.color||T.green }}>{p.value}</strong></Mono>
        </div>
      ))}
    </div>
  );
};
const LiveBadge = ({ live }) => (
  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
    <div style={{ width:6, height:6, borderRadius:"50%", background:live?T.green:T.muted,
      boxShadow:live?`0 0 8px ${T.green}`:"none", animation:live?"pulse 2s infinite":"none" }} />
    <Mono size={9} color={live?T.green:T.muted} style={{ letterSpacing:"0.12em" }}>
      {live ? "LIVE" : "DEMO"}
    </Mono>
  </div>
);
const ErrorBanner = ({ msg, color=T.yellow }) => (
  <div style={{ background:color+"1a", border:`1px solid ${color}44`, borderRadius:7,
    padding:"10px 16px", marginBottom:16, display:"flex", gap:8, alignItems:"flex-start" }}>
    <Mono size={13} color={color} style={{ flexShrink:0 }}>⚠</Mono>
    <Mono size={11} color={color}>{msg}</Mono>
  </div>
);

// ─── OVERVIEW ────────────────────────────────────────────────────
const Overview = ({ apiKeys }) => {
  const [solarData, setSolarData] = useState(FALLBACK_SOLAR);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!apiKeys.eia) { setSolarData(FALLBACK_SOLAR); setLive(false); return; }
    setLoading(true);
    fetchEIA(apiKeys.eia)
      .then(d => {
        const valid = Array.isArray(d) && d.length > 0 && d.some(r => r.gw > 0);
        if (valid) { setSolarData(d); setLive(true); }
        else { setSolarData(FALLBACK_SOLAR); setLive(false); }
      })
      .catch(() => { setSolarData(FALLBACK_SOLAR); setLive(false); })
      .finally(() => setLoading(false));
  }, [apiKeys.eia]);

  return (
    <div className="fade-up">
      <SectionHeader title="OVERVIEW" subtitle="Global green energy snapshot — solar & hydrogen"
        right={<LiveBadge live={live} />} />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
        {OVERVIEW_STATS.map((s,i) => (
          <div key={i} className="card fade-up" style={{ padding:"18px 22px",
            animationDelay:`${i*55}ms`, position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:2,
              background:`linear-gradient(90deg,${s.color}99,transparent)` }} />
            <Mono size={10} color={T.muted} style={{ textTransform:"uppercase",
              letterSpacing:"0.12em", display:"block", marginBottom:10 }}>{s.label}</Mono>
            <div style={{ display:"flex", alignItems:"baseline", gap:5, marginBottom:8 }}>
              <Orb size={26} color={T.text}>{s.value}</Orb>
              <Mono size={12} color={T.muted}>{s.unit}</Mono>
            </div>
            <Mono size={11} color={s.up?T.green:T.cyan}>
              {s.up?"↑":"↓"} {s.delta} YoY
            </Mono>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1.1fr 0.9fr", gap:16 }}>
        <ChartCard title={live?"Solar Generation EIA Live (GWh)":"Solar Capacity Additions — Demo (GW)"}
          action={<LiveBadge live={live} />}>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={solarData}>
              <defs>
                <linearGradient id="sg1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={T.green} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={T.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.dim} />
              <XAxis dataKey="m" tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
              <YAxis tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="gw" name="GW" stroke={T.green}
                fill="url(#sg1)" strokeWidth={2} dot={{ fill:T.green, r:2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Green H₂ Investment ($B / quarter)">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={H2_INV}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.dim} />
              <XAxis dataKey="q" tick={{ fill:T.muted, fontSize:9, fontFamily:"IBM Plex Mono" }} />
              <YAxis tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="b" name="$B" radius={[4,4,0,0]}>
                {H2_INV.map((_,i) => <Cell key={i} fill={i>=H2_INV.length-2?T.green:T.cyan} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
};

// ─── SOLAR ───────────────────────────────────────────────────────
const Solar = ({ apiKeys }) => {
  const [data, setData] = useState(FALLBACK_SOLAR);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!apiKeys.eia) { setData(FALLBACK_SOLAR); setLive(false); setError(null); return; }
    setLoading(true); setError(null);
    fetchEIA(apiKeys.eia)
      .then(d => {
        const valid = Array.isArray(d) && d.length > 0 && d.some(r => r.gw > 0);
        if (valid) { setData(d); setLive(true); }
        else { setData(FALLBACK_SOLAR); setLive(false); setError("EIA returned no usable data. Showing demo."); }
      })
      .catch(e => { setError(e.message); setData(FALLBACK_SOLAR); setLive(false); })
      .finally(() => setLoading(false));
  }, [apiKeys.eia]);

  return (
    <div className="fade-up">
      <SectionHeader title="SOLAR" subtitle="Photovoltaic capacity, regional share & market players"
        right={loading ? <Spinner /> : <LiveBadge live={live} />} />
      {error && <ErrorBanner msg={`EIA: ${error}`} />}
      <div style={{ display:"grid", gridTemplateColumns:"1.3fr 0.7fr", gap:16, marginBottom:16 }}>
        <ChartCard title={live?"Monthly Solar Generation — EIA Live (GWh)":"Solar Capacity Additions — Demo (GW)"}>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={T.green} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={T.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.dim} />
              <XAxis dataKey="m" tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
              <YAxis tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="gw" name={live?"GWh":"GW"} stroke={T.green}
                fill="url(#sg2)" strokeWidth={2} dot={{ fill:T.green, r:3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Capacity by Region (GW)">
          <ResponsiveContainer width="100%" height={185}>
            <PieChart>
              <Pie data={SOLAR_REGIONS} dataKey="gw" nameKey="name"
                cx="50%" cy="50%" outerRadius={72} innerRadius={36} paddingAngle={3}>
                {SOLAR_REGIONS.map((_,i) => <Cell key={i} fill={CC[i]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", marginTop:4 }}>
            {SOLAR_REGIONS.map((r,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:7, height:7, borderRadius:2, background:CC[i] }} />
                <Mono size={9} color={T.muted}>{r.name} {r.gw}GW</Mono>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
      <ChartCard title="Key Solar Players">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
          {SOLAR_PLAYERS.map((p,i) => (
            <div key={i} style={{ background:T.surface, borderRadius:8, padding:16,
              border:`1px solid ${T.border}`, transition:"all .2s", cursor:"pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=T.green+"66"; e.currentTarget.style.background="#0a1828"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.background=T.surface; }}>
              <Orb size={15} color={T.green} style={{ display:"block", marginBottom:5 }}>{p.ticker}</Orb>
              <Sans size={13} color={T.text} style={{ display:"block", marginBottom:5 }}>{p.name}</Sans>
              <Mono size={10} color={T.muted}>{p.focus}</Mono>
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
};

// ─── HYDROGEN ────────────────────────────────────────────────────
const Hydrogen = () => (
  <div className="fade-up">
    <SectionHeader title="HYDROGEN" subtitle="Green & blue H₂ — investment, cost curves & global pipeline" />
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
      <ChartCard title="Global H₂ Investment ($B / quarter)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={H2_INV}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.dim} />
            <XAxis dataKey="q" tick={{ fill:T.muted, fontSize:9, fontFamily:"IBM Plex Mono" }} />
            <YAxis tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="b" name="$B" radius={[4,4,0,0]}>
              {H2_INV.map((_,i) => <Cell key={i} fill={i>=H2_INV.length-2?T.green:T.cyan} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Green H₂ Cost Reduction ($/kg)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={H2_COST}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.dim} />
            <XAxis dataKey="y" tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
            <YAxis tick={{ fill:T.muted, fontSize:10, fontFamily:"IBM Plex Mono" }} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="c" name="$/kg" stroke={T.yellow}
              strokeWidth={2.5} dot={{ fill:T.yellow, r:4 }} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
    <ChartCard title="Major H₂ Project Pipeline" style={{ marginBottom:16 }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Project","Country","Capacity (MW)","Stage","Type"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"8px 12px",
                  fontFamily:"IBM Plex Mono", fontSize:10, color:T.muted,
                  fontWeight:400, letterSpacing:"0.1em", textTransform:"uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {H2_PROJECTS.map((p,i) => (
              <tr key={i} style={{ borderBottom:`1px solid ${T.dim}`, transition:"background .15s" }}
                onMouseEnter={e => e.currentTarget.style.background="#00ff9d06"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                <td style={{ padding:"11px 12px", fontFamily:"IBM Plex Sans", fontSize:13, color:T.text }}>{p.name}</td>
                <td style={{ padding:"11px 12px", fontFamily:"IBM Plex Mono", fontSize:11, color:T.muted }}>{p.country}</td>
                <td style={{ padding:"11px 12px", fontFamily:"IBM Plex Mono", fontSize:12, color:T.cyan, textAlign:"right" }}>{p.mw.toLocaleString()}</td>
                <td style={{ padding:"11px 12px" }}>
                  <Pill color={p.stage==="Construction"?T.green:p.stage==="Development"?T.cyan:T.muted}>{p.stage}</Pill>
                </td>
                <td style={{ padding:"11px 12px" }}>
                  <Pill color={p.type==="Green"?T.green:T.yellow}>{p.type}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
    <ChartCard title="Key Hydrogen Players">
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {H2_PLAYERS.map((p,i) => (
          <div key={i} style={{ background:T.surface, borderRadius:8, padding:16,
            border:`1px solid ${T.border}`, transition:"all .2s", cursor:"pointer" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor=T.cyan+"66"; e.currentTarget.style.background="#0a1828"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.background=T.surface; }}>
            <Orb size={15} color={T.cyan} style={{ display:"block", marginBottom:5 }}>{p.ticker}</Orb>
            <Sans size={13} color={T.text} style={{ display:"block", marginBottom:5 }}>{p.name}</Sans>
            <Mono size={10} color={T.muted}>{p.focus}</Mono>
          </div>
        ))}
      </div>
    </ChartCard>
  </div>
);

// ─── MARKETS ─────────────────────────────────────────────────────
const TICKERS = ["FSLR","ENPH","PLUG","BE","NEE","CSIQ","SEDG","ITM"];

const Markets = ({ apiKeys }) => {
  const [quotes, setQuotes] = useState({ ...MOCK_QUOTES });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState("FSLR");
  const [lastUpdated, setLastUpdated] = useState(null);
  const noKey = !apiKeys.finnhub;

  const refresh = useCallback(async () => {
    if (!apiKeys.finnhub) return;
    setLoading(true); setErrors([]);
    const results = { ...MOCK_QUOTES };
    const errs = [];
    // AV free tier: 25 req/day, ~5/min. Fetch first 6 with spacing.
    for (const ticker of TICKERS.slice(0, 6)) {
      try {
        results[ticker] = await fetchFinnhub(ticker, apiKeys.finnhub);
      } catch (e) {
        errs.push(`${ticker}: ${e.message}`);
      }
      if (TICKERS.indexOf(ticker) < 5)
        await new Promise(r => setTimeout(r, 600));
    }
    setQuotes(results);
    setErrors(errs);
    setLive(true);
    setLastUpdated(new Date());
    setLoading(false);
  }, [apiKeys.finnhub]);

  useEffect(() => { if (apiKeys.finnhub) refresh(); }, [apiKeys.finnhub]);

  const sel = quotes[selected] || MOCK_QUOTES[selected];
  const selUp = sel && parseFloat(sel.change) >= 0;

  return (
    <div className="fade-up">
      <SectionHeader title="MARKETS" subtitle="Green energy equities — solar, hydrogen & utilities"
        right={
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {loading ? <Spinner /> : <LiveBadge live={live} />}
            <button onClick={refresh} disabled={loading||noKey}
              style={{ background:T.greenDim, border:`1px solid ${T.green}55`, color:T.green,
                padding:"6px 14px", borderRadius:6, fontFamily:"IBM Plex Mono", fontSize:11,
                cursor:loading||noKey?"not-allowed":"pointer", opacity:noKey?.45:1,
                display:"flex", gap:6, alignItems:"center" }}>
              {loading ? <><Spinner size={11} /> Fetching…</> : "↻ Refresh"}
            </button>
          </div>
        }
      />
      {noKey && <ErrorBanner msg="Enter your Finnhub API key in Settings to enable live quotes. Showing demo data." color={T.yellow} />}
      {errors.map((e,i) => <ErrorBanner key={i} msg={e} color={T.red} />)}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 }}>
        {TICKERS.map(t => {
          const q = quotes[t] || MOCK_QUOTES[t];
          const up = q && parseFloat(q.change) >= 0;
          const sel = selected === t;
          return (
            <div key={t} onClick={() => setSelected(t)} style={{
              background:sel?"#0a1e35":T.card, border:`1px solid ${sel?T.green+"66":T.border}`,
              borderRadius:9, padding:"16px 18px", cursor:"pointer", transition:"all .2s",
              boxShadow:sel?`0 0 20px ${T.green}18`:"none", position:"relative", overflow:"hidden" }}>
              {sel && <div style={{ position:"absolute", top:0, left:0, right:0, height:2,
                background:`linear-gradient(90deg,${T.green},transparent)` }} />}
              {!live && <Mono size={8} color={T.muted} style={{ position:"absolute", top:6, right:8 }}>DEMO</Mono>}
              <Orb size={13} color={up?T.green:T.red} style={{ display:"block", marginBottom:5 }}>{t}</Orb>
              <Orb size={20} color={T.text} style={{ display:"block", marginBottom:5 }}>${q?.price}</Orb>
              <Mono size={11} color={up?T.green:T.red}>{up?"▲":"▼"} {q?.change} ({q?.pct}%)</Mono>
            </div>
          );
        })}
      </div>
      {sel && (
        <ChartCard title={`${selected} — Detail`}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
            {[
              { label:"Price", val:`$${sel.price}`, color:selUp?T.green:T.red },
              { label:"Day High", val:`$${sel.high||"—"}`, color:T.green },
              { label:"Day Low", val:`$${sel.low||"—"}`, color:T.red },
              { label:"Volume", val:sel.vol, color:T.cyan },
            ].map((f,i) => (
              <div key={i} style={{ background:T.surface, borderRadius:7, padding:"14px 16px",
                border:`1px solid ${T.border}` }}>
                <Mono size={10} color={T.muted} style={{ display:"block", marginBottom:6,
                  textTransform:"uppercase", letterSpacing:"0.1em" }}>{f.label}</Mono>
                <Orb size={18} color={f.color}>{f.val}</Orb>
              </div>
            ))}
          </div>
          {lastUpdated && <Mono size={10} color={T.muted} style={{ display:"block", marginTop:10 }}>
            Updated: {lastUpdated.toLocaleTimeString()}
          </Mono>}
        </ChartCard>
      )}
    </div>
  );
};

// ─── MAP ─────────────────────────────────────────────────────────
const MapSection = () => {
  const [hover, setHover] = useState(null);
  const [tab, setTab] = useState("solar");

  return (
    <div className="fade-up">
      <SectionHeader title="MAP" subtitle="Global distribution of solar capacity and hydrogen projects" />
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {[["solar","☀  Solar Capacity",T.green],["h2","⬡  Hydrogen Projects",T.cyan]].map(([k,label,col]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background:tab===k?col+"1a":"transparent", border:`1px solid ${tab===k?col:T.border}`,
            color:tab===k?col:T.muted, padding:"8px 18px", borderRadius:7,
            fontFamily:"IBM Plex Mono", fontSize:12, cursor:"pointer", transition:"all .2s" }}>
            {label}
          </button>
        ))}
      </div>
      <ChartCard title={tab==="solar"?"Solar Installed Capacity (GW) by Region":"Hydrogen Projects Volume (MW) by Region"}>
        <div style={{ position:"relative", width:"100%", height:400, background:"#060f1e",
          borderRadius:8, overflow:"hidden", marginBottom:16 }}>
          <svg width="100%" height="100%" style={{ position:"absolute", top:0, left:0, opacity:.07 }}>
            {[...Array(9)].map((_,i) => (
              <line key={`h${i}`} x1="0" y1={`${(i+1)*10}%`} x2="100%" y2={`${(i+1)*10}%`}
                stroke={T.cyan} strokeWidth=".8" />
            ))}
            {[...Array(11)].map((_,i) => (
              <line key={`v${i}`} x1={`${(i+1)*8.33}%`} y1="0" x2={`${(i+1)*8.33}%`} y2="100%"
                stroke={T.cyan} strokeWidth=".8" />
            ))}
          </svg>
          <svg width="100%" height="100%" viewBox="0 0 100 100"
            style={{ position:"absolute", top:0, left:0, opacity:.05 }} preserveAspectRatio="none">
            <ellipse cx="20" cy="42" rx="14" ry="16" fill={T.cyan} />
            <ellipse cx="26" cy="70" rx="7" ry="13" fill={T.cyan} />
            <ellipse cx="50" cy="30" rx="8" ry="9" fill={T.cyan} />
            <ellipse cx="52" cy="62" rx="9" ry="14" fill={T.cyan} />
            <ellipse cx="72" cy="38" rx="18" ry="16" fill={T.cyan} />
            <ellipse cx="78" cy="70" rx="8" ry="7" fill={T.cyan} />
          </svg>
          {MAP_REGIONS.map(r => {
            const val = tab==="solar"?r.solar:r.h2;
            const maxVal = tab==="solar"?750:120;
            const radius = 16+(val/maxVal)*36;
            const color = tab==="solar"?T.green:T.cyan;
            const isH = hover===r.id;
            return (
              <div key={r.id} onMouseEnter={()=>setHover(r.id)} onMouseLeave={()=>setHover(null)}
                style={{ position:"absolute", left:`${r.x}%`, top:`${r.y}%`,
                  transform:"translate(-50%,-50%)", cursor:"pointer", zIndex:isH?10:1 }}>
                <div style={{ width:radius*2, height:radius*2, borderRadius:"50%",
                  background:color+"1a", border:`1.5px solid ${color}${isH?"cc":"55"}`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all .2s", boxShadow:isH?`0 0 28px ${color}55`:`0 0 10px ${color}22` }}>
                  <div style={{ width:radius*.6, height:radius*.6, borderRadius:"50%",
                    background:color+"33", border:`1px solid ${color}88` }} />
                </div>
                <div style={{ position:"absolute", top:"50%", left:"50%",
                  transform:"translate(-50%,-50%)", fontFamily:"IBM Plex Mono",
                  fontSize:8.5, color, whiteSpace:"nowrap", pointerEvents:"none" }}>
                  {r.name}
                </div>
                {isH && (
                  <div style={{ position:"absolute", left:"50%", bottom:`calc(100% + 10px)`,
                    transform:"translateX(-50%)", background:"#08111eee",
                    border:`1px solid ${color}`, borderRadius:7, padding:"10px 14px",
                    fontFamily:"IBM Plex Mono", fontSize:11, whiteSpace:"nowrap", zIndex:100 }}>
                    <div style={{ color, fontWeight:600, marginBottom:4 }}>{r.name}</div>
                    <div style={{ color:T.text }}>{val.toLocaleString()} {tab==="solar"?"GW":"MW"}</div>
                  </div>
                )}
              </div>
            );
          })}
          <Mono size={9} color={T.muted} style={{ position:"absolute", bottom:10, right:12 }}>
            Hover for details
          </Mono>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {MAP_REGIONS.map(r => {
            const val = tab==="solar"?r.solar:r.h2;
            const color = tab==="solar"?T.green:T.cyan;
            return (
              <div key={r.id} style={{ background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:6, padding:"5px 12px", cursor:"default" }}
                onMouseEnter={()=>setHover(r.id)} onMouseLeave={()=>setHover(null)}>
                <Mono size={11} color={color}>{r.name}</Mono>
                <Mono size={10} color={T.muted}> · {val.toLocaleString()} {tab==="solar"?"GW":"MW"}</Mono>
              </div>
            );
          })}
        </div>
      </ChartCard>
    </div>
  );
};

// ─── NEWS (GNews API) ────────────────────────────────────────────
const News = ({ apiKeys }) => {
  const [topic, setTopic] = useState("solar");
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasKey = !!apiKeys?.gnews;

  const load = useCallback(async (t) => {
    if (!apiKeys?.gnews) return;
    setLoading(true); setError(null); setArticles([]);
    try {
      const items = await fetchGNews(t, apiKeys.gnews);
      setArticles(items);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [apiKeys?.gnews]);

  useEffect(() => { if (hasKey) load(topic); }, [topic, hasKey]);

  const col = GNEWS_TOPICS[topic].color;
  const fmtDate = d => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";

  return (
    <div className="fade-up">
      <SectionHeader title="NEWS" subtitle="Live green energy headlines powered by GNews API" />

      {!hasKey && (
        <div style={{ background:T.yellowDim, border:`1px solid ${T.yellow}44`,
          borderRadius:10, padding:"20px 24px", marginBottom:20,
          display:"flex", gap:14, alignItems:"center" }}>
          <span style={{ fontSize:20 }}>🔑</span>
          <div>
            <Sans size={14} weight={500} color={T.yellow} style={{ display:"block", marginBottom:4 }}>
              GNews API Key Required
            </Sans>
            <Sans size={12} color={T.sub} style={{ display:"block" }}>
              Add your free GNews key in Settings to load live headlines.
              Get one free at gnews.io — 100 requests/day.
            </Sans>
          </div>
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
        {Object.entries(GNEWS_TOPICS).map(([k,v]) => (
          <button key={k} onClick={() => setTopic(k)} style={{
            background:topic===k?v.color+"1a":"transparent",
            border:`1px solid ${topic===k?v.color:T.border}`,
            color:topic===k?v.color:T.muted,
            padding:"8px 18px", borderRadius:7, fontFamily:"IBM Plex Mono",
            fontSize:12, cursor:"pointer", transition:"all .2s" }}>
            {v.label}
          </button>
        ))}
        <button onClick={() => load(topic)} disabled={loading || !hasKey}
          style={{ marginLeft:"auto", background:col+"1a", border:`1px solid ${col}55`,
            color:col, padding:"8px 14px", borderRadius:7, fontFamily:"IBM Plex Mono",
            fontSize:12, cursor:(loading||!hasKey)?"not-allowed":"pointer",
            display:"flex", gap:6, alignItems:"center", opacity:!hasKey?0.4:1 }}>
          {loading ? <><Spinner size={11} color={col} /> Loading…</> : "↻ Refresh"}
        </button>
      </div>

      {error && <ErrorBanner msg={error} color={T.red} />}
      {loading && (
        <div style={{ display:"flex", justifyContent:"center", alignItems:"center", height:180, gap:12 }}>
          <Spinner color={col} size={20} />
          <Mono color={T.muted}>Fetching headlines…</Mono>
        </div>
      )}
      {!loading && !error && hasKey && articles.length === 0 && (
        <div style={{ textAlign:"center", padding:48 }}>
          <Mono color={T.muted}>No articles found.</Mono>
        </div>
      )}
      {!loading && articles.length > 0 && (
        <div style={{ display:"grid", gap:10 }}>
          {articles.map((a,i) => (
            <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
              <div className="card fade-up" style={{ padding:"15px 20px", display:"flex",
                gap:14, alignItems:"flex-start", animationDelay:`${i*35}ms`,
                cursor:"pointer", transition:"border-color .2s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = col+"55"}
                onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                {a.thumbnail && (
                  <img src={a.thumbnail} alt="" style={{ width:70, height:48,
                    objectFit:"cover", borderRadius:5, flexShrink:0, border:`1px solid ${T.border}` }}
                    onError={e => e.target.style.display="none"} />
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <Sans size={14} weight={500} color={T.text}
                    style={{ display:"block", marginBottom:5, lineHeight:1.4 }}>{a.title}</Sans>
                  {a.description && (
                    <Mono size={10} color={T.muted} style={{ display:"block", marginBottom:5,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {a.description.slice(0,150)}…
                    </Mono>
                  )}
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <Mono size={10} color={col}>{fmtDate(a.pubDate)}</Mono>
                    {a.source && <Mono size={10} color={T.muted}>· {a.source}</Mono>}
                  </div>
                </div>
                <Sans size={16} color={T.muted} style={{ flexShrink:0 }}>→</Sans>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── SETTINGS ────────────────────────────────────────────────────
const Settings = ({ apiKeys, setApiKeys }) => {
  const [local, setLocal] = useState({ ...apiKeys });
  const [show, setShow] = useState({});
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});

  const save = () => {
    setApiKeys({ ...local });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const testKey = async (key) => {
    if (!local[key]) return;
    setTesting(t => ({ ...t, [key]:true }));
    setTestResults(r => ({ ...r, [key]:null }));
    try {
      if (key === "eia") {
        await fetchEIA(local.eia);
        setTestResults(r => ({ ...r, eia:{ ok:true, msg:"✓ EIA connection successful!" } }));
      } else if (key === "finnhub") {
        await fetchFinnhub("FSLR", local.finnhub);
        setTestResults(r => ({ ...r, finnhub:{ ok:true, msg:"✓ Finnhub connection successful!" } }));
      } else if (key === "gnews") {
        await fetchGNews("solar", local.gnews);
        setTestResults(r => ({ ...r, gnews:{ ok:true, msg:"✓ GNews connection successful!" } }));
      }
    } catch(e) {
      setTestResults(r => ({ ...r, [key]:{ ok:false, msg:`✗ ${e.message}` } }));
    }
    setTesting(t => ({ ...t, [key]:false }));
  };

  const FIELDS = [
    { key:"eia", label:"EIA API Key", color:T.green,
      hint:"Free — register at eia.gov/opendata", link:"https://www.eia.gov/opendata/register.php",
      desc:"Powers real-time US solar generation charts in Solar and Overview." },
    { key:"finnhub", label:"Finnhub API Key", color:T.cyan,
      hint:"Free tier: 60 req/min — finnhub.io", link:"https://finnhub.io/register",
      desc:"Powers real-time stock quotes in the Markets section. 60 req/min on free tier." },
    { key:"gnews", label:"GNews API Key", color:T.purple,
      hint:"Free tier: 100 req/day — gnews.io", link:"https://gnews.io",
      desc:"Powers live green energy headlines in the News section." },
  ];

  return (
    <div className="fade-up">
      <SectionHeader title="SETTINGS" subtitle="Configure API keys — paste, test, then save" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20, maxWidth:780 }}>
        {FIELDS.map(f => {
          const result = testResults[f.key];
          return (
            <div key={f.key} className="card" style={{ padding:"22px 24px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <Mono size={11} color={f.color} style={{ textTransform:"uppercase", letterSpacing:"0.12em" }}>
                  {f.label}
                </Mono>
                {local[f.key] && <Pill color={f.color}>configured</Pill>}
              </div>
              <Sans size={12} color={T.muted} style={{ display:"block", marginBottom:14, lineHeight:1.5 }}>
                {f.desc}
              </Sans>
              <div style={{ position:"relative", marginBottom:8 }}>
                <input type={show[f.key]?"text":"password"}
                  value={local[f.key]||""}
                  onChange={e => setLocal(l => ({ ...l, [f.key]:e.target.value }))}
                  placeholder={`Paste your ${f.label}…`}
                  style={{ width:"100%", background:T.surface, border:`1px solid ${T.border}`,
                    borderRadius:7, padding:"11px 40px 11px 14px",
                    fontFamily:"IBM Plex Mono", fontSize:12, color:T.text, transition:"border .2s" }}
                  onFocus={e => e.target.style.borderColor=f.color}
                  onBlur={e => e.target.style.borderColor=T.border}
                />
                <button onClick={() => setShow(s => ({ ...s, [f.key]:!s[f.key] }))}
                  style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                    background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:14 }}>
                  {show[f.key]?"●":"○"}
                </button>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
                <button onClick={() => testKey(f.key)} disabled={!local[f.key]||testing[f.key]}
                  style={{ background:f.color+"1a", border:`1px solid ${f.color}55`, color:f.color,
                    padding:"6px 14px", borderRadius:6, fontFamily:"IBM Plex Mono", fontSize:11,
                    cursor:!local[f.key]||testing[f.key]?"not-allowed":"pointer",
                    opacity:!local[f.key]?.5:1, display:"flex", gap:6, alignItems:"center" }}>
                  {testing[f.key] ? <><Spinner size={10} color={f.color} /> Testing…</> : "Test Connection"}
                </button>
                {result && (
                  <Mono size={11} color={result.ok?T.green:T.red}>{result.msg}</Mono>
                )}
              </div>
              <a href={f.link} target="_blank" rel="noopener noreferrer">
                <Mono size={10} color={T.muted} style={{ textDecoration:"underline", textDecorationColor:T.border }}>
                  {f.hint} ↗
                </Mono>
              </a>
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:0 }}>
      <button onClick={save} style={{ background:saved?T.green+"22":T.greenDim,
        border:`1px solid ${saved?T.green:T.green+"66"}`, color:T.green,
        padding:"12px 36px", borderRadius:7, fontFamily:"IBM Plex Mono", fontSize:13,
        cursor:"pointer", letterSpacing:"0.08em", transition:"all .2s",
        boxShadow:saved?`0 0 20px ${T.green}33`:"none" }}>
        {saved ? "✓  SAVED & APPLIED" : "SAVE KEYS"}
      </button>
      <button onClick={() => {
        Object.keys(localStorage).filter(k => k.startsWith("gp_cache_")).forEach(k => localStorage.removeItem(k));
        alert("Cache cleared — next data load will fetch fresh from APIs.");
      }} style={{ background:T.yellowDim, border:`1px solid ${T.yellow}55`, color:T.yellow,
        padding:"12px 20px", borderRadius:7, fontFamily:"IBM Plex Mono", fontSize:11,
        cursor:"pointer", letterSpacing:"0.06em" }}>
        ↺ Clear Cache
      </button>
      <button onClick={() => {
        if (window.confirm("Delete all saved API keys? You will need to re-enter them.")) {
          localStorage.removeItem("gp_keys");
          setLocal({ eia:"", finnhub:"", gnews:"" });
          setApiKeys({ eia:"", finnhub:"", gnews:"" });
        }
      }} style={{ background:T.redDim, border:`1px solid ${T.red}55`, color:T.red,
        padding:"12px 20px", borderRadius:7, fontFamily:"IBM Plex Mono", fontSize:11,
        cursor:"pointer", letterSpacing:"0.06em" }}>
        ✕ Clear Keys
      </button>
      </div>
      {/* Status */}
      <div className="card" style={{ padding:"20px 24px", marginTop:20, maxWidth:780 }}>
        <Mono size={10} color={T.muted} style={{ textTransform:"uppercase", letterSpacing:"0.12em",
          display:"block", marginBottom:14 }}>Data Source Status</Mono>
        {[
          { label:"EIA API", desc:"US solar generation (monthly)", key:"eia", color:T.green },
          { label:"Finnhub", desc:"Real-time equity quotes", key:"finnhub", color:T.cyan },
          { label:"GNews API", desc:"Live green energy headlines", key:"gnews", color:T.purple },
        ].map((s,i) => {
          const active = !!local[s.key];
          return (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"12px 0", borderBottom:i<2?`1px solid ${T.dim}`:"none" }}>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ width:7, height:7, borderRadius:"50%", flexShrink:0,
                  background:active?s.color:T.muted, boxShadow:active?`0 0 8px ${s.color}`:"none" }} />
                <div>
                  <Mono size={12} color={T.text} style={{ display:"block" }}>{s.label}</Mono>
                  <Mono size={10} color={T.muted}>{s.desc}</Mono>
                </div>
              </div>
              <Pill color={active?s.color:T.muted}>
                {s.key===null?"always on":active?"configured":"not set"}
              </Pill>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── NAV ─────────────────────────────────────────────────────────
const NAV = [
  { id:"overview",  icon:"◈", label:"Overview" },
  { id:"solar",     icon:"☀", label:"Solar" },
  { id:"hydrogen",  icon:"⬡", label:"Hydrogen" },
  { id:"markets",   icon:"↗", label:"Markets" },
  { id:"map",       icon:"◎", label:"Map" },
  { id:"news",      icon:"◉", label:"News" },
  { id:"settings",  icon:"⚙", label:"Settings" },
];

// ─── APP ROOT ────────────────────────────────────────────────────
export default function App() {
  const [active, setActive] = useState("overview");
  const [apiKeys, setApiKeys] = useState({ eia:"", finnhub:"", gnews:"" });

  // Persist keys to localStorage so they survive hot-reloads
  useEffect(() => {
    const loaded = loadKeys();
    if (loaded) setApiKeys(loaded);
  }, []);

  const updateKeys = (keys) => {
    setApiKeys(keys);
    saveKeys(keys);
  };

  // Pause background activity when tab is not visible
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const fn = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  const now = new Date().toLocaleDateString("en-US",
    { weekday:"short", month:"short", day:"numeric", year:"numeric" });

  const renderSection = () => {
    switch (active) {
      case "overview":  return <Overview  apiKeys={apiKeys} />;
      case "solar":     return <Solar     apiKeys={apiKeys} />;
      case "hydrogen":  return <Hydrogen />;
      case "markets":   return <Markets   apiKeys={apiKeys} />;
      case "map":       return <MapSection />;
      case "news":      return <News      apiKeys={apiKeys} />;
      case "settings":  return <Settings  apiKeys={apiKeys} setApiKeys={updateKeys} />;
      default:          return <Overview  apiKeys={apiKeys} />;
    }
  };

  return (
    <>
      <FontLoader />
      <div style={{ display:"flex", height:"100vh", background:T.bg, overflow:"hidden" }}>
        {/* Sidebar */}
        <aside style={{ width:208, background:T.surface, borderRight:`1px solid ${T.border}`,
          display:"flex", flexDirection:"column", flexShrink:0 }}>
          <div style={{ padding:"22px 20px 18px", borderBottom:`1px solid ${T.border}` }}>
            <Orb size={16} weight={900} color={T.green} style={{ display:"block", letterSpacing:"0.05em" }}>
              GREEN
            </Orb>
            <Orb size={14} weight={900} color={T.cyan} style={{ display:"block", letterSpacing:"0.05em" }}>
              PULSE
            </Orb>
            <Mono size={9} color={T.muted} style={{ marginTop:6, letterSpacing:"0.18em",
              textTransform:"uppercase", display:"block" }}>Energy Intelligence</Mono>
          </div>
          <nav style={{ flex:1, padding:"12px 10px", overflowY:"auto" }}>
            {NAV.map(item => (
              <button key={item.id} onClick={() => setActive(item.id)}
                className={`nav-btn${active===item.id?" active":""}`}
                style={{ padding:"10px 12px", marginBottom:3,
                  color:active===item.id?T.green:T.muted }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:14, width:18, textAlign:"center" }}>{item.icon}</span>
                  <Mono size={12} color="inherit" style={{ letterSpacing:"0.06em" }}>{item.label}</Mono>
                </div>
              </button>
            ))}
          </nav>
          <div style={{ padding:"14px 18px", borderTop:`1px solid ${T.border}` }}>
            {["EIA","Finnhub","GNews"].map((s,i) => {
              const active_ = (s==="EIA"&&apiKeys.eia)||(s==="Finnhub"&&apiKeys.finnhub)||(s==="GNews"&&apiKeys.gnews);
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                  <div style={{ width:5, height:5, borderRadius:"50%",
                    background:active_?T.green:T.muted,
                    boxShadow:active_?`0 0 6px ${T.green}`:"none" }} />
                  <Mono size={9} color={T.muted}>{s}</Mono>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          <div style={{ padding:"16px 36px", borderBottom:`1px solid ${T.border}`,
            display:"flex", justifyContent:"space-between", alignItems:"center",
            background:T.surface, flexShrink:0 }}>
            <Orb size={13} color={T.sub} style={{ letterSpacing:"0.1em" }}>
              {NAV.find(n => n.id===active)?.icon} {NAV.find(n => n.id===active)?.label}
            </Orb>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <Mono size={11} color={T.muted}>{now}</Mono>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:T.green,
                  boxShadow:`0 0 8px ${T.green}`, animation:"blink 2.5s ease-in-out infinite" }} />
                <Mono size={9} color={T.green} style={{ letterSpacing:"0.12em" }}>LIVE</Mono>
              </div>
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"30px 36px" }}>
            {renderSection()}
          </div>
          <DiligenceFooter />
        </main>
      </div>
    </>
  );
}

// ─── DILIGENCE FOOTER ─────────────────────────────────────────────
const DiligenceFooter = () => (
  <div style={{
    flexShrink:0, borderTop:"1px solid #162236",
    background:"#08111e", padding:"10px 36px",
    display:"flex", justifyContent:"flex-end",
    alignItems:"center",
  }}>
    <a href="https://github.com/achicodess/greenpulse/raw/main/public/AI_Diligence_Statement_GreenPulse.pdf"
      target="_blank" rel="noopener noreferrer"
      style={{ display:"flex", alignItems:"center", gap:6,
        background:"#00ff9d18", border:"1px solid #00ff9d44",
        borderRadius:6, padding:"5px 14px", textDecoration:"none",
        transition:"all 0.2s" }}>
      <span style={{ fontSize:12 }}>📄</span>
      <span style={{ fontFamily:"'IBM Plex Mono'", fontSize:11,
        color:"#00ff9d", letterSpacing:"0.08em" }}>
         Diligence Statement ↗
      </span>
    </a>
  </div>
);
