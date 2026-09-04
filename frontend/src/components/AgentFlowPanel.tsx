/**
 * AgentFlowPanel — right-side real-time visualization of the LangGraph agent.
 * Shows a vertical timeline of each node as it executes.
 * Props come from SearchPage state; zero changes to agent logic.
 */

type Phase = 'idle' | 'processing' | 'crosssell' | 'gate' | 'success' | 'abandoned' | 'failed';
type StepStatus = 'pending' | 'active' | 'waiting' | 'done' | 'failed' | 'skipped';

interface AuditEntry {
  step: string;
  decision?: string;
  reason?: string;
  amount?: number;
}

interface AgentFlowPanelProps {
  open: boolean;
  phase: Phase;
  pendingGate: string | null;
  auditTrail: AuditEntry[];
  gatePrompt: string;
  reportText: string;
  sessionId: string | null;
  onClose: () => void;
}

interface FlowStep {
  id: string;
  icon: string;
  label: string;
  desc: string;
  // audit step names that mark this step "done"
  auditKeys: string[];
  // which phase shows this step as "active"
  activeIn?: Phase[];
  // which pendingGate shows this step as "waiting"
  waitingGate?: string;
}

const FLOW: FlowStep[] = [
  {
    id: 'parse',
    icon: '🔍',
    label: 'Parsing Query',
    desc: 'AI extracts product name, price, colour, and other parameters',
    auditKeys: ['parse_query', 'search', 'search_products'],
    activeIn: ['processing'],
  },
  {
    id: 'cart',
    icon: '🛒',
    label: 'Building Cart',
    desc: 'Matched product added; cross-sell engine checking combinations',
    auditKeys: ['add_to_cart', 'cart'],
    activeIn: ['processing'],
  },
  {
    id: 'crosssell',
    icon: '💡',
    label: 'Cross-sell Analysis',
    desc: 'Finding combo deals and complementary products',
    auditKeys: ['crosssell', 'crosssell_check'],
    activeIn: ['crosssell'],
  },
  {
    id: 'gate1',
    icon: '🔑',
    label: 'Gate 1 — Confirm Interest',
    desc: 'Checking you actually want to proceed with this product',
    auditKeys: ['gate1', 'interest_gate', 'gate_1'],
    waitingGate: 'gate1',
  },
  {
    id: 'gate2',
    icon: '💰',
    label: 'Gate 2 — Spending Cap',
    desc: 'Comparing cart total against your approved spending cap',
    auditKeys: ['gate2', 'cap_gate', 'gate_2', 'spending_cap'],
    waitingGate: 'gate2',
  },
  {
    id: 'payment',
    icon: '💳',
    label: 'Gate 3 — Payment',
    desc: 'Razorpay test-mode payment authorisation',
    auditKeys: ['payment', 'gate3', 'payment_gate', 'gate_3'],
    waitingGate: 'gate3',
  },
  {
    id: 'report',
    icon: '📋',
    label: 'Final Report & Receipt',
    desc: 'AI writes audit summary and sends email receipt',
    auditKeys: ['report', 'final_report'],
    activeIn: ['success'],
  },
];

function getStepStatus(
  step: FlowStep,
  phase: Phase,
  pendingGate: string | null,
  completedSteps: Set<string>,
): StepStatus {
  // Done = a matching audit entry exists
  if (step.auditKeys.some(k => completedSteps.has(k))) return 'done';

  // Waiting for user input at a specific gate
  if (phase === 'gate' && step.waitingGate && pendingGate === step.waitingGate) return 'waiting';

  // Agent actively running this step
  if (step.activeIn && step.activeIn.includes(phase)) return 'active';

  // Terminal states
  if (phase === 'success' && step.id === 'report') return 'done';
  if (phase === 'failed'   && step.waitingGate && pendingGate === step.waitingGate) return 'failed';
  if (phase === 'abandoned' && step.waitingGate && pendingGate === step.waitingGate) return 'failed';

  return 'pending';
}

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'Waiting…',
  active:  'Running…',
  waiting: 'Awaiting your approval',
  done:    'Complete',
  failed:  'Failed',
  skipped: 'Skipped',
};

export default function AgentFlowPanel({
  open, phase, pendingGate, auditTrail, gatePrompt, reportText, sessionId, onClose,
}: AgentFlowPanelProps) {
  const completedSteps = new Set(auditTrail.map(e => e.step?.toLowerCase()));

  const isTerminal = phase === 'success' || phase === 'abandoned' || phase === 'failed';
  const statusEmoji = phase === 'success' ? '✅' : phase === 'failed' ? '❌' : phase === 'abandoned' ? '🚫' : '⚙️';

  return (
    <aside className={`agent-panel ${open ? 'open' : ''}`}>
      {/* Header */}
      <div className="agent-panel__header">
        <div style={{ fontSize: 22 }}>{statusEmoji}</div>
        <div>
          <div className="agent-panel__title">AI Agent Flow</div>
          <div className="agent-panel__subtitle">
            {phase === 'idle'       ? 'Not started'           : ''}
            {phase === 'processing' ? 'Agent is processing…'  : ''}
            {phase === 'crosssell'  ? 'Suggesting add-ons'    : ''}
            {phase === 'gate'       ? 'Waiting for consent'   : ''}
            {phase === 'success'    ? 'Purchase completed ✓'  : ''}
            {phase === 'abandoned'  ? 'Session abandoned'      : ''}
            {phase === 'failed'     ? 'Payment failed'         : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--text-3)', padding: '4px 8px' }}
        >
          ✕
        </button>
      </div>

      {/* Timeline */}
      <div className="agent-panel__body">
        {FLOW.map((step, i) => {
          const status = getStepStatus(step, phase, pendingGate, completedSteps);

          // Find matching audit entry for detail
          const auditEntry = auditTrail.find(e =>
            step.auditKeys.includes(e.step?.toLowerCase())
          );

          return (
            <div key={step.id} className={`agent-step ${status}`}>
              <div className="agent-step__icon-wrap">
                {status === 'done'    ? '✓'   :
                 status === 'failed'  ? '✕'   :
                 status === 'active'  ? <span className="spinner" style={{ width: 18, height: 18 }} /> :
                 step.icon}
              </div>

              <div className="agent-step__content">
                <div className="agent-step__label">
                  <span style={{ marginRight: 6 }}>{step.label}</span>
                </div>
                <div className="agent-step__status">{STATUS_LABEL[status]}</div>

                {/* Gate prompt */}
                {status === 'waiting' && gatePrompt && (
                  <div className="agent-step__detail">
                    💬 {gatePrompt}
                  </div>
                )}

                {/* Audit detail when done */}
                {status === 'done' && auditEntry?.reason && (
                  <div className="agent-step__detail">
                    {auditEntry.reason}
                  </div>
                )}

                {/* Report text on final step */}
                {step.id === 'report' && status === 'done' && reportText && (
                  <div className="agent-step__detail" style={{ maxHeight: 120, overflowY: 'auto' }}>
                    {reportText}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {sessionId && (
        <div className="agent-panel__footer">
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>
            Session: {sessionId.slice(0, 16)}…
          </div>
          {isTerminal && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              {phase === 'success' && (
                <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                  ✅ Receipt emailed
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
