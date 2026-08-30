// CommerceOps API client
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  description: string;
  similarity_score?: number;
  match_count?: number;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface CrossSellSuggestion {
  type: 'combo_discount' | 'complementary' | 'better_alternative' | 'cheaper_alternative';
  product: Product;
  combo_price: number | null;
  combo_label: string | null;
  with_product_id: string | null;
}

export interface AuditEntry {
  id: string;
  session_id: string;
  step: string;
  decision: string;
  reason: string;
  amount: number | null;
  consent_token: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionResponse {
  session_id: string;
  spending_cap: number;
  status: string;
  created_at: string;
}

export interface SearchResponse {
  session_id: string;
  status: string;
  search_results: Product[];
  current_gate: string | null;
  pending_gate: string | null;
  gate_prompt: string | null;
  cross_sell_suggestions: CrossSellSuggestion[];
  cart: CartItem[];
  // Terminal fields (present when agent completes without waiting for gate input)
  terminal_status: string | null;
  error_message: string | null;
  report_text: string | null;
  retry_count: number;
}

// Union of both response shapes — used by the routing helper in App.tsx
export type AgentFlowResponse = SearchResponse | ConsentResponse;

export interface ConsentResponse {
  session_id: string;
  gate: string;
  decision: string;
  status: string;
  current_gate: string | null;
  pending_gate: string | null;
  gate_prompt: string | null;
  cart: CartItem[];
  cart_total: number;
  terminal_status: string | null;
  report_text: string | null;
  error_message: string | null;
  retry_count: number;
  cross_sell_suggestions: CrossSellSuggestion[];
}

export interface SessionStatus {
  session_id: string;
  current_gate: string | null;
  pending_gate: string | null;
  gate_prompt: string | null;
  cart: CartItem[];
  cart_total: number;
  terminal_status: string | null;
  error_message: string | null;
  report_text: string | null;
  email_sent: boolean;
  retry_count: number;
  cross_sell_suggestions: CrossSellSuggestion[];
  cross_sell_shown: boolean;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  createSession: (userEmail?: string, spendingCap?: number): Promise<SessionResponse> =>
    request('/api/session', {
      method: 'POST',
      body: JSON.stringify({ user_email: userEmail, spending_cap: spendingCap }),
    }),

  search: (sessionId: string, query: string): Promise<SearchResponse> =>
    request('/api/search', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, query }),
    }),

  submitConsent: (
    sessionId: string,
    gate: string,
    decision: 'yes' | 'no',
    crosssellProductId?: string,
  ): Promise<ConsentResponse> =>
    request('/api/consent', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        gate,
        decision,
        crosssell_product_id: crosssellProductId,
      }),
    }),

  getStatus: (sessionId: string): Promise<SessionStatus> =>
    request(`/api/session/${sessionId}/status`),

  getAuditTrail: (sessionId: string): Promise<{ session_id: string; trail: AuditEntry[]; total: number }> =>
    request(`/api/session/${sessionId}/audit`),

  getCatalog: (): Promise<Product[]> =>
    request('/.well-known/catalog.json'),
};
