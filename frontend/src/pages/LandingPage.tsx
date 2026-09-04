import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  { icon:'💧', label:'Water Bottles',  q:'water bottle'         },
  { icon:'☕', label:'Thermos',         q:'thermos flask'        },
  { icon:'🍱', label:'Lunch Boxes',    q:'lunch box'            },
  { icon:'🫖', label:'Mugs',           q:'coffee mug'           },
  { icon:'🧴', label:'Cleaning',       q:'bottle cleaning brush'},
  { icon:'🔬', label:'Filters',        q:'water filter'         },
  { icon:'🎒', label:'Accessories',    q:'bottle accessories'   },
  { icon:'📦', label:'Bundles',        q:'combo bundle pack'    },
];

const FEATURES = [
  { icon:'🤖', title:'Natural Language Search',
    desc:'Just describe what you want — price, material, size, brand. The AI understands it all.' },
  { icon:'🔑', title:'Gated Payments',
    desc:'Every transaction requires your explicit approval at each step. Nothing moves without consent.' },
  { icon:'📋', title:'Full Audit Trail',
    desc:'Every agent decision is logged with a clear reason. Fully transparent and explainable.' },
  { icon:'✉️', title:'Email Receipt',
    desc:'A professional receipt lands in your inbox after every successful purchase.' },
];

const HOW_STEPS = [
  { n:'01', title:'Search Naturally',
    desc:'Type in plain language. "Insulated bottle under ₹600 for office" — no filters needed.' },
  { n:'02', title:'Review Cart',
    desc:'The AI agent builds your cart and suggests combos that save you money.' },
  { n:'03', title:'Approve at Every Gate',
    desc:'You approve each step: interest, cap check, and payment. Full control always.' },
  { n:'04', title:'Confirmed!',
    desc:'Receipt in inbox, order in history. Agent trail saved for review.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [activeCat, setActiveCat] = useState('');

  const doSearch = (q: string) => {
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="page-wrap animate-fade">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-grid">

          {/* Left: text */}
          <div className="hero-content">
            <div className="hero-eyebrow">
              <span>✦</span>
              <span>AI-Powered Shopping Agent</span>
            </div>

            <h1 className="hero-title serif">
              Shop Smarter with<br />
              <span className="accent">AsklyCart</span>
            </h1>

            <p className="hero-subtitle">
              Search in natural language, get AI-curated results, approve every step.
              A next-generation shopping experience with full transparency.
            </p>

            {/* Search bar */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="search-bar" style={{ flex: 1, borderRadius: 8 }}>
                <input
                  id="hero-search"
                  placeholder='Try: "insulated bottle under ₹600 for office"'
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchInput.trim() && doSearch(searchInput)}
                />
                <button
                  className="btn btn-gold btn-sm search-btn"
                  onClick={() => searchInput.trim() && doSearch(searchInput)}
                >
                  Search →
                </button>
              </div>
            </div>

            {/* Quick chips */}
            <div className="hero-chips">
              {['Insulated bottle ₹400–800', 'Stainless steel thermos', 'Leak-proof lunch box'].map(s => (
                <button key={s} className="hero-chip" onClick={() => doSearch(s)}>{s}</button>
              ))}
            </div>
          </div>

          {/* Right: visual card */}
          <div className="hero-visual-card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--gold)' }}>
              AI Agent Demo
            </div>
            <div style={{
              background: 'var(--bg-2)', borderRadius: 10, padding: '20px 18px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>You searched:</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>"insulated bottle under ₹500"</div>
            </div>

            {[
              { icon:'✅', label:'Parsed your query', val:'₹500 cap set',    green: true  },
              { icon:'🛒', label:'Cart built',        val:'1 product found', green: true  },
              { icon:'🔑', label:'Gate 1 — Interest', val:'Awaiting you',    green: false },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 8,
                background: row.green ? 'rgba(22,163,74,.07)' : 'var(--gold-muted)',
                border: `1px solid ${row.green ? 'rgba(22,163,74,.2)' : 'var(--gold-border)'}`,
              }}>
                <span style={{ fontSize: 18 }}>{row.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{row.label}</span>
                <span style={{ fontSize: 12, color: row.green ? 'var(--success)' : 'var(--gold)', fontWeight: 700 }}>
                  {row.val}
                </span>
              </div>
            ))}

            <div style={{
              background: 'linear-gradient(135deg, var(--gold-dark), var(--gold))',
              borderRadius: 8, padding: '14px 18px', color: '#000', textAlign: 'center',
              fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }} onClick={() => doSearch('insulated bottle under 500')}>
              Try it yourself →
            </div>
          </div>
        </div>
      </section>

      {/* ── CATEGORY SHELF ────────────────────────────────────── */}
      <section className="category-shelf">
        <div className="category-shelf__inner">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 16 }}>
            Shop by Category
          </div>
          <div className="category-scroll">
            {CATEGORIES.map(c => (
              <div
                key={c.label}
                className={`cat-chip ${activeCat === c.q ? 'active' : ''}`}
                onClick={() => { setActiveCat(c.q); doSearch(c.q); }}
              >
                <div className="cat-chip__icon">{c.icon}</div>
                <div className="cat-chip__label">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────── */}
      <section style={{ background: 'var(--bg)', padding: '64px 20px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="section-eyebrow" style={{ justifyContent: 'center' }}>
              <div className="section-eyebrow__line" />
              <span className="section-eyebrow__text">How It Works</span>
              <div className="section-eyebrow__line" />
            </div>
            <h2 style={{ marginTop: 8 }}>Shopping, reimagined</h2>
            <p style={{ maxWidth: 480, margin: '8px auto 0' }}>
              AI-powered decisions at every step with your approval
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {HOW_STEPS.map(s => (
              <div key={s.n} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '28px 24px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{
                  fontSize: 32, fontWeight: 800, color: 'var(--gold)',
                  fontFamily: "'Playfair Display', serif", marginBottom: 16,
                }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section className="features-band">
        <div className="features-inner">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="section-eyebrow" style={{ justifyContent: 'center' }}>
              <div className="section-eyebrow__line" />
              <span className="section-eyebrow__text">Why AsklyCart</span>
              <div className="section-eyebrow__line" />
            </div>
            <h2 style={{ marginTop: 8 }}>Everything you need</h2>
          </div>
          <div className="features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="feature-item">
                <div className="feature-icon">{f.icon}</div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="cta-band">
        <h2>Ready to shop smarter?</h2>
        <p>
          Let AI handle the browsing. You stay in control of every decision.
          No hidden charges, no surprises.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            id="cta-shop-btn"
            className="btn btn-gold btn-xl"
            onClick={() => doSearch('insulated water bottle')}
          >
            Start Shopping →
          </button>
          {!isLoggedIn && (
            <button
              className="btn btn-outline btn-xl"
              style={{ borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}
              onClick={() => navigate('/auth')}
            >
              Create Account
            </button>
          )}
        </div>
      </section>

    </div>
  );
}
