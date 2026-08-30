import type { Product } from '../api/client';

interface ProductCardProps {
  product: Product;
  isSelected?: boolean;
  onClick?: () => void;
  onAddToCart?: () => void;
  addToCartLoading?: boolean;
  rank?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  water_bottles: '#6366f1',
  thermos: '#f59e0b',
  lunch_boxes: '#10b981',
  mugs: '#8b5cf6',
  cleaning: '#3b82f6',
  filters: '#06b6d4',
  accessories: '#ec4899',
  bundles: '#f97316',
};

export function ProductCard({ product, isSelected, onClick, onAddToCart, addToCartLoading, rank }: ProductCardProps) {
  const accentColor = CATEGORY_COLORS[product.category] || '#6366f1';

  return (
    <div
      className={`product-card${isSelected ? ' selected' : ''}`}
      onClick={onClick}
      style={isSelected ? { borderColor: accentColor } : {}}
    >
      {rank && rank <= 3 && (
        <div className="product-match-score">
          #{rank} match
        </div>
      )}

      <div
        className="product-category-badge"
        style={{ color: accentColor, background: `${accentColor}18` }}
      >
        {product.category.replace(/_/g, ' ')}
      </div>

      <div className="product-name">{product.name}</div>
      <div className="product-description">{product.description}</div>

      <div className="product-footer" style={{ flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div className="product-price">
            ₹{product.price.toLocaleString('en-IN')}
            <span> INR</span>
          </div>
          <div className="product-stock">
            {product.stock > 10 ? '● In Stock' : product.stock > 0 ? `● ${product.stock} left` : '○ Out'}
          </div>
        </div>

        {onAddToCart && (
          <button
            id={`add-to-cart-${product.id}`}
            className="btn btn-primary btn-sm btn-full"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}
            onClick={e => { e.stopPropagation(); onAddToCart(); }}
            disabled={addToCartLoading || product.stock === 0}
          >
            {addToCartLoading
              ? <><span className="loading-spinner" /> Starting agent…</>
              : '🛒 Add to Cart'}
          </button>
        )}
      </div>

      {product.match_count && (
        <div style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}>
          {Array.from({ length: Math.min(product.match_count, 5) }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                background: i < (product.match_count || 0) ? accentColor : 'var(--border-subtle)',
              }}
            />
          ))}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6, whiteSpace: 'nowrap' }}>
            {product.match_count} params
          </span>
        </div>
      )}
    </div>
  );
}
