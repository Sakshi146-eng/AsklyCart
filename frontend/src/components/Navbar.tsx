import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';

export default function Navbar() {
  const { user, logout, isLoggedIn } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [cartCount, setCartCount] = useState(0);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isActive = (path: string) => pathname === path ? 'nav-btn active' : 'nav-btn';

  /* Refresh cart count on route change */
  useEffect(() => {
    if (!isLoggedIn) { setCartCount(0); return; }
    api.getCart()
      .then(items => setCartCount(items.reduce((s, i) => s + i.quantity, 0)))
      .catch(() => {});
  }, [isLoggedIn, pathname]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <nav className="navbar">
      <div className="navbar__inner">

        {/* Logo */}
        <div className="navbar__logo" onClick={() => navigate('/')}>
          Askly<span>Cart</span>
        </div>

        {/* Search bar — hidden on landing */}
        {pathname !== '/' && (
          <form className="navbar__search" onSubmit={handleSearch}>
            <span style={{ fontSize: 15, opacity: 0.5 }}>🔍</span>
            <input
              ref={inputRef}
              id="navbar-search"
              placeholder="Search products…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button type="submit" className="btn btn-gold btn-sm" style={{ borderRadius: '50px' }}>
                Go
              </button>
            )}
          </form>
        )}

        {/* Right actions */}
        <div className="navbar__actions">
          {/* Theme toggle */}
          <button
            id="theme-toggle"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>

          {isLoggedIn ? (
            <>
              {/* Cart */}
              <div className="cart-badge-wrap">
                <button id="nav-cart" className={isActive('/cart')} onClick={() => navigate('/cart')}>
                  🛒 Cart
                </button>
                {cartCount > 0 && (
                  <span className="cart-badge">{cartCount > 9 ? '9+' : cartCount}</span>
                )}
              </div>

              <button className={isActive('/orders')} onClick={() => navigate('/orders')}>
                📦 Orders
              </button>

              {/* Avatar */}
              <div
                className="avatar"
                onClick={() => navigate('/profile')}
                title={user?.name}
              >
                {user?.name?.charAt(0).toUpperCase() || '?'}
              </div>

              <button className="nav-btn" onClick={logout}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button className="nav-btn" onClick={() => navigate('/auth')}>Sign In</button>
              <button
                id="nav-signup"
                className="btn btn-gold btn-sm"
                onClick={() => navigate('/auth?mode=signup')}
              >
                Get Started
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
