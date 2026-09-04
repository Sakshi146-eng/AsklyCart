import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function ProfilePage() {
  const { user, refreshUser, logout, isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || '');
  const [cap, setCap] = useState(String(user?.spending_cap || 2000));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!isLoggedIn) {
    return (
      <main className="page-wrap">
        <div className="container" style={{ paddingTop: 80, textAlign: 'center' }}>
          <div className="empty-state">
            <div className="empty-state__icon">🔒</div>
            <h3>Sign in to view your profile</h3>
            <button className="btn btn-gold" onClick={() => navigate('/auth')}>Sign In</button>
          </div>
        </div>
      </main>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setSaving(true);
    try {
      await api.updateMe({
        name: name.trim(),
        spending_cap: parseFloat(cap) || 2000,
      });
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setSaveError((e as Error).message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const joinedDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  return (
    <main className="page-wrap">
      <div className="page-inner animate-fade">

        {/* Profile hero */}
        <div className="profile-hero">
          <div className="profile-avatar">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: 4 }}>{user?.name}</h2>
            <p style={{ fontSize: 14, marginBottom: 8, color: 'var(--text-2)' }}>{user?.email}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-gold">
                Cap: ₹{user?.spending_cap?.toLocaleString('en-IN')}
              </span>
              <span className="badge badge-gray">Member since {joinedDate}</span>
            </div>
          </div>
          <button
            id="profile-logout"
            className="btn btn-ghost btn-sm"
            onClick={() => { logout(); navigate('/'); }}
          >
            Sign Out
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Edit profile */}
          <div className="card">
            <div className="card-pad">
              <h3 style={{ marginBottom: 24, fontSize: 18 }}>Account Settings</h3>
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    id="profile-name"
                    className="form-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    className="form-input"
                    value={user?.email}
                    disabled
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                  />
                  <span className="form-hint">Receipts are sent here · Cannot be changed</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Spending Cap (₹)</label>
                  <input
                    id="profile-cap"
                    className="form-input"
                    type="number" min="100" max="50000" step="100"
                    value={cap}
                    onChange={e => setCap(e.target.value)}
                  />
                  <span className="form-hint">
                    Purchases above ₹{parseFloat(cap).toLocaleString('en-IN') || '…'} require explicit approval
                  </span>
                </div>

                {saved && <div className="alert alert-success">✓ Profile saved</div>}
                {saveError && <div className="alert alert-error">{saveError}</div>}

                <button
                  id="profile-save"
                  type="submit"
                  className="btn btn-gold"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </form>
            </div>
          </div>

          {/* Quick links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* How agent uses profile */}
            <div className="card">
              <div className="card-pad">
                <h3 style={{ fontSize: 16, marginBottom: 16 }}>How the AI Agent Uses Your Profile</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { icon: '✉️', title: 'Email', desc: 'HTML receipt sent here after every successful purchase' },
                    { icon: '💰', title: 'Spending Cap', desc: 'Auto-approved below cap · Needs Gate 4 approval above it' },
                    { icon: '📋', title: 'Audit Trail', desc: 'Every agent decision logged with AI-written reason' },
                  ].map(item => (
                    <div key={item.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: 'var(--gold-muted)', border: '1px solid var(--gold-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, flexShrink: 0,
                      }}>
                        {item.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="card">
              <div className="card-pad">
                <h3 style={{ fontSize: 16, marginBottom: 16 }}>Quick Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button className="btn btn-gold btn-full" onClick={() => navigate('/cart')}>
                    🛒 My Cart
                  </button>
                  <button className="btn btn-outline btn-full" onClick={() => navigate('/orders')}>
                    📦 My Orders
                  </button>
                  <button className="btn btn-ghost btn-full" onClick={() => navigate('/search?q=water bottle')}>
                    🔍 Browse Products
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
