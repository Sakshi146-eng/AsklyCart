import type { CrossSellSuggestion } from '../api/client';

interface CrossSellBannerProps {
  suggestions: CrossSellSuggestion[];
  onAccept: (productId: string) => void;
  onDecline: () => void;
  isLoading?: boolean;
}

const TYPE_CONFIG = {
  combo_discount: {
    label: '🎁 COMBO DEAL',
    className: 'combo',
    emoji: '🎁',
    verb: 'Add Combo to Cart',
  },
  better_alternative: {
    label: '⭐ UPGRADE AVAILABLE',
    className: 'better',
    emoji: '⭐',
    verb: 'Switch to This',
  },
  cheaper_alternative: {
    label: '💰 BUDGET OPTION',
    className: 'cheaper',
    emoji: '💰',
    verb: 'Switch to This',
  },
  complementary: {
    label: '🛍️ FREQUENTLY BOUGHT TOGETHER',
    className: 'complementary',
    emoji: '🛍️',
    verb: 'Add to Cart',
  },
};

export function CrossSellBanner({ suggestions, onAccept, onDecline, isLoading }: CrossSellBannerProps) {
  if (suggestions.length === 0) return null;

  const top = suggestions[0];
  const config = TYPE_CONFIG[top.type] || TYPE_CONFIG.complementary;

  const displayPrice = top.combo_price ?? top.product.price;

  return (
    <div className="crosssell-banner">
      <div className={`crosssell-type-label ${config.className}`}>
        {config.label}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{
          width: 52,
          height: 52,
          background: 'var(--accent-dim)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          flexShrink: 0,
        }}>
          {config.emoji}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            {top.combo_label || top.product.name}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            {top.product.description}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              ₹{displayPrice.toLocaleString('en-IN')}
            </span>
            {top.combo_price && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                ₹{(top.product.price).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="crosssell-actions">
        <button
          className="btn btn-primary"
          onClick={() => onAccept(top.product.id)}
          disabled={isLoading}
        >
          {isLoading ? <span className="loading-spinner" /> : null}
          {config.verb}
        </button>
        <button
          className="btn btn-secondary"
          onClick={onDecline}
          disabled={isLoading}
        >
          No thanks
        </button>
      </div>

      {suggestions.length > 1 && (
        <div style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}>
          +{suggestions.length - 1} more suggestion{suggestions.length > 2 ? 's' : ''} available
        </div>
      )}
    </div>
  );
}
