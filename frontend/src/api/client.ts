// AsklyCart API client
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Auth / User types ─────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  spending_cap: number;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface DBCartItem {
  id: string;
  product_id: string;
  product_name: string;
  product_price: number;
  product_category: string | null;
  quantity: number;
  added_at: string;
}

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  category?: string;
}

export interface UserOrder {
  id: string;
  session_id: string | null;
  items: OrderItem[];
  total: number;
  status: string;
  created_at: string;
}

// ── Types ────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  description: string;
  similarity_score?: number;
  match_count?: number;
  // Browse enrichments
  combo_with_id?: string;
  combo_with_name?: string;
  combo_price?: number;
  combo_label?: string;
  original_total?: number;
  alternative_type?: 'better_alternative' | 'cheaper_alternative';
}

export interface CartItem extends Product { quantity: number; }

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
  terminal_status: string | null;
  error_message: string | null;
  report_text: string | null;
  retry_count: number;
}

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

export interface BrowseResponse {
  matched_products: Product[];
  combo_products: Product[];
  related_products: Product[];
  parsed_query: Record<string, unknown>;
}

export interface ProductDetailResponse {
  product: Product;
  related_products: Product[];
  combo: {
    product: Product;
    combined_price: number;
    label: string;
    savings: number;
  } | null;
  better_alternative: Product | null;
  cheaper_alternative: Product | null;
}

// ── HTTP helper ───────────────────────────────────────────────
// Reads JWT from localStorage and attaches as Bearer on every request

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('commerceops_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  // 204 No Content — nothing to parse (e.g. DELETE /api/user/cart)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json();
}

// ── API methods ───────────────────────────────────────────────

export const api = {
  // ── Agent flow ──────────────────────────────────────────────
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
    sessionId: string, gate: string, decision: 'yes' | 'no', crosssellProductId?: string,
  ): Promise<ConsentResponse> =>
    request('/api/consent', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, gate, decision, crosssell_product_id: crosssellProductId }),
    }),

  getStatus: (sessionId: string): Promise<SessionStatus> =>
    request(`/api/session/${sessionId}/status`),

  getAuditTrail: (sessionId: string): Promise<{ session_id: string; trail: AuditEntry[]; total: number }> =>
    request(`/api/session/${sessionId}/audit`),

  // ── Browse (no agent) ───────────────────────────────────────
  browse: (query: string): Promise<BrowseResponse> =>
    request('/api/browse', { method: 'POST', body: JSON.stringify({ query }) }),

  getProduct: (productId: string): Promise<ProductDetailResponse> =>
    request(`/api/browse/product/${productId}`),

  getCatalog: (): Promise<Product[]> =>
    request('/.well-known/catalog.json'),

  // ── Auth ────────────────────────────────────────────────────
  register: (name: string, email: string, password: string, spendingCap?: number): Promise<AuthResponse> =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, spending_cap: spendingCap }),
    }),

  login: (email: string, password: string): Promise<AuthResponse> =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: (): Promise<AuthUser> =>
    request('/api/auth/me'),

  updateMe: (data: { name?: string; spending_cap?: number }): Promise<AuthUser> =>
    request('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // ── Persistent cart ─────────────────────────────────────────
  getCart: (): Promise<DBCartItem[]> =>
    request('/api/user/cart'),

  addToCart: (item: {
    product_id: string;
    product_name: string;
    product_price: number;
    product_category?: string;
    quantity?: number;
  }): Promise<DBCartItem> =>
    request('/api/user/cart', { method: 'POST', body: JSON.stringify(item) }),

  removeFromCart: (productId: string): Promise<void> =>
    request(`/api/user/cart/${productId}`, { method: 'DELETE' }),

  clearCart: (): Promise<void> =>
    request('/api/user/cart', { method: 'DELETE' }),

  // ── Orders ──────────────────────────────────────────────────
  getOrders: (): Promise<UserOrder[]> =>
    request('/api/user/orders'),

  createOrder: (data: {
    session_id?: string;
    items: OrderItem[];
    total: number;
    status?: string;
  }): Promise<UserOrder> =>
    request('/api/user/orders', { method: 'POST', body: JSON.stringify(data) }),

  // ── Convenience wrappers ─────────────────────────────────────
  /**
   * Browse products without starting the agent.
   * Returns renamed fields (matched, combo_matches, related_alternatives) for backward compat.
   */
  searchProducts: (query: string): Promise<{
    matched: Product[];
    combo_matches: Product[];
    related_alternatives: Product[];
  }> =>
    request<BrowseResponse>('/api/browse', { method: 'POST', body: JSON.stringify({ query }) })
      .then(r => ({
        matched: r.matched_products || [],
        combo_matches: r.combo_products || [],
        related_alternatives: r.related_products || [],
      })),

  /**
   * Start the AI agent flow for a given product.
   * Creates a session then runs the first search.
   */
  startAgentFlow: async (
    productId: string,
    userEmail?: string,
    spendingCap?: number,
  ): Promise<SearchResponse> => {
    const sess = await request<SessionResponse>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ user_email: userEmail, spending_cap: spendingCap }),
    });
    return request<SearchResponse>('/api/search', {
      method: 'POST',
      body: JSON.stringify({ session_id: sess.session_id, query: productId }),
    });
  },
};

