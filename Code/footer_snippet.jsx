// ─────────────────────────────────────────────────────────────────
// GREENPULSE — AI DILIGENCE FOOTER
// ─────────────────────────────────────────────────────────────────
// Instructions:
// 1. Copy the AI_Diligence_Statement_GreenPulse.pdf into your
//    greenpulse/public/ folder (same level as src/)
//
// 2. In your App.jsx, find the <main> tag and replace it with
//    the version below that includes the DiligenceFooter.
//
// 3. Paste the DiligenceFooter component anywhere before
//    `export default function App()`
// ─────────────────────────────────────────────────────────────────

// ── STEP 1: Paste this component into App.jsx ────────────────────

const DiligenceFooter = () => (
  <div style={{
    flexShrink: 0,
    borderTop: "1px solid #162236",
    background: "#08111e",
    padding: "12px 36px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  }}>
    {/* Left — label */}
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "#00ff9d", boxShadow: "0 0 8px #00ff9d",
      }} />
      <span style={{
        fontFamily: "'IBM Plex Mono'", fontSize: 11, color: "#4a6080",
        letterSpacing: "0.08em",
      }}>
        Built with Claude Sonnet 4.6 · Anthropic
      </span>
    </div>

    {/* Center — statement */}
    <span style={{
      fontFamily: "'IBM Plex Mono'", fontSize: 11, color: "#4a6080",
      letterSpacing: "0.06em", textAlign: "center",
    }}>
      AI was used to build this dashboard. All outputs reviewed & approved by the author.
    </span>

    {/* Right — PDF link */}
    <a
      href="https://github.com/achicodess/greenpulse/raw/main/public/AI_Diligence_Statement_GreenPulse.pdf"      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        background: "#00ff9d18", border: "1px solid #00ff9d44",
        borderRadius: 6, padding: "5px 14px", textDecoration: "none",
        transition: "all 0.2s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "#00ff9d28";
        e.currentTarget.style.borderColor = "#00ff9d88";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "#00ff9d18";
        e.currentTarget.style.borderColor = "#00ff9d44";
      }}
    >
      <span style={{ fontSize: 12 }}>📄</span>
      <span style={{
        fontFamily: "'IBM Plex Mono'", fontSize: 11,
        color: "#00ff9d", letterSpacing: "0.08em",
      }}>
        AI Diligence Statement ↗
      </span>
    </a>
  </div>
);

// ── STEP 2: Replace your <main>...</main> block with this ─────────
// Find this in App.jsx:
//
//   <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
//     ...topbar...
//     ...content...
//   </main>
//
// Replace it with:

/*
<main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
  {/* Topbar */}
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

  {/* Content */}
  <div style={{ flex:1, overflowY:"auto", padding:"30px 36px" }}>
    {renderSection()}
  </div>

  {/* ← ADD THIS LINE */}
  <DiligenceFooter />

</main>
*/
