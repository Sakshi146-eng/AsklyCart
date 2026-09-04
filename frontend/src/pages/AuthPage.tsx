import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'signup' ? 'signup' : 'login'
  );

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cap, setCap] = useState('2000');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register, isLoggedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { if (isLoggedIn) navigate('/profile'); }, [isLoggedIn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!name.trim()) { setError('Name is required'); return; }
        await register(name.trim(), email.trim(), password, parseFloat(cap) || 2000);
      } else {
        await login(email.trim(), password);
      }
      navigate('/profile');
    } catch (e: unknown) {
      setError((e as Error).message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-wrap auth-page">
      <div className="auth-card animate-slide">
        {/* Logo */}
        <div className="auth-card__logo">
          <div style={{ fontFamily: 'Playfair Display', fontSize: 28, fontWeight: 800 }}>
            Commerce<span style={{ color: 'var(--gold)' }}>Ops</span>
          </div>
          <p style={{ fontSize: 13, marginTop: 6, color: 'var(--text-2)' }}>
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </p>
        </div>

        {/* Toggle */}
        <div className="auth-tabs">
          <button
            id="auth-tab-login"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >Sign In</button>
          <button
            id="auth-tab-signup"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); }}
          >Sign Up</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {mode === 'signup' && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                id="auth-name"
                className="form-input"
                placeholder="Sakshi Sharma"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              id="auth-email"
              className="form-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            {mode === 'signup' && (
              <span className="form-hint">Receipt will be sent to this email after purchase</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              id="auth-password"
              className="form-input"
              type="password"
              placeholder="Min 6 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {mode === 'signup' && (
            <div className="form-group">
              <label className="form-label">Spending Cap (₹)</label>
              <input
                id="auth-cap"
                className="form-input"
                type="number" min="100" max="50000" step="100"
                placeholder="2000"
                value={cap}
                onChange={e => setCap(e.target.value)}
              />
              <span className="form-hint">Purchases above this cap need your explicit approval</span>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          <button
            id="auth-submit"
            type="submit"
            className="btn btn-gold btn-lg btn-full"
            disabled={loading}
            style={{ marginTop: 4 }}
          >
            {loading
              ? <><span className="spinner" style={{ width: 18, height: 18 }} /> Processing…</>
              : mode === 'signup' ? 'Create Account →' : 'Sign In →'
            }
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
          {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
        </div>
        <button
          className="btn btn-ghost btn-full"
          style={{ marginTop: 8 }}
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
        >
          {mode === 'signup' ? 'Sign In Instead' : 'Create Account'}
        </button>
      </div>
    </main>
  );
}
