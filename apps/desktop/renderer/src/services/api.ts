export interface Result<T = unknown> {
  data: T
  code: number
  msg: string
  errorCode?: string
  hasResponse?: boolean
}

export interface AuthResponse {
  token: string
  exp: number
  user: {
    id: string
    email: string
    username: string
    avatar?: string | null
  }
}

// Development requests use Vite's `/api` proxy; packaged builds call the configured API directly.
const configuredApiUrl = import.meta.env.PUBLIC_API_URL?.trim() || 'http://localhost:3800'
const apiBaseUrl = import.meta.env.DEV ? '/' : `${configuredApiUrl.replace(/\/$/, '')}/`

export async function request<D>(input: {
  method: 'GET' | 'POST'
  url: string
  data?: unknown
  skipAuth?: boolean
}): Promise<Result<D>> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = window.localStorage.getItem('botToken')
    if (token && !input.skipAuth) {
      headers.Authorization = token
    }

    const response = await fetch(`${apiBaseUrl}${input.url.replace(/^\//, '')}`, {
      method: input.method,
      headers,
      body: input.data === undefined ? undefined : JSON.stringify(input.data),
    })
    const payload = (await response.json().catch(() => null)) as Result<D> | null
    if (response.status === 401 && !input.skipAuth) {
      window.dispatchEvent(new Event('robbot-auth-expired'))
    }
    return payload ?? {
      code: response.ok ? 1 : -1,
      msg: response.statusText || 'Request failed',
      data: null as D,
      hasResponse: true,
    }
  } catch (cause) {
    return {
      code: -1,
      msg: cause instanceof Error ? cause.message : 'Request failed',
      data: null as D,
      hasResponse: false,
    }
  }
}

export function authLogin(data: { email: string; password: string }) {
  return request<AuthResponse>({ method: 'POST', url: '/api/auth/login', data, skipAuth: true })
}

export function authRegister(data: { email: string; password: string }) {
  return request<AuthResponse>({ method: 'POST', url: '/api/auth/register', data, skipAuth: true })
}
