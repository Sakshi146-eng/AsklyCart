import type { CartItem } from '../api/client';

interface CartProps {
  cart: CartItem[];
  cartTotal: number;
}

const CATEGORY_ICONS: Record<string, string> = {
  water_bottles: '🫗',
  thermos: '☕',
  lunch_boxes: '🍱',
  mugs: '🍵',
  cleaning: '🧹',
  filters: '💧',
  accessories: '🎒',
  bundles: '📦',
};

export function Cart({ cart, cartTotal }: CartProps) {
  return (
    <div className="cart-sidebar">
      <div className="cart-header">
        <span className="cart-title">Cart</span>
        <span className="cart-count">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
      </div>

      {cart.length === 0 ? (
        <div className="cart-empty">
          <div className="cart-empty-icon">🛒</div>
          <div>Your cart is empty</div>
          <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--text-muted)' }}>
            Search for products to begin
          </div>
        </div>
      ) : (
        <>
          {cart.map((item) => (
            <div key={item.id} className="cart-item">
              <div className="cart-item-icon">
                {CATEGORY_ICONS[item.category] || '📦'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cart-item-name truncate">{item.name}</div>
                <div className="cart-item-price">
                  ₹{item.price.toLocaleString('en-IN')} × {item.quantity}
                </div>
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-light)', flexShrink: 0 }}>
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </div>
            </div>
          ))}

          <div className="cart-total" style={{ marginTop: 'auto', paddingTop: 12 }}>
            <span className="cart-total-label">Total</span>
            <span className="cart-total-amount">₹{cartTotal.toLocaleString('en-IN')}</span>
          </div>
        </>
      )}
    </div>
  );
}
