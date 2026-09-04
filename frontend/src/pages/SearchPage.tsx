import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Product, CartItem, CrossSellSuggestion, AgentFlowResponse } from '../api/client';

import { useAuth } from '../context/AuthContext';

/* ── Emoji map ─────────────────────────────────────────────── */
const EMOJI: Record<string, string> = {
  water_bottles:'💧', thermos:'☕', lunch_boxes:'🍱', mugs:'🫖',
  cleaning:'🧴', filters:'🔬', accessories:'🎒', bundles:'📦', default:'🛒',
};
const emj = (cat?: string) => EMOJI[cat || ''] || EMOJI.default;

/* Strip markdown bold/italic from AI-generated text */
function cleanText(t: string): string {
  return t
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .trim();
}

type Phase = 'idle' | 'browsing' | 'processing' | 'gate' | 'crosssell'
           | 'success' | 'abandoned' | 'failed';

/* ── AGENT STAGES definition ──────────────────────────────── */
const STAGES = [
  { id: 'parse',    icon: '🔍', label: 'Parsing Query',    auditKeys: ['parse_query','search','search_products'] },
  { id: 'cart',     icon: '🛒', label: 'Building Cart',    auditKeys: ['add_to_cart','cart'] },
  { id: 'xsell',   icon: '💡', label: 'Cross-sell Check', auditKeys: ['crosssell','crosssell_check'] },
  { id: 'gate1',   icon: '🔑', label: 'Gate 1 — Interest', auditKeys: ['gate1','interest_gate'] },
  { id: 'gate2',   icon: '💰', label: 'Gate 2 — Cap Check', auditKeys: ['gate2','cap_gate'] },
  { id: 'payment', icon: '💳', label: 'Gate 3 — Payment',  auditKeys: ['payment','gate3','payment_gate'] },
  { id: 'report',  icon: '📋', label: 'Order Confirmed',   auditKeys: ['report','final_report'] },
];

// Stage order mirrors the agent flow:
// parse(0) → cart(1) → xsell(2) → gate1(3) → gate2(4) → payment(5) → report(6)
const STAGE_ORDER = ['parse','cart','xsell','gate1','gate2','payment','report'];

function getStageStatus(
  stageId: string,
  phase: Phase,
  pendingGate: string | null,
  highWater: number,  // -1 = initial (parse+cart active); ≥0 = last completed stage idx
): 'done' | 'active' | 'waiting' | 'pending' {
  const idx = STAGE_ORDER.indexOf(stageId);

  // All done
  if (phase === 'success') return 'done';

  // Not started
  if (phase === 'idle' || phase === 'browsing') return 'pending';

  // Between-gate processing: use highWater to show accumulated progress
  if (phase === 'processing') {
    if (highWater < 0) {
      // Initial run — before any gate has been approved
      if (stageId === 'parse' || stageId === 'cart') return 'active';
      return 'pending';
    }
    // Stages up to last approved gate: done
    if (idx <= highWater) return 'done';
    // Very next stage: actively processing toward it
    if (idx === highWater + 1) return 'active';
    return 'pending';
  }

  // Cross-sell dialog open: parse + cart done, xsell active
  if (phase === 'crosssell') {
    if (idx < 2)   return 'done';
    if (idx === 2) return 'active';
    return 'pending';
  }

  // Gate dialog open: stages before the current gate done, current 'waiting'
  if (phase === 'gate') {
    const gateMap: Record<string, number> = {
      gate1: 3, gate2: 4, gate3: 5, gate4: 5,
    };
    const waitingIdx = gateMap[pendingGate || ''] ?? 3;
    if (idx < waitingIdx)   return 'done';
    if (idx === waitingIdx) return 'waiting';
    return 'pending';
  }

  return 'pending';
}

/* ── SUB-COMPONENTS ────────────────────────────────────────── */

function ProductCard({ product, onAdd, badge }: { product: Product; onAdd: (p: Product) => void; badge?: string }) {
  const nav = useNavigate();
  return (
    <div className="product-card">
      <div className="product-card__img" onClick={() => nav(`/product/${product.id}`)}>
        <span className="product-card__emoji">{emj(product.category)}</span>
        {badge && <span className="product-card__badge">{badge}</span>}
        {product.stock <= 10 && (
          <span className="product-card__badge-red">Low Stock</span>
        )}
      </div>
      <div className="product-card__body">
        <div className="product-card__category">{product.category.replace(/_/g,' ')}</div>
        <div className="product-card__name">{product.name}</div>
        <div className="product-card__desc">{product.description}</div>
      </div>
      <div className="product-card__footer">
        <div>
          <div className="product-card__price">₹{product.price.toLocaleString('en-IN')}</div>
          <div className="product-card__stock">{product.stock} in stock</div>
        </div>
        <button
          id={`add-${product.id}`}
          className="btn btn-gold btn-sm"
          onClick={e => { e.stopPropagation(); onAdd(product); }}
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
}

function ComboCard({ product, onAdd }: { product: Product; onAdd: (p: Product) => void }) {
  const savings = (product.original_total && product.combo_price)
    ? product.original_total - product.combo_price : 0;
  return (
    <div className="combo-card" onClick={() => onAdd(product)}>
      <div className="combo-tag">🎁 Combo Deal</div>
      <div className="combo-name">{product.combo_label || product.name}</div>
      <div className="combo-desc">{product.name} + {product.combo_with_name || 'companion item'}</div>
      <div className="combo-pricing">
        {product.original_total && (
          <span className="combo-original">₹{product.original_total.toLocaleString('en-IN')}</span>
        )}
        <span className="combo-price">₹{(product.combo_price || product.price).toLocaleString('en-IN')}</span>
        {savings > 0 && <span className="combo-save">Save ₹{savings}</span>}
      </div>
      <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}>
        Buy Combo →
      </button>
    </div>
  );
}

/* Inline cart items panel (left column) */
function CartItems({ cart }: { cart: CartItem[] }) {
  const total = cart.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="delivery-banner">🚚 Free delivery · Arrives in 2–5 business days</div>

      <div className="cart-panel">
        <div className="cart-group-header">
          <span>{cart.length} Item{cart.length !== 1 ? 's' : ''} in Cart</span>
          <span>₹{total.toLocaleString('en-IN')} total</span>
        </div>
        {cart.map((item, i) => (
          <div key={item.id || i} className="cart-row">
            <div className="cart-row__emoji">{emj(item.category)}</div>
            <div className="cart-row__info">
              <div className="cart-row__name">{item.name}</div>
              <div className="cart-row__meta">Category: {(item.category || '').replace(/_/g,' ')}</div>
              <div className="cart-row__qty">Qty: {item.quantity || 1}</div>
            </div>
            <div className="cart-row__price">₹{item.price.toLocaleString('en-IN')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Order summary card (right column — initial state before agent starts) */
function OrderSummary({
  cart, onStartPurchase, isLoading,
}: { cart: CartItem[]; onStartPurchase: () => void; isLoading: boolean }) {
  const subtotal = cart.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax;
  return (
    <div className="order-summary">
      <div className="order-summary__header">Order Summary</div>
      <div className="order-summary__body">
        <div className="order-summary__row">
          <span>Subtotal ({cart.length} item{cart.length !== 1 ? 's' : ''})</span>
          <span className="order-summary__val">₹{subtotal.toLocaleString('en-IN')}</span>
        </div>
        <div className="order-summary__row">
          <span>Delivery</span>
          <span className="order-summary__val-free">Free</span>
        </div>
        <div className="order-summary__row">
          <span>GST (18%)</span>
          <span className="order-summary__val">₹{tax.toLocaleString('en-IN')}</span>
        </div>
        <div className="order-summary__row order-summary__row--total">
          <span>Total</span>
          <span className="val">₹{total.toLocaleString('en-IN')}</span>
        </div>
      </div>
      <div className="order-summary__footer">
        <button
          id="start-purchase-btn"
          className="btn btn-gold btn-full btn-lg"
          onClick={onStartPurchase}
          disabled={isLoading || cart.length === 0}
        >
          {isLoading ? (
            <><span className="spinner spinner-sm" /> Processing…</>
          ) : 'Continue to Checkout →'}
        </button>
      </div>
      <div className="payment-methods">
        <span className="payment-chip">🔒 Razorpay</span>
        <span className="payment-chip">VISA</span>
        <span className="payment-chip">Mastercard</span>
        <span className="payment-chip">UPI</span>
      </div>
    </div>
  );
}

/* Agent stages panel (right column — while agent is running) */
function AgentStagesPanel({
  phase, pendingGate, stageHighWater,
}: { phase: Phase; pendingGate: string | null; stageHighWater: number }) {
  const statusLabel: Record<string, string> = {
    done: 'Completed ✓', active: 'Running…',
    waiting: 'Your decision needed', pending: 'Queued',
  };
  return (
    <div className="agent-panel-inline">
      <div className="agent-panel-inline__header">
        {phase === 'processing' && <><span className="spinner spinner-sm" /> AI Agent Running</>}
        {phase === 'gate'       && <><span>🔑</span> Awaiting Your Decision</>}
        {phase === 'crosssell'  && <><span>💡</span> Suggestions Ready</>}
      </div>
      <div className="agent-panel-inline__body">
        {STAGES.map(s => {
          const status = getStageStatus(s.id, phase, pendingGate, stageHighWater);
          return (
            <div key={s.id} className={`stage-step ${status}`}>
              <div className="stage-step__icon">
                {status === 'done'   ? '✓' :
                 status === 'active' ? <span className="spinner spinner-sm" /> :
                 status === 'waiting'? '⏳' :
                 s.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div className="stage-step__label">{s.label}</div>
              </div>
              <div className="stage-step__status">{statusLabel[status]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Professional receipt (right column — on success) */
function ReceiptPanel({
  cart, sessionId, userEmail, onClose,
}: { cart: CartItem[]; sessionId: string | null; userEmail: string; onClose: () => void }) {
  const subtotal = cart.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax;
  const orderId = `ORD-${(sessionId || 'DEMO').slice(0, 8).toUpperCase()}`;
  const date = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

  return (
    <div className="receipt-card animate-slide">
      {/* Header */}
      <div className="receipt-card__header">
        <div className="receipt-card__tick">✅</div>
        <div className="receipt-card__title">Order Confirmed!</div>
        <div className="receipt-card__subtitle">Receipt sent to {userEmail}</div>
      </div>

      {/* Meta */}
      <div className="receipt-meta">
        <div className="receipt-meta__row">
          <span className="receipt-meta__label">Order ID</span>
          <span className="receipt-meta__value">{orderId}</span>
        </div>
        <div className="receipt-meta__row">
          <span className="receipt-meta__label">Date</span>
          <span className="receipt-meta__value">{date}</span>
        </div>
        <div className="receipt-meta__row">
          <span className="receipt-meta__label">Payment</span>
          <span className="receipt-meta__value">Razorpay Test Mode</span>
        </div>
        <div className="receipt-meta__row">
          <span className="receipt-meta__label">Status</span>
          <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 12 }}>PAID ✓</span>
        </div>
      </div>

      {/* Items */}
      <table className="receipt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {cart.map((item, i) => (
            <tr key={i}>
              <td>
                <span>{emj(item.category)}</span>
                <span>{item.name}</span>
              </td>
              <td style={{ textAlign: 'right', padding: '12px 16px' }}>×{item.quantity || 1}</td>
              <td>₹{item.price.toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="receipt-totals">
        <div className="receipt-total-row">
          <span>Subtotal</span>
          <span>₹{subtotal.toLocaleString('en-IN')}</span>
        </div>
        <div className="receipt-total-row">
          <span>Shipping</span>
          <span style={{ color: 'var(--success)' }}>Free</span>
        </div>
        <div className="receipt-total-row">
          <span>GST (18%)</span>
          <span>₹{tax.toLocaleString('en-IN')}</span>
        </div>
        <div className="receipt-total-row grand">
          <span>Total Paid</span>
          <span className="amt">₹{total.toLocaleString('en-IN')}</span>
        </div>
      </div>

      <div className="receipt-footer">
        <div>Thank you for shopping with AsklyCart · Powered by Razorpay</div>
        <div style={{ marginTop: 6 }}>This transaction was processed by AI agent with your explicit approval</div>
        <button
          id="receipt-done-btn"
          className="btn btn-dark btn-full"
          style={{ marginTop: 14 }}
          onClick={onClose}
        >
          Back to Shopping →
        </button>
      </div>
    </div>
  );
}

/* ── GATE DIALOG ────────────────────────────────────────────── */
function GateDialog({
  phase, pendingGate, cart, crossSells, gatePrompt, retryCount,
  onConsent, onClose,
}: {
  phase: Phase; pendingGate: string | null; cart: CartItem[];
  crossSells: CrossSellSuggestion[]; gatePrompt: string;
  retryCount: number; onConsent: (d: 'yes'|'no', pid?: string) => void;
  onClose: () => void;
}) {
  const total = cart.reduce((s, i) => s + i.price * (i.quantity || 1), 0);
  const GATE_INFO: Record<string, { icon: string; title: string; desc: string }> = {
    gate1: { icon:'🛒', title:'Confirm Interest', desc:'Gate 1 of 3 — Interest Check' },
    gate2: { icon:'💰', title:'Spending Cap Review', desc:'Gate 2 of 3 — Cap Verification' },
    gate3: { icon:'💳', title:'Authorise Payment', desc:'Gate 3 of 3 — Payment' },
    gate4: { icon:'⚠️', title:'Over-Cap Approval', desc:'Manual override required' },
  };
  const info = GATE_INFO[pendingGate || ''] || { icon:'🤖', title:'Agent Decision', desc:'' };

  if (phase === 'crosssell') return (
    <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-wide animate-slide">
        <div className="dialog__top">
          <div className="dialog__icon">✨</div>
          <div>
            <div className="dialog__heading">Frequently Bought Together</div>
            <div className="dialog__sub">Add these items to your cart before checkout?</div>
          </div>
          <button className="dialog__close" onClick={() => onConsent('no')}>✕</button>
        </div>

        {/* Mini stage progress — crosssell is step 3, search+cart done */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 24px', borderBottom: '1px solid var(--border)',
        }}>
          {[
            { label: 'Search', done: true },
            { label: 'Cart',   done: true },
            { label: 'Deals',  active: true },
            { label: 'Gate 1', done: false },
            { label: 'Gate 2', done: false },
            { label: 'Pay',    done: false },
            { label: 'Done',   done: false },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', flex: i < arr.length - 1 ? 1 : 0, minWidth: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: s.done ? 'var(--success)' : (s as any).active ? 'var(--gold)' : 'var(--bg-2)',
                  border: `2px solid ${s.done ? 'var(--success)' : (s as any).active ? 'var(--gold)' : 'var(--border)'}`,
                  color: s.done ? '#fff' : (s as any).active ? '#000' : 'var(--text-3)',
                }}>
                  {s.done ? '✓' : (s as any).active ? '💡' : '·'}
                </div>
                <div style={{ fontSize: 8, color: s.done ? 'var(--success)' : (s as any).active ? 'var(--gold)' : 'var(--text-3)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {s.label}
                </div>
              </div>
              {i < arr.length - 1 && (
                <div style={{ flex: 1, height: 2, marginBottom: 13, background: s.done ? 'var(--success)' : 'var(--border)' }} />
              )}
            </div>
          ))}
        </div>

        <div className="dialog__body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {crossSells.slice(0, 3).map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg-2)',
              }}>
                <div style={{ fontSize: 28 }}>{emj(s.product?.category)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--gold)', marginBottom: 2 }}>
                    {s.type?.replace(/_/g,' ')}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.product?.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {s.combo_price ? `Combo: ₹${s.combo_price.toLocaleString('en-IN')}` : `₹${s.product?.price?.toLocaleString('en-IN')}`}
                  </div>
                </div>
                <button
                  id={`add-crosssell-${i}`}
                  className="btn btn-gold btn-sm"
                  onClick={() => onConsent('yes', s.product?.id)}
                  style={{ flexShrink: 0 }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog__actions">
          <button className="btn btn-outline btn-full" onClick={() => onConsent('no')}>
            Skip — Continue to Checkout
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'gate') {
    /* Determine which stages are "done" based on which gate we're currently at */
    const gateOrder = ['gate1', 'gate2', 'gate3', 'gate4'];
    const currentGateIdx = gateOrder.indexOf(pendingGate || '');

    const MINI_STAGES = [
      { key: 'search', label: 'Search',   icon: '🔍' },
      { key: 'cart',   label: 'Cart',     icon: '🛒' },
      { key: 'deals',  label: 'Deals',    icon: '💡' },
      { key: 'gate1',  label: 'Gate 1',   icon: '🔑' },
      { key: 'gate2',  label: 'Gate 2',   icon: '💰' },
      { key: 'pay',    label: 'Pay',      icon: '💳' },
      { key: 'done',   label: 'Done',     icon: '✅' },
    ];

    const getStepState = (key: string): 'done' | 'active' | 'pending' => {
      const earlyDone = ['search', 'cart', 'deals'];
      if (earlyDone.includes(key)) return 'done';
      if (key === 'gate1') {
        if (pendingGate === 'gate1') return 'active';
        return 'done'; // gate1 done if we're at gate2+
      }
      if (key === 'gate2') {
        if (pendingGate === 'gate2') return 'active';
        if (currentGateIdx > 1) return 'done';
        return 'pending';
      }
      if (key === 'pay') {
        if (pendingGate === 'gate3' || pendingGate === 'gate4') return 'active';
        return 'pending';
      }
      return 'pending';
    };

    return (
      <div className="dialog-overlay" onClick={e => e.target === e.currentTarget && onConsent('no')}>
        <div className="dialog animate-slide">
          {/* Dialog header */}
          <div className="dialog__top">
            <div className="dialog__icon">{info.icon}</div>
            <div>
              <div className="dialog__heading">{info.title}</div>
              <div className="dialog__sub">{info.desc}</div>
            </div>
          </div>

          {/* ── Mini stage progress bar ── */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '14px 24px', borderBottom: '1px solid var(--border)',
            overflowX: 'auto', gap: 0,
          }}>
            {MINI_STAGES.map((step, i) => {
              const state = getStepState(step.key);
              const isLast = i === MINI_STAGES.length - 1;
              return (
                <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1, minWidth: 0 }}>
                  {/* Step dot */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: state === 'done' ? 13 : 12,
                      fontWeight: 700,
                      background: state === 'done'  ? 'var(--success)'     :
                                  state === 'active' ? 'var(--gold)'        : 'var(--bg-2)',
                      border: `2px solid ${
                        state === 'done'   ? 'var(--success)'  :
                        state === 'active' ? 'var(--gold)'     : 'var(--border)'
                      }`,
                      color: state === 'done' ? '#fff' : state === 'active' ? '#000' : 'var(--text-3)',
                      transition: 'all 0.3s',
                    }}>
                      {state === 'done' ? '✓' : state === 'active' ? step.icon : '·'}
                    </div>
                    <div style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: 0.3,
                      color: state === 'active' ? 'var(--gold)' : state === 'done' ? 'var(--success)' : 'var(--text-3)',
                      textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>
                      {step.label}
                    </div>
                  </div>
                  {/* Connector line */}
                  {!isLast && (
                    <div style={{
                      flex: 1, height: 2, marginBottom: 16,
                      background: state === 'done' ? 'var(--success)' : 'var(--border)',
                      transition: 'background 0.3s',
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="dialog__body">
            {/* Cart snapshot */}
            {cart.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {cart.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: i < cart.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontSize: 14 }}>
                      <span style={{ marginRight: 8 }}>{emj(item.category)}</span>{item.name}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 14 }}>
                      ₹{item.price.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontWeight: 800, fontSize: 15 }}>
                  <span>Cart Total</span>
                  <span style={{ color: 'var(--gold)' }}>₹{total.toLocaleString('en-IN')}</span>
                </div>
              </div>
            )}

            {/* Agent prompt */}
            <div className="dialog__prompt">{gatePrompt || 'The AI agent is requesting your approval to proceed.'}</div>

            {retryCount > 0 && (
              <div className="alert alert-info" style={{ marginBottom: 16 }}>
                Retry attempt {retryCount} of 2
              </div>
            )}
          </div>
          <div className="dialog__actions">
            <button id={`yes-${pendingGate}`} className="btn btn-gold" style={{ flex: 1 }} onClick={() => onConsent('yes')}>
              ✓ Yes, Proceed
            </button>
            <button id={`no-${pendingGate}`} className="btn btn-outline" style={{ flex: 1 }} onClick={() => onConsent('no')}>
              ✕ Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'abandoned') return (
    <div className="dialog-overlay">
      <div className="dialog animate-slide" style={{ maxWidth: 380 }}>
        <div style={{ padding: '40px 36px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
          <h3 style={{ marginBottom: 8 }}>Order Cancelled</h3>
          <p style={{ marginBottom: 24 }}>You declined the purchase. No charges were made.</p>
          <button className="btn btn-gold btn-full" onClick={onClose}>Browse More Products</button>
        </div>
      </div>
    </div>
  );

  if (phase === 'failed') return (
    <div className="dialog-overlay">
      <div className="dialog animate-slide" style={{ maxWidth: 420 }}>
        <div className="dialog__top">
          <div className="dialog__icon" style={{ background: 'var(--error-bg)', borderColor: 'rgba(220,38,38,.3)' }}>❌</div>
          <div>
            <div className="dialog__heading">Payment Failed</div>
            <div className="dialog__sub">All retry attempts exhausted</div>
          </div>
        </div>
        <div className="dialog__body">
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            Maximum payment retries reached. The pipeline has been automatically declined and no charges were made.
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, background: 'var(--bg-2)', borderRadius: 8, padding: '12px 14px' }}>
            <strong>What happened?</strong><br />
            The payment gateway could not process your transaction after {retryCount} attempt{retryCount !== 1 ? 's' : ''}. The session has been closed for security reasons. You can start a fresh purchase from the search page.
          </div>
        </div>
        <div className="dialog__actions" style={{ flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-gold btn-full" onClick={onClose}>
            🔍 Back to Search
          </button>
          <button className="btn btn-outline btn-full" style={{ fontSize: 13 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return null;
}

/* ── MAIN SEARCH PAGE ──────────────────────────────────────── */
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isLoggedIn } = useAuth();

  const query = searchParams.get('q') || '';
  const [input, setInput] = useState(query);

  /* Browse state */
  const [matched, setMatched] = useState<Product[]>([]);
  const [combos, setCombos]   = useState<Product[]>([]);
  const [related, setRelated] = useState<Product[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');

  /* Checkout / agent state */
  const [phase, setPhase]           = useState<Phase>('idle');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cart, setCart]             = useState<CartItem[]>([]);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [pendingGate, setPendingGate] = useState<string | null>(null);
  const [gatePrompt, setGatePrompt] = useState('');
  const [crossSells, setCrossSells] = useState<CrossSellSuggestion[]>([]);
  /* stageHighWater: tracks the furthest stage reached so the panel shows real progress.
     -1 = initial (parse+cart running), ≥0 = last completed stage index in STAGE_ORDER */
  const [stageHighWater, setStageHighWater] = useState(-1);
  const [reportText, setReportText] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [agentStarted, setAgentStarted] = useState(false);

  const checkoutRef = useRef<HTMLDivElement>(null);

  /* ── Browse products ─────────────────────────────────────── */
  const doBrowse = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setBrowsing(true); setBrowseError('');
    setMatched([]); setCombos([]); setRelated([]);
    try {
      const res = await api.searchProducts(q);
      setMatched(res.matched || []);
      setCombos(res.combo_matches || []);
      setRelated(res.related_alternatives || []);
    } catch (e: unknown) {
      setBrowseError((e as Error).message || 'Search failed');
    } finally {
      setBrowsing(false);
    }
  }, []);

  useEffect(() => { if (query) doBrowse(query); }, [query]);

  const handleSearch = () => {
    const q = input.trim();
    if (!q) return;
    setSearchParams({ q });
    /* Reset checkout */
    setCheckoutOpen(false); setAgentStarted(false);
    setCart([]); setPhase('idle'); setSessionId(null);
  };

  /* ── Route agent result ──────────────────────────────────── */
  const routeResult = useCallback(async (res: AgentFlowResponse) => {
    if (res.cart) setCart(res.cart);
    if (res.cross_sell_suggestions) setCrossSells(res.cross_sell_suggestions);

    // Gate waiting: backend sets pending_gate to a non-null value (gate1/gate2/gate3/gate4)
    if (res.pending_gate) {
      setPendingGate(res.pending_gate);
      setGatePrompt(res.gate_prompt || '');
      setPhase('gate');
      return;
    }
    // Cross-sell: only show if there are suggestions AND the flow is still in-progress
    // (not terminal). Explicitly exclude ALL terminal statuses.
    const isTerminal = ['completed', 'abandoned', 'failed', 'payment_failed'].includes(
      res.terminal_status ?? ''
    );
    if (
      !res.pending_gate &&
      !isTerminal &&
      res.cross_sell_suggestions &&
      res.cross_sell_suggestions.length > 0
    ) {
      setPhase('crosssell');
      return;
    }
    if (res.terminal_status === 'completed') {
      setReportText(cleanText(res.report_text || ''));
      setPhase('success');
      /* Persist order to DB */
      if (isLoggedIn && res.cart?.length) {
        const completedCart = res.cart;
        const activeSid = res.session_id || sessionId;
        api.createOrder({
          session_id: activeSid,
          items: completedCart.map(i => ({
            id: i.id, name: i.name, price: i.price,
            quantity: i.quantity || 1, category: i.category,
          })),
          total: completedCart.reduce((s, i) => s + i.price * (i.quantity || 1), 0),
          status: 'completed',
        }).catch(err => console.error('[createOrder] failed:', err));
        /* Clear persistent cart */
        api.clearCart().catch(err => console.error('[clearCart] failed:', err));
      }
      return;
    }
    if (res.terminal_status === 'abandoned') { setPhase('abandoned'); return; }
    // Backend sets terminal_status: 'failed' (not 'payment_failed')
    if (res.terminal_status === 'failed') { setPhase('failed'); return; }
  }, [isLoggedIn, sessionId]);

  /* ── Add to cart → start agent ───────────────────────────── */
  const handleAddToCart = async (product: Product) => {
    if (!isLoggedIn) {
      window.location.href = '/auth';
      return;
    }
    /* Show checkout section immediately */
    setCheckoutOpen(true);
    setAgentStarted(false);
    setCart([{ id: product.id, name: product.name, price: product.price, quantity: 1, category: product.category }]);

    setTimeout(() => checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    /* Persist cart item to DB (fire-and-forget) */
    api.addToCart({
      product_id: product.id, product_name: product.name,
      product_price: product.price, product_category: product.category, quantity: 1,
    }).catch(err => console.error('[addToCart] failed:', err));

  };

  /* ── Start purchase (agent) ──────────────────────────────── */
  const startPurchase = async () => {
    if (!cart.length) return;
    setAgentStarted(true);
    setPhase('processing');
    setStageHighWater(-1); setRetryCount(0);
    const product = { id: cart[0].id, name: cart[0].name };
    try {
      const res = await api.startAgentFlow(cart[0].name, user?.email, user?.spending_cap);
      if (res.session_id) setSessionId(res.session_id);
      await routeResult(res);
    } catch (e: unknown) {
      setPhase('failed');
    }
  };

  /* ── Handle consent ──────────────────────────────────────── */
  const handleConsent = async (decision: 'yes' | 'no', pid?: string) => {
    if (!sessionId) return;
    const gate = phase === 'crosssell' ? 'crosssell' : pendingGate!;

    // Advance stage high water mark before the API call so the panel
    // immediately shows accumulated progress during the processing phase.
    const gateHighWaterMap: Record<string, number> = {
      crosssell: 2,   // xsell(2) done, gate1(3) is next
      gate1:     3,   // gate1(3) done, gate2(4) is next
      gate2:     4,   // gate2(4) done, payment(5) is next
      gate4:     4,   // over-cap (same progress slot as gate2)
      gate3:     5,   // payment(5) done, report(6) is next
    };
    const hw = gateHighWaterMap[gate];
    if (hw !== undefined) setStageHighWater(prev => Math.max(prev, hw));

    setPhase('processing');
    setPendingGate(null);
    try {
      const res = await api.submitConsent(sessionId, gate, decision, pid);
      setCart(res.cart || []);
      setCrossSells(res.cross_sell_suggestions || []);
      setPendingGate(null);
      if (decision === 'no' && gate !== 'crosssell') {
        setPhase('abandoned'); return;
      }
      await routeResult(res);
    } catch (e: unknown) {
      setPhase('failed');
    }
  };

  /* ── Close / reset ──────────────────────────────────────── */
  const handleClose = () => {
    setPhase('idle'); setSessionId(null);
    setCheckoutOpen(false); setAgentStarted(false);
    setCart([]); setStageHighWater(-1); setReportText('');
    if (query) doBrowse(query);
  };

  const showGateDialog = ['gate','crosssell','abandoned','failed'].includes(phase);

  return (
    <>
      {/* ── Gate / crosssell / terminal dialogs ─────────────── */}
      {showGateDialog && (
        <GateDialog
          phase={phase}
          pendingGate={pendingGate}
          cart={cart}
          crossSells={crossSells}
          gatePrompt={gatePrompt}
          retryCount={retryCount}
          onConsent={handleConsent}
          onClose={handleClose}
        />
      )}

      <main className="page-wrap">
        <div className="container" style={{ paddingTop: 24, paddingBottom: 80 }}>

          {/* ── Search bar ──────────────────────────────────── */}
          <div className="search-wrap">
            <div className="search-bar">
              <input
                id="search-input"
                placeholder='Search products… e.g. "insulated bottle under ₹500"'
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button id="search-btn" className="btn btn-gold btn-sm search-btn" onClick={handleSearch}>
                Search
              </button>
            </div>
          </div>

          {/* Loading */}
          {browsing && (
            <div className="loading-state">
              <div className="spinner spinner-lg" />
              <p>Searching with AI…</p>
            </div>
          )}

          {/* Error */}
          {browseError && !browsing && (
            <div className="alert alert-error" style={{ marginBottom: 32 }}>{browseError}</div>
          )}

          {/* ── Best matches ──────────────────────────────────── */}
          {matched.length > 0 && !browsing && (
            <div className="section-block">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
                <div>
                  <div className="section-eyebrow">
                    <div className="section-eyebrow__line" />
                    <span className="section-eyebrow__text">Best Matches</span>
                  </div>
                  <div className="section-title">Results for "{query}"</div>
                  <div className="section-subtitle">Products matching your search criteria</div>
                </div>
                <div className="section-count">{matched.length} found</div>
              </div>
              <div className="product-grid product-grid-3">
                {matched.map(p => (
                  <ProductCard key={p.id} product={p} onAdd={handleAddToCart}
                    badge={p.match_count && p.match_count >= 3 ? 'Top Match' : undefined} />
                ))}
              </div>
            </div>
          )}

          {/* ── Combo deals ──────────────────────────────────── */}
          {combos.length > 0 && !browsing && (
            <div className="section-block">
              <div className="section-eyebrow">
                <div className="section-eyebrow__line" />
                <span className="section-eyebrow__text">Combo Deals</span>
              </div>
              <div className="section-title">Bundle &amp; Save</div>
              <div className="section-subtitle" style={{ marginBottom: 20 }}>Frequently bought together</div>
              <div className="product-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {combos.map(p => (
                  <ComboCard key={p.id} product={p} onAdd={handleAddToCart} />
                ))}
              </div>
            </div>
          )}

          {/* ── Related products ────────────────────────────── */}
          {related.length > 0 && !browsing && (
            <div className="section-block">
              <div className="section-eyebrow">
                <div className="section-eyebrow__line" />
                <span className="section-eyebrow__text">You Might Also Like</span>
              </div>
              <div className="section-title">Related Products</div>
              <div className="section-subtitle" style={{ marginBottom: 20 }}>Alternatives, accessories and upgrades</div>
              <div className="product-grid product-grid-4">
                {related.map(p => (
                  <ProductCard key={p.id} product={p} onAdd={handleAddToCart}
                    badge={p.alternative_type === 'better_alternative' ? 'Upgrade' :
                           p.alternative_type === 'cheaper_alternative' ? 'Budget Pick' : undefined} />
                ))}
              </div>
            </div>
          )}

          {/* Empty states */}
          {!browsing && !browseError && matched.length === 0 && query && (
            <div className="empty-state">
              <div className="empty-state__icon">🔍</div>
              <h3>No products found</h3>
              <p>Try different keywords or browse categories</p>
            </div>
          )}
          {!query && !browsing && (
            <div className="empty-state">
              <div className="empty-state__icon">🛍️</div>
              <h3>Search for products</h3>
              <p>Use natural language — price, material, size, brand all work</p>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════
              INLINE CHECKOUT SECTION
              Appears after "Add to Cart" is clicked
              ═══════════════════════════════════════════════════ */}
          {checkoutOpen && cart.length > 0 && (
            <div className="checkout-section animate-fade" ref={checkoutRef}>
              {/* Header */}
              <div className="checkout-header">
                <h2>Shopping Cart</h2>
                <span className="checkout-header__count">({cart.length} item{cart.length !== 1 ? 's' : ''})</span>
              </div>

              <div className="checkout-grid">
                {/* Left: cart items */}
                <CartItems cart={cart} />

                {/* Right: order summary → agent stages → receipt */}
                <div>
                  {phase === 'success' ? (
                    <ReceiptPanel
                      cart={cart}
                      sessionId={sessionId}
                      userEmail={user?.email || 'your email'}
                      onClose={handleClose}
                    />
                  ) : agentStarted ? (
                    <AgentStagesPanel
                      phase={phase}
                      pendingGate={pendingGate}
                      stageHighWater={stageHighWater}
                    />
                  ) : (
                    <OrderSummary
                      cart={cart}
                      onStartPurchase={startPurchase}
                      isLoading={phase === 'processing'}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </>
  );
}
