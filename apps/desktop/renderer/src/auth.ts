import type { AuthResponse } from './services/api'

const TOKEN_FIELD = 'botToken'
const EMAIL_FIELD = 'botEmail'
const ID_FIELD = 'botUserId'
const NAME_FIELD = 'botUsername'
const AVATAR_FIELD = 'botAvatar'
const EXP_FIELD = 'exp'

export interface AuthUser {
  id: string
  email: string
  username: string
  avatar?: string | null
}

export function getAuthUser(): AuthUser | null {
  const token = localStorage.getItem(TOKEN_FIELD)?.trim()
  const id = localStorage.getItem(ID_FIELD)?.trim()
  const exp = Number(localStorage.getItem(EXP_FIELD))
  if (!token || !id || !Number.isFinite(exp) || Date.now() >= exp * 1000) return null
  return {
    id,
    email: localStorage.getItem(EMAIL_FIELD) ?? '',
    username: localStorage.getItem(NAME_FIELD) ?? '',
    avatar: localStorage.getItem(AVATAR_FIELD),
  }
}

export function saveAuth(data: AuthResponse): AuthUser {
  localStorage.setItem(TOKEN_FIELD, data.token)
  localStorage.setItem(EXP_FIELD, String(data.exp))
  localStorage.setItem(ID_FIELD, data.user.id)
  localStorage.setItem(EMAIL_FIELD, data.user.email)
  localStorage.setItem(NAME_FIELD, data.user.username ?? '')
  if (data.user.avatar) localStorage.setItem(AVATAR_FIELD, data.user.avatar)
  const user = data.user
  window.dispatchEvent(new Event('robbot-auth-changed'))
  return user
}

export function clearAuth(): void {
  for (const key of [TOKEN_FIELD, EXP_FIELD, ID_FIELD, EMAIL_FIELD, NAME_FIELD, AVATAR_FIELD]) localStorage.removeItem(key)
  window.dispatchEvent(new Event('robbot-auth-changed'))
}
