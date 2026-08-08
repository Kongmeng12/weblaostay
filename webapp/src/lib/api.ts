/**
 * API client.
 *
 * The same shape as the admin panel's, and for the same reason: access tokens
 * live 15 minutes, so a guest who spends a while choosing a room will meet 401s
 * mid-journey. A 401 triggers one refresh and replays the original request
 * rather than throwing them back to a login screen with a half-filled form.
 *
 * **The single-flight refresh is not an optimisation.** The backend rotates
 * refresh tokens and treats a reused one as a stolen credential — it revokes
 * every session for that account. A page that fires four queries at once and
 * lets each start its own refresh would hand the backend three reused tokens
 * and sign the guest out of everything.
 */
const BASE = '/api';

const ACCESS_KEY = 'laostay.guest.accessToken';
const REFRESH_KEY = 'laostay.guest.refreshToken';

/**
 * Whoever is signed in. One `users` table serves guests, hosts and staff, so
 * `role` says which — and this app accepts only `CUSTOMER`.
 */
export interface Identity {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  adminRole: string | null;
  fullName: string | null;
  phone: string | null;
  isVerified: boolean;
  partnerId: string | null;
  partnerStatus: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isConflict() {
    return this.status === 409;
  }
  get isNotFound() {
    return this.status === 404;
  }
}

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  get has() {
    return !!localStorage.getItem(ACCESS_KEY);
  },
};

/** Fired when refresh fails, so the app can drop back to signed-out. */
type LogoutHandler = () => void;
let onAuthLost: LogoutHandler = () => undefined;
export function setAuthLostHandler(fn: LogoutHandler) {
  onAuthLost = fn;
}

let refreshInFlight: Promise<boolean> | null = null;

async function runRefresh(): Promise<boolean> {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return false;

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    tokens.clear();
    return false;
  }

  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  tokens.set(data.accessToken, data.refreshToken);
  return true;
}

function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function readError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* some errors have no body */
  }
  const message =
    (body as { message?: string | string[] } | null)?.message ?? `ຄຳຂໍລົ້ມເຫຼວ (${res.status})`;
  return new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message, body);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set for login/register/refresh, which must not carry or renew a token. */
  anonymous?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false } = opts;

  const send = async (): Promise<Response> => {
    const access = tokens.access();
    return fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Browsing is public, so an anonymous visitor sends no header at all
        // and still gets search results.
        ...(!anonymous && access ? { Authorization: `Bearer ${access}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let res = await send();

  if (res.status === 401 && !anonymous && tokens.refresh()) {
    const renewed = await refreshOnce();
    if (renewed) {
      res = await send();
    } else {
      onAuthLost();
      throw new ApiError(401, 'ເຊສຊັນໝົດອາຍຸ · ກະລຸນາເຂົ້າສູ່ລະບົບອີກຄັ້ງ');
    }
  }

  if (res.status === 401 && !anonymous) {
    onAuthLost();
  }

  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── auth calls ───────────────────────────────────────────────────────────────

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: Identity;
}

/**
 * One sign-in endpoint serves the whole platform, so the role is checked here.
 *
 * A host's password is perfectly valid and would return real tokens — they
 * simply have no guest account behind them. Saying so at the door is kinder
 * than letting them in to a page of 403s, and it points them at the app they
 * actually want.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });

  if (res.user.role !== 'CUSTOMER') {
    throw new ApiError(
      403,
      res.user.role === 'PARTNER'
        ? 'ບັນຊີນີ້ເປັນຂອງເຈົ້າຂອງທີ່ພັກ · ກະລຸນາໃຊ້ແອັບ LaoStay Partner'
        : 'ບັນຊີນີ້ໃຊ້ກັບໜ້ານີ້ບໍ່ໄດ້',
    );
  }
  return res;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export function register(input: RegisterInput) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });
}

export function me() {
  return request<Identity>('/auth/me');
}

export async function logout() {
  const refreshToken = tokens.refresh();
  if (refreshToken) {
    await request('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
      anonymous: true,
    }).catch(() => undefined);
  }
  tokens.clear();
}

export function requestPasswordReset(email: string) {
  return request<{ sent: true; devToken?: string }>('/auth/password/forgot', {
    method: 'POST',
    body: { email },
    anonymous: true,
  });
}

export function resetPassword(token: string, password: string) {
  return request<{ ok: true }>('/auth/password/reset', {
    method: 'POST',
    body: { token, password },
    anonymous: true,
  });
}

/** Builds "?a=1&b=2", skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
