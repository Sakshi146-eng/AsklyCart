import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Product, ProductDetailResponse } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORY_EMOJI: Record<string, string> = {
  water_bottles: '💧', thermos: '☕', lunch_boxes: '🍱', mugs: '🫖',
  cleaning: '🧴', filters: '🔬', accessories: '🎒', bundles: '📦', default: '🛒',
};
const emoji = (cat: string) => CATEGORY_EMOJI[cat] || CATEGORY_EMOJI.default;

function RelatedCard({ product }: { product: Product }) {
  const navigate = useNavigate();
  return (
    <div
      className="product-card"
      onClick={() => navigate(`/product/${product.id}`)}
      style={{ cursor: 'pointer' }}
    >
      <div className="product-card__img">
        <span style={{ fontSize: 40 }}>{emoji(product.category)}</span>
      </div>
      <div className="product-card__body">
        <div className="product-card__category">{product.category.replace(/_/g, ' ')}</div>
        <div className="product-card__name">{product.name}</div>
      </div>
      <div className="product-card__footer">
        <div className="product-card__price">₹{product.price.toLocaleString('en-IN')}</div>
      </div>
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isLoggedIn, user } = useAuth();

  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getProduct(id)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAddToCart = () => {
    if (!data) return;
    if (!isLoggedIn) { navigate('/auth'); return; }
    // Navigate to search page with direct product add
    const q = encodeURIComponent(`${data.product.name} ₹${data.product.price}`);
    navigate(`/search?q=${q}&autoCart=${id}`);
  };

  if (loading) return (
    <main className="page-wrap">
      <div className="loading-state">
        <div className="spinner spinner-lg" />
        <p>Loading product…</p>
      </div>
    </main>
  );

  if (error || !data) return (
    <main className="page-wrap">
      <div className="container" style={{ paddingTop: 60 }}>
        <div className="empty-state">
          <div className="empty-state__icon">⚠️</div>
          <h3>Product not found</h3>
          <p>{error || 'This product does not exist.'}</p>
          <button className="btn btn-gold" onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    </main>
  );

  const { product, related_products, combo, better_alternative, cheaper_alternative } = data;

  return (
    <main className="page-wrap animate-fade">
      <div className="container">

        {/* Breadcrumb */}
        <div className="breadcrumb">
          <span className="breadcrumb__link" onClick={() => navigate('/')}>Home</span>
          <span className="breadcrumb__sep">›</span>
          <span className="breadcrumb__link" onClick={() => navigate(`/search?q=${encodeURIComponent(product.category)}`)}>
            {product.category.replace(/_/g, ' ')}
          </span>
          <span className="breadcrumb__sep">›</span>
          <span className="breadcrumb__current">{product.name}</span>
        </div>

        {/* Main product layout */}
        <div className="product-detail">

          {/* Gallery */}
          <div className="product-detail__gallery">
            {emoji(product.category)}
          </div>

          {/* Info */}
          <div className="product-detail__info">
            <div className="product-detail__category">
              {product.category.replace(/_/g, ' ')}
            </div>

            <h1 className="product-detail__name">{product.name}</h1>

            <div className="product-detail__price">
              ₹{product.price.toLocaleString('en-IN')}
            </div>

            {/* Combo highlight */}
            {combo && (
              <div className="combo-card" style={{ margin: 0 }}>
                <div className="combo-card__tag">🎁 Combo Deal Available</div>
                <div className="combo-card__label">{combo.label}</div>
                <div className="combo-card__pricing">
                  <span className="combo-card__original">
                    ₹{(product.price + combo.product.price).toLocaleString('en-IN')}
                  </span>
                  <span className="combo-card__price">₹{combo.combined_price.toLocaleString('en-IN')}</span>
                  <span className="combo-card__save">Save ₹{combo.savings}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  Bundled with: {combo.product.name}
                </div>
              </div>
            )}

            <p className="product-detail__desc">{product.description}</p>

            {/* Meta */}
            <div className="product-detail__meta">
              <div className="product-detail__meta-row">
                <span className="product-detail__meta-label">Category</span>
                <span className="product-detail__meta-value">{product.category.replace(/_/g, ' ')}</span>
              </div>
              <div className="product-detail__meta-row">
                <span className="product-detail__meta-label">Stock</span>
                <span className="product-detail__meta-value" style={{ color: product.stock <= 10 ? 'var(--error)' : 'var(--success)' }}>
                  {product.stock <= 10 ? `Only ${product.stock} left!` : `${product.stock} available`}
                </span>
              </div>
              <div className="product-detail__meta-row">
                <span className="product-detail__meta-label">Product ID</span>
                <span className="product-detail__meta-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{product.id}</span>
              </div>
            </div>

            {/* Alternatives */}
            {(better_alternative || cheaper_alternative) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {better_alternative && (
                  <div
                    className="alert alert-info"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/product/${better_alternative.id}`)}
                  >
                    ⬆️ <strong>Better option:</strong> {better_alternative.name} — ₹{better_alternative.price.toLocaleString('en-IN')}
                  </div>
                )}
                {cheaper_alternative && (
                  <div
                    className="alert alert-info"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/product/${cheaper_alternative.id}`)}
                  >
                    💰 <strong>Budget option:</strong> {cheaper_alternative.name} — ₹{cheaper_alternative.price.toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            <button
              id={`product-add-cart-${product.id}`}
              className="btn btn-gold btn-lg btn-full"
              onClick={handleAddToCart}
              style={{ marginTop: 8 }}
            >
              🛒 Add to Cart — ₹{product.price.toLocaleString('en-IN')}
            </button>

            {!isLoggedIn && (
              <p style={{ fontSize: 13, textAlign: 'center', color: 'var(--text-3)' }}>
                You'll be asked to sign in before checkout
              </p>
            )}
          </div>
        </div>

        {/* Related products */}
        {related_products.length > 0 && (
          <section style={{ paddingTop: 48, paddingBottom: 64, borderTop: '1px solid var(--border)' }}>
            <div className="section-header">
              <div>
                <div className="section-label">
                  <div className="section-label__line" />
                  <span className="section-label__text">Related Products</span>
                </div>
                <h2 className="section-header__title">Frequently Paired Together</h2>
              </div>
            </div>
            <div className="grid-4">
              {related_products.map(p => (
                <RelatedCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
