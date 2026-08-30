import type { CartItem } from '../api/client';

interface GateModalProps {
  gate: string;
  prompt: string;
  cart: CartItem[];
  cartTotal: number;
  retryCount?: number;
  onYes: () => void;
  onNo: () => void;
  isLoading?: boolean;
}

const GATE_CONFIG: Record<string, {
  icon: string;
  title: string;
  yesLabel: string;
  noLabel: string;
  color: string;
  description: string;
}> = {
  gate1: {
    icon: '🛒',
    title: 'Confirm Interest',
    yesLabel: 'Yes, I\'m Interested',
    noLabel: 'No, Cancel',
    color: 'var(--accent)',
    description: 'Gate 1 — Interest Check',
  },
  gate2: {
    icon: '✅',
    title: 'Auto-Approved',
    yesLabel: 'Proceed to Payment',
    noLabel: 'Cancel',
    color: 'var(--success)',
    description: 'Gate 2 — Spending Cap Check',
  },
  gate4: {
    icon: '⚠️',
    title: 'Above Your Limit',
    yesLabel: 'Yes, I Authorize This',
    noLabel: 'No, Cancel',
    color: 'var(--warning)',
    description: 'Gate 4 — Over-Cap Consent',
  },
  gate3: {
    icon: '❌',
    title: 'Payment Failed',
    yesLabel: 'Retry Payment',
    noLabel: 'Don\'t Retry',
    color: 'var(--danger)',
    description: 'Gate 3 — Retry Consent',
  },
};

export function GateModal({
  gate,
  prompt,
  cart,
  cartTotal,
  retryCount = 0,
  onYes,
  onNo,
  isLoading,
}: GateModalProps) {
  const config = GATE_CONFIG[gate] || {
    icon: '🤖',
    title: 'Agent Decision',
    yesLabel: 'Yes',
    noLabel: 'No',
    color: 'var(--accent)',
    description: gate,
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onNo()}>
      <div className="modal">
        {/* Gate label */}
        <div className="modal-gate-label" style={{ color: config.color }}>
          {config.description}
        </div>

        {/* Icon */}
        <div className="modal-icon">{config.icon}</div>

        {/* Title */}
        <div className="modal-title">{config.title}</div>

        {/* Prompt (the Model B generated reason) */}
        <div className="modal-reason" style={{ marginBottom: 16 }}>
          {prompt}
        </div>

        {/* Cart summary */}
        {cart.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: '0.85rem',
          }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 6, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Your Cart
            </div>
            {cart.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: 2 }}>
                <span>{item.name}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{(item.price * item.quantity).toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 8, fontWeight: 700 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total</span>
              <span style={{ color: config.color }}>₹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}

        {/* Retry info */}
        {gate === 'gate3' && retryCount > 0 && (
          <div style={{
            background: 'var(--danger-dim)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: '0.8rem',
            color: 'var(--danger)',
          }}>
            Attempt {retryCount + 1} of 2 — {2 - retryCount} retry remaining
          </div>
        )}

        {/* JWT consent note */}
        <div style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}>
          🔐 Your consent will be signed with a JWT token and stored in the audit log
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onNo} disabled={isLoading}>
            {config.noLabel}
          </button>
          <button
            className="btn btn-primary"
            onClick={onYes}
            disabled={isLoading}
            style={{ background: `linear-gradient(135deg, ${config.color}, ${config.color === 'var(--accent)' ? '#7c3aed' : config.color})` }}
          >
            {isLoading ? <span className="loading-spinner" /> : null}
            {config.yesLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
