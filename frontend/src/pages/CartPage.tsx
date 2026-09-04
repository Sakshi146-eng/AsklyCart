import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { DBCartItem } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORY_EMOJI: Record<string, string> = {
  water_bottles: '💧', thermos: '☕', lunch_boxes: '🍱', mugs: '🫖',
  cleaning: '🧴', filters: '🔬', accessories: '🎒', bundles: '📦', default: '🛒',
};
const emoji = (cat?: string | null) => CATEGORY_EMOJI[cat || ''] || CATEGORY_EMOJI.default;

export default function CartPage() {
  const { isLoggedIn, user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<DBCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchCart = async () => {
    try {
      const data = await api.getCart();
      setItems(data);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isLoggedIn) { navigate('/auth'); return; }
    fetchCart();
  }, [isLoggedIn]);

  const handleRemove = async (productId: string) => {
    setRemoving(productId);
    try {
      await api.removeFromCart(productId);
      setItems(prev => prev.filter(i => i.product_id !== productId));
    } finally {
      setRemoving(null);
    }
  };

  const handleCheckout = (item: DBCartItem) => {
    // Navigate to search page with the product query — agent flow starts from there
    const q = encodeURIComponent(`${item.product_name} ₹${item.product_price}`);
    navigate(`/search?q=${q}&autoCart=${item.product_id}`);
  };

  const cartTotal = items.reduce((s, i) => s + i.product_price * i.quantity, 0);

  if (loading) return (
    <main className="page-wrap">
      <div className="loading-state"><div className="spinner spinner-lg" /><p>Loading cart…</p></div>
    </main>
  );

  return (
    <main className="page-wrap animate-fade">
      <div className="container" style={{ paddingTop: 40, paddingBottom: 64 }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div className="section-label">
            <div className="section-label__line" />
            <span className="section-label__text">My Cart</span>
          </div>
          <h1 style={{ fontSize: '2rem', marginTop: 8, marginBottom: 4 }}>Shopping Cart</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
            {items.length} item{items.length !== 1 ? 's' : ''} saved
          </p>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">🛒</div>
            <h3>Your cart is empty</h3>
            <p>Add products from the search or product pages</p>
            <button className="btn btn-gold" onClick={() => navigate('/search?q=water bottle')}>
              Browse Products
            </button>
          </div>
        ) : (
          <div className="grid-2" style={{ gap: 32, alignItems: 'start' }}>
            {/* Cart items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(item => (
                <div key={item.id} className="card card-gold">
                  <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    {/* Icon */}
                    <div style={{
                      width: 64, height: 64, borderRadius: 10,
                      background: 'var(--gold-muted)', border: '1px solid var(--gold-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 28, flexShrink: 0,
                    }}>
                      {emoji(item.product_category)}
                    </div>

                    {/* Details */}
                    <div style={{ flex: 1 }}>
                      <div
                        style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 4 }}
                        onClick={() => navigate(`/product/${item.product_id}`)}
                      >
                        {item.product_name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {item.product_category?.replace(/_/g, ' ')} · Qty: {item.quantity}
                      </div>
                    </div>

                    {/* Price */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)' }}>
                        ₹{(item.product_price * item.quantity).toLocaleString('en-IN')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        ₹{item.product_price.toLocaleString('en-IN')} each
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                      <button
                        id={`cart-checkout-${item.product_id}`}
                        className="btn btn-gold btn-sm"
                        onClick={() => handleCheckout(item)}
                      >
                        Checkout
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={removing === item.product_id}
                        onClick={() => handleRemove(item.product_id)}
                        style={{ fontSize: 12 }}
                      >
                        {removing === item.product_id ? '…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Order summary */}
            <div style={{ position: 'sticky', top: 96 }}>
              <div className="card">
                <div className="card-body">
                  <h3 style={{ fontSize: 16, marginBottom: 20 }}>Order Summary</h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                    {items.map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-2)' }}>{item.product_name}</span>
                        <span>₹{(item.product_price * item.quantity).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>Total</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)' }}>
                        ₹{cartTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  <div className="alert alert-info" style={{ marginBottom: 16, fontSize: 12 }}>
                    💡 Click "Checkout" on any item to start the AI agent purchase flow
                  </div>

                  <button className="btn btn-outline btn-full" onClick={() => navigate('/orders')}>
                    View Past Orders →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
