import { useEffect, useRef } from 'react';
import type { AuditEntry } from '../api/client';

interface AuditTrailProps {
  trail: AuditEntry[];
  isLive?: boolean;
}

const STEP_COLORS: Record<string, string> = {
  search: 'var(--info)',
  cart: 'var(--accent)',
  crosssell: 'var(--warning)',
  gate1: 'var(--accent-light)',
  gate2: 'var(--success)',
  gate4: 'var(--warning)',
  payment_attempt: 'var(--success)',
  gate3: 'var(--danger)',
  retry: 'var(--warning)',
  report: 'var(--success)',
  final_status: 'var(--success)',
};

const STEP_ICONS: Record<string, string> = {
  search: '🔍',
  cart: '🛒',
  crosssell: '🎁',
  gate1: '🤔',
  gate2: '⚖️',
  gate4: '⚠️',
  payment_attempt: '💳',
  gate3: '🔄',
  retry: '♻️',
  report: '📋',
  final_status: '✅',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const color = STEP_COLORS[entry.step] || 'var(--accent)';
  const icon = STEP_ICONS[entry.step] || '📌';
  const isSuccess = entry.decision.includes('success') || entry.decision.includes('approved') || entry.decision === 'completed';
  const isFailure = entry.decision.includes('fail') || entry.decision.includes('declined') || entry.decision.includes('abandoned');

  return (
    <div
      className={`audit-entry step-${entry.step}`}
      title={entry.consent_token ? `JWT: ${entry.consent_token.slice(0, 32)}...` : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <div className="audit-step-label" style={{ color, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{icon}</span>
          <span>{entry.step.replace(/_/g, ' ').toUpperCase()}</span>
        </div>
        {entry.consent_token && (
          <span style={{ fontSize: '0.65rem', color: 'var(--accent-light)' }} title="JWT consent token stored">
            🔐
          </span>
        )}
      </div>

      <div className="audit-decision" style={{
        color: isSuccess ? 'var(--success)' : isFailure ? 'var(--danger)' : 'var(--text-primary)'
      }}>
        {entry.decision.replace(/_/g, ' ')}
      </div>

      {entry.reason && (
        <div className="audit-reason">{entry.reason}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        {entry.amount && (
          <div className="audit-amount">₹{entry.amount.toLocaleString('en-IN')}</div>
        )}
        <div className="audit-time" style={{ marginLeft: 'auto' }}>
          {entry.created_at ? formatTime(entry.created_at) : ''}
        </div>
      </div>
    </div>
  );
}

export function AuditTrail({ trail, isLive }: AuditTrailProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [trail.length, isLive]);

  return (
    <div className="audit-panel">
      <div className="audit-title">
        {isLive && <div className="audit-live-dot" />}
        Audit Trail
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
          {trail.length} entries
        </span>
      </div>

      {trail.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '24px 0' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📋</div>
          Audit log will appear here as the agent makes decisions
        </div>
      ) : (
        <>
          {trail.map((entry, i) => (
            <AuditEntryRow key={entry.id || i} entry={entry} />
          ))}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  );
}
