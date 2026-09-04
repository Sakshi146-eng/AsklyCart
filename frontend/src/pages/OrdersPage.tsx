import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { UserOrder } from '../api/client';
import { useAuth } from '../context/AuthContext';

const EMOJI: Record<string, string> = {
  water_bottles:'💧', thermos:'☕', lunch_boxes:'🍱', mugs:'🫖',
  cleaning:'🧴', filters:'🔬', accessories:'🎒', bundles:'📦', default:'🛒',
};
const emj = (cat?: string) => EMOJI[cat || ''] || EMOJI.default;

function OrderCard({ order }: { order: UserOrder }) {
  const [open, setOpen] = useState(false);
  const date = new Date(order.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const orderId = `ORD-${order.id.slice(0, 8).toUpperCase()}`;
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;

  return (
    <div className="order-card">
      {/* Head */}
      <div className="order-card__head" onClick={() => setOpen(o => !o)}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-sm)',
          background: 'var(--success-bg)', border: '1px solid rgba(22,163,74,.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          ✅
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{orderId}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {itemCount} item{itemCount !== 1 ? 's' : ''} · {date}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--gold)' }}>
            ₹{order.total.toLocaleString('en-IN')}
          </div>
          <div className="badge badge-green" style={{ marginTop: 4 }}>
            {order.status.toUpperCase()}
          </div>
        </div>

        <div style={{ color: 'var(--text-3)', fontSize: 16, marginLeft: 8, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="order-card__body">
          {itemCount === 0 ? (
            <div style={{ padding: '16px 0', color: 'var(--text-3)', fontSize: 13 }}>
              No item details available.
            </div>
          ) : (
            <>
              {(order.items as any[]).map((item: any, i: number) => (
                <div key={i} className="order-item-row">
                  <div className="order-item-emoji">
                    {emj(item?.category || item?.product_category)}
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
                    {item?.name || item?.product_name || 'Unknown item'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginRight: 12 }}>
                    ×{item?.quantity || 1}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>
                    ₹{(item?.price || item?.product_price || 0).toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Totals */}
          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {order.session_id ? `Session: ${order.session_id.slice(0, 12)}…` : ''}
            </div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              Total Paid: <span style={{ color: 'var(--gold)' }}>₹{order.total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn) { navigate('/auth'); return; }
    api.getOrders()
      .then(data => {
        setOrders(data);
      })
      .catch(err => {
        setError(err?.message || 'Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, [isLoggedIn]);

  if (loading) return (
    <main className="page-wrap">
      <div className="loading-state">
        <div className="spinner spinner-lg" />
        <p>Loading your orders…</p>
      </div>
    </main>
  );

  return (
    <main className="page-wrap animate-fade">
      <div className="page-inner">

        {/* Header */}
        <div className="page-header">
          <div className="section-eyebrow">
            <div className="section-eyebrow__line" />
            <span className="section-eyebrow__text">Purchase History</span>
          </div>
          <h1 style={{ marginTop: 8, marginBottom: 4 }}>My Orders</h1>
          <p style={{ fontSize: 14 }}>
            {orders.length > 0
              ? `${orders.length} order${orders.length !== 1 ? 's' : ''} placed`
              : 'No orders placed yet'}
          </p>
        </div>

        {/* Error */}
        {error && <div className="alert alert-error" style={{ marginBottom: 24 }}>{error}</div>}

        {/* Orders */}
        {orders.length === 0 && !error ? (
          <div className="empty-state">
            <div className="empty-state__icon">📦</div>
            <h3>No orders yet</h3>
            <p>Your completed purchases will appear here</p>
            <button
              className="btn btn-gold btn-lg"
              style={{ marginTop: 8 }}
              onClick={() => navigate('/search?q=water bottle')}
            >
              Start Shopping →
            </button>
          </div>
        ) : (
          <div>
            {orders.map(order => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}

      </div>
    </main>
  );
}
