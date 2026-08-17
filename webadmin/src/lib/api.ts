/**
 * API client.
 *
 * Access tokens live 15 minutes, so a long admin session will hit 401s during
 * normal use. Rather than bouncing the user to the login screen, a 401 triggers
 * one refresh and the original request is replayed. Concurrent 401s share a
 * single refresh promise so a dashboard with six parallel queries does not fire
 * six refreshes and invalidate its own rotating token.
 */
const BASE = '/api';

const ACCESS_KEY = 'laostay.accessToken';
const REFRESH_KEY = 'laostay.refreshToken';

export type AdminRole = 'super_admin' | 'finance' | 'staff';

/**
 * Whoever is signed in. The API has one `users` table for every kind of
 * account, so `role` says which kind and `adminRole` narrows it further — this
 * app refuses anyone whose `role` is not ADMIN.
 */
export interface Identity {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  adminRole: AdminRole | null;
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
};

/** Fired when refresh fails, so the app can drop back to the login screen. */
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
  /** Set for login/refresh, which must not carry or renew a token. */
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
      throw new ApiError(401, 'ເຊສຊັນໝົດອາຍຸ · Session expired, please log in again');
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
 * One sign-in endpoint for everyone.
 *
 * Which is why the check below matters: a customer's credentials are perfectly
 * valid at `/auth/login` and would hand back a working token. The token simply
 * opens nothing here — every admin route is guarded — so refusing at sign-in is
 * about saying why, rather than letting them in to a console of 403s.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { identifier: email, password },
    anonymous: true,
  });

  if (res.user.role !== 'ADMIN') {
    throw new ApiError(403, 'ບັນຊີນີ້ບໍ່ແມ່ນຜູ້ດູແລລະບົບ · This account is not an administrator');
  }
  return res;
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
