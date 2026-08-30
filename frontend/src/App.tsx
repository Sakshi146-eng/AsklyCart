import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import { api } from './api/client';
import type { CartItem, CrossSellSuggestion, AuditEntry, Product, AgentFlowResponse } from './api/client';
import { ProductCard } from './components/ProductCard';
import { Cart } from './components/Cart';
import { CrossSellBanner } from './components/CrossSellBanner';
import { GateModal } from './components/GateModal';
import { AuditTrail } from './components/AuditTrail';

// ── Phases ──────────────────────────────────────────────────
// 'browse'     — user can search and see catalog, no session yet
// 'processing' — agent is running (search → cart → crosssell → gates)
// 'crosssell'  — agent paused: cross-sell suggestion shown
// 'gate'       — agent paused: gate modal waiting for user Y/N
// 'success'    — payment completed
// 'failed'     — terminal failure
// 'abandoned'  — user said No at a gate
type AppPhase = 'browse' | 'processing' | 'crosssell' | 'gate' | 'success' | 'failed' | 'abandoned';

const SEARCH_SUGGESTIONS = [
  'water bottle under ₹500',
  'TurboSteel insulated bottle',
  'thermos for coffee',
  'stainless steel lunch box',
  'kids water bottle cheap',
  'premium copper vessel',
];

// ── Settings panel (email + cap) ─────────────────────────────
interface SettingsBarProps {
  userEmail: string;
  setUserEmail: (v: string) => void;
  spendingCap: string;
  setSpendingCap: (v: string) => void;
}

function SettingsBar({ userEmail, setUserEmail, spendingCap, setSpendingCap }: SettingsBarProps) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '10px 16px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📧 Email</span>
        <input
          className="form-input"
          type="email"
          placeholder="your@email.com (for receipt)"
          value={userEmail}
          onChange={e => setUserEmail(e.target.value)}
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>⚖️ Cap ₹</span>
        <input
          className="form-input"
          type="number"
          placeholder="2000"
          value={spendingCap}
          onChange={e => setSpendingCap(e.target.value)}
          style={{ padding: '6px 12px', fontSize: '0.8rem', width: 100 }}
        />
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Purchases above cap trigger Gate 4 consent
      </div>
    </div>
  );
}

export default function App() {
  // Settings (available before session starts)
  const [userEmail, setUserEmail] = useState('');
  const [spendingCap, setSpendingCap] = useState('2000');

  // Session (auto-created when user adds product to cart)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<AppPhase>('browse');

  // Search
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Agent / cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartTotal, setCartTotal] = useState(0);
  const [crossSellSuggestions, setCrossSellSuggestions] = useState<CrossSellSuggestion[]>([]);
  const [pendingGate, setPendingGate] = useState<string | null>(null);
  const [gatePrompt, setGatePrompt] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [reportText, setReportText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);

  // Audit trail
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const auditPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll audit trail while agent is active
  const pollAudit = useCallback(async (sid: string) => {
    try {
      const result = await api.getAuditTrail(sid);
      setAuditTrail(result.trail);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    if (sessionId && phase !== 'browse') {
      auditPollRef.current = setInterval(() => pollAudit(sessionId), 2000);
      return () => { if (auditPollRef.current) clearInterval(auditPollRef.current); };
    }
  }, [sessionId, phase, pollAudit]);

  // Recompute cart total
  useEffect(() => {
    setCartTotal(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  }, [cart]);

  // ── 1. Search catalog (browse phase — no session needed) ─────
  const handleSearch = async (q?: string) => {
    const searchQuery = (q || query).trim();
    if (!searchQuery) return;

    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      // For browsing, we hit /.well-known/catalog.json to get all products,
      // then do a lightweight client-side keyword filter.
      // Full vector search (Model A + Qdrant) fires when user adds to cart.
      const catalog = await api.getCatalog();
      const lower = searchQuery.toLowerCase();
      const tokens = lower.split(/\s+/).filter(t => t.length > 1);

      const filtered = catalog.filter(p => {
        const hay = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        return tokens.some(t => hay.includes(t));
      });

      setSearchResults(filtered.length > 0 ? filtered : catalog.slice(0, 10));
    } catch (e: unknown) {
      setSearchError((e as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  // ── 2. ADD TO CART — the trigger that starts the agent flow ──
  //
  // This is the key entry point:
  //   1. Create session (with user's email + spending cap)
  //   2. Call POST /api/search with the product name as query
  //      → backend runs: search → cart → crosssell → gate1
  //   3. Respond to whatever gate the agent pauses at
  //
  const handleAddToCart = async (product: Product) => {
    if (isAgentLoading || phase !== 'browse') return;

    setIsAgentLoading(true);
    setSearchError(null);
    setPhase('processing');

    try {
      // Step 1: Create session (auto, no user action required)
      const cap = parseFloat(spendingCap) || 2000;
      const session = await api.createSession(userEmail || undefined, cap);
      const sid = session.session_id;
      setSessionId(sid);

      // Step 2: Kick off the agent with a query targeting this specific product
      // Use product name + category as the search query for best Qdrant match
      const agentQuery = `${product.name} ${product.category.replace(/_/g, ' ')}`;
      const result = await api.search(sid, agentQuery);

      setCart(result.cart);
      setCrossSellSuggestions(result.cross_sell_suggestions);

      // Route based on where the agent paused
      await routeAgentResult(result, sid);

    } catch (e: unknown) {
      setSearchError((e as Error).message);
      setPhase('browse');
      setSessionId(null);
    } finally {
      setIsAgentLoading(false);
    }
  };

  // ── Helper: route the agent result to the correct UI phase ───
  const routeAgentResult = async (result: AgentFlowResponse, sid?: string) => {
    const activeSid = sid || sessionId;
    if (!activeSid) return;

    const pending = result.pending_gate;
    const status = result.terminal_status;

    if (pending === 'crosssell' && result.cross_sell_suggestions.length > 0) {
      setPhase('crosssell');
    } else if (pending && pending !== 'crosssell') {
      setPendingGate(pending);
      setGatePrompt(result.gate_prompt || '');
      setPhase('gate');
    } else if (status === 'completed') {
      if (result.report_text) setReportText(result.report_text);
      await pollAudit(activeSid);
      setPhase('success');
    } else if (status === 'abandoned') {
      await pollAudit(activeSid);
      setPhase('abandoned');
    } else if (status === 'failed') {
      setErrorMessage(result.error_message || 'Payment failed after maximum retries.');
      await pollAudit(activeSid);
      setPhase('failed');
    }
    if (result.retry_count !== undefined) setRetryCount(result.retry_count);
  };

  // ── 3. Cross-sell response ───────────────────────────────────
  const handleCrossSellAccept = async (productId: string) => {
    if (!sessionId) return;
    setIsAgentLoading(true);
    try {
      const result = await api.submitConsent(sessionId, 'crosssell', 'yes', productId);
      setCart(result.cart);
      setCrossSellSuggestions(result.cross_sell_suggestions);
      await routeAgentResult(result);
    } catch (e: unknown) {
      setSearchError((e as Error).message);
    } finally {
      setIsAgentLoading(false);
    }
  };

  const handleCrossSellDecline = async () => {
    if (!sessionId) return;
    setIsAgentLoading(true);
    try {
      const result = await api.submitConsent(sessionId, 'crosssell', 'no');
      setCart(result.cart);
      await routeAgentResult(result);
    } catch (e: unknown) {
      setSearchError((e as Error).message);
    } finally {
      setIsAgentLoading(false);
    }
  };

  // ── 4. Gate consent ─────────────────────────────────────────
  const handleConsent = async (decision: 'yes' | 'no') => {
    if (!sessionId || !pendingGate) return;
    setIsAgentLoading(true);
    setPhase('processing');

    try {
      const result = await api.submitConsent(sessionId, pendingGate, decision);
      setCart(result.cart);
      setCrossSellSuggestions(result.cross_sell_suggestions);
      setPendingGate(null);
      await routeAgentResult(result);
    } catch (e: unknown) {
      setSearchError((e as Error).message);
      setPhase('browse');
    } finally {
      setIsAgentLoading(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────
  const handleReset = () => {
    if (auditPollRef.current) clearInterval(auditPollRef.current);
    setPhase('browse');
    setSessionId(null);
    setCart([]);
    setAuditTrail([]);
    setCrossSellSuggestions([]);
    setPendingGate(null);
    setReportText(null);
    setErrorMessage(null);
    setRetryCount(0);
    setSearchError(null);
  };

  // ── Computed ────────────────────────────────────────────────
  const isActive = phase !== 'browse';
  const showSidebar = isActive || auditTrail.length > 0 || cart.length > 0;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="app-layout" style={!showSidebar ? { gridTemplateColumns: '1fr' } : {}}>

      {/* ── Header ── */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🤖</div>
          <div className="logo-text">CommerceOps</div>
          <div className="logo-badge">AI Agent</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {sessionId && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Session: <code style={{ color: 'var(--accent-light)', fontFamily: 'JetBrains Mono' }}>
                {sessionId.slice(0, 8)}…
              </code>
            </div>
          )}
          {isActive && (
            <button className="btn btn-secondary btn-sm" onClick={handleReset}>
              ↩ New Session
            </button>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="app-main">

        {/* Settings bar — always visible in browse phase */}
        {!isActive && (
          <SettingsBar
            userEmail={userEmail}
            setUserEmail={setUserEmail}
            spendingCap={spendingCap}
            setSpendingCap={setSpendingCap}
          />
        )}

        {/* Search bar */}
        {(phase === 'browse' || phase === 'processing') && (
          <div className="search-section">
            <div className="search-container">
              <span className="search-icon">🔍</span>
              <input
                className="search-input"
                type="text"
                placeholder="e.g. 'water bottle under ₹500' or 'TurboSteel insulated 750ml'"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                disabled={isSearching || phase === 'processing'}
              />
              <button
                className="search-btn"
                id="search-submit-btn"
                onClick={() => handleSearch()}
                disabled={isSearching || !query.trim() || phase === 'processing'}
              >
                {isSearching ? <span className="loading-spinner" /> : '✨'}
                <span>Search</span>
              </button>
            </div>

            <div className="search-suggestions">
              {SEARCH_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="suggestion-chip"
                  onClick={() => { setQuery(s); handleSearch(s); }}
                  disabled={isSearching || phase === 'processing'}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {phase === 'processing' && (
          <div className="thinking-indicator">
            <div className="thinking-dots">
              <div className="thinking-dot" />
              <div className="thinking-dot" />
              <div className="thinking-dot" />
            </div>
            <span>AI agent is working… running vector search, checking cross-sell, evaluating gates</span>
          </div>
        )}

        {/* Errors */}
        {searchError && (
          <div className="status-banner error">
            <span className="status-icon">⚠️</span>
            <div>
              <div style={{ fontWeight: 600 }}>Error</div>
              <div style={{ fontSize: '0.85rem' }}>{searchError}</div>
            </div>
          </div>
        )}

        {/* Cross-sell banner */}
        {phase === 'crosssell' && crossSellSuggestions.length > 0 && (
          <>
            <div className="status-banner info" style={{ marginBottom: 0 }}>
              <span className="status-icon">🛒</span>
              <span>
                <strong>{cart[0]?.name}</strong> added to cart. Check this out before we proceed:
              </span>
            </div>
            <CrossSellBanner
              suggestions={crossSellSuggestions}
              onAccept={handleCrossSellAccept}
              onDecline={handleCrossSellDecline}
              isLoading={isAgentLoading}
            />
          </>
        )}

        {/* Browse — search results */}
        {phase === 'browse' && searchResults.length > 0 && (
          <div className="products-section">
            <div className="section-header">
              <span className="section-title">Search Results</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Click "Add to Cart" to start the AI agent
              </span>
            </div>
            <div className="products-grid">
              {searchResults.map((product, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  rank={i + 1}
                  onAddToCart={() => handleAddToCart(product)}
                  addToCartLoading={isAgentLoading}
                />
              ))}
            </div>
          </div>
        )}

        {/* Browse — empty state */}
        {phase === 'browse' && !hasSearched && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '4rem', marginBottom: 16 }}>🤖</div>
            <h1 style={{ fontSize: '1.75rem', marginBottom: 8, background: 'linear-gradient(135deg, var(--text-primary), var(--accent-light))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AI Agentic Commerce
            </h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto 24px', lineHeight: 1.7 }}>
              Search for a product, then click <strong style={{ color: 'var(--accent-light)' }}>Add to Cart</strong>.
              The AI agent will automatically handle cross-sell suggestions, spending cap checks,
              payment, and send you a receipt — with every decision explained in the audit log.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {['🫗 Bottles', '☕ Thermos', '🍱 Lunch Boxes', '🧹 Cleaners', '💧 Filters'].map(tag => (
                <span key={tag} style={{
                  padding: '6px 14px',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent-light)',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.8rem',
                  border: '1px solid var(--border)',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Success receipt */}
        {phase === 'success' && (
          <div className="receipt-card">
            <div className="receipt-header">
              <div className="receipt-success-icon">🎉</div>
              <div className="receipt-title">Payment Successful!</div>
              <div className="receipt-subtitle">Your AI agent completed the transaction</div>
            </div>

            {reportText && (
              <div className="receipt-summary">{reportText}</div>
            )}

            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Final Cart
              </div>
              {cart.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.name} ×{item.quantity}</span>
                  <span style={{ fontWeight: 600 }}>₹{(item.price * item.quantity).toLocaleString('en-IN')}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 10, fontWeight: 700, fontSize: '1rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Paid</span>
                <span style={{ color: 'var(--success)' }}>₹{cartTotal.toLocaleString('en-IN')}</span>
              </div>
            </div>

            {userEmail && (
              <div className="status-banner success" style={{ marginBottom: 16 }}>
                <span>📧</span>
                <span>Receipt sent to {userEmail}</span>
              </div>
            )}

            <div className="new-session-btn">
              <button className="btn btn-primary" onClick={handleReset}>
                Start New Session
              </button>
            </div>
          </div>
        )}

        {/* Abandoned / Failed */}
        {(phase === 'abandoned' || phase === 'failed') && (
          <div className={`status-banner ${phase === 'abandoned' ? 'warning' : 'error'}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="status-icon">{phase === 'abandoned' ? '🚫' : '❌'}</span>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {phase === 'abandoned' ? 'Session Abandoned' : 'Payment Failed'}
                </div>
                <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                  {phase === 'abandoned'
                    ? 'You declined the purchase. Logged as abandoned in the audit trail.'
                    : errorMessage || 'Payment failed after maximum retry attempts.'}
                </div>
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleReset}>
              ↩ Start Over
            </button>
          </div>
        )}

      </main>

      {/* ── Sidebar (shown once agent is active) ── */}
      {showSidebar && (
        <aside className="app-sidebar">
          <Cart cart={cart} cartTotal={cartTotal} />
          <AuditTrail trail={auditTrail} isLive={isActive} />
        </aside>
      )}

      {/* ── Gate Modal (blocks UI until user responds) ── */}
      {phase === 'gate' && pendingGate && (
        <GateModal
          gate={pendingGate}
          prompt={gatePrompt}
          cart={cart}
          cartTotal={cartTotal}
          retryCount={retryCount}
          onYes={() => handleConsent('yes')}
          onNo={() => handleConsent('no')}
          isLoading={isAgentLoading}
        />
      )}
    </div>
  );
}
