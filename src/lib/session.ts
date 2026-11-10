const REFRESH_KEY = "lumon.refresh"
const CHANNEL = "lumon-session"
const LOCK = "lumon-refresh"

export type SessionNotice = "REFRESH_REUSED" | "SESSION_REVOKED" | "LOGOUT" | "TOKEN_INVALID"

type SessionEvent =
  | { type: "tokens"; accessToken: string; expiresIn: number }
  | { type: "revoked"; code: SessionNotice }
  | { type: "logout" }

type WireMessage =
  | { type: "tokens"; accessToken: string; refreshToken: string; expiresIn: number }
  | { type: "revoked"; code: SessionNotice }
  | { type: "logout" }

let accessToken: string | null = null
let expiresAt = 0
let refreshInflight: Promise<void> | null = null

const listeners = new Set<(event: SessionEvent) => void>()

function emit(event: SessionEvent) {
  listeners.forEach((listener) => listener(event))
}

export function onSession(listener: (event: SessionEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function hasFreshAccess(skewMs = 5_000): boolean {
  return accessToken !== null && Date.now() < expiresAt - skewMs
}

function remember(access: string, refresh: string, expiresIn: number, broadcast: boolean) {
  accessToken = access
  expiresAt = Date.now() + expiresIn * 1000
  localStorage.setItem(REFRESH_KEY, refresh)
  if (broadcast) {
    post({ type: "tokens", accessToken: access, refreshToken: refresh, expiresIn })
  }
  emit({ type: "tokens", accessToken: access, expiresIn })
}

export function adoptTokens(access: string, refresh: string, expiresIn: number) {
  remember(access, refresh, expiresIn, true)
}

function wipe(code: SessionNotice, broadcast: boolean) {
  accessToken = null
  expiresAt = 0
  localStorage.removeItem(REFRESH_KEY)
  if (broadcast) post({ type: "revoked", code })
  emit({ type: code === "LOGOUT" ? "logout" : "revoked", code })
}

function post(message: WireMessage) {
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(message)
  channel.close()
}

function applyWire(message: WireMessage) {
  if (message.type === "tokens") {
    accessToken = message.accessToken
    expiresAt = Date.now() + message.expiresIn * 1000
    localStorage.setItem(REFRESH_KEY, message.refreshToken)
    emit({ type: "tokens", accessToken: message.accessToken, expiresIn: message.expiresIn })
    return
  }
  accessToken = null
  expiresAt = 0
  localStorage.removeItem(REFRESH_KEY)
  emit(message.type === "logout" ? { type: "logout" } : { type: "revoked", code: message.code })
}

let wired = false
export function listenForOtherTabs() {
  if (wired) return
  wired = true
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<WireMessage>) => {
    if (event.data && typeof event.data === "object" && "type" in event.data) {
      applyWire(event.data)
    }
  }
  window.addEventListener("storage", (event) => {
    if (event.key === REFRESH_KEY && event.newValue === null) {
      accessToken = null
      expiresAt = 0
      emit({ type: "logout" })
    }
  })
}

interface RefreshBody {
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
  message?: string
}

async function rotate(token: string): Promise<void> {
  const response = await fetch(endpoint("/auth/refresh"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ refreshToken: token }),
  })
  const body = (await response.json().catch(() => ({}))) as RefreshBody
  if (!response.ok) {
    const code = body.error ?? "TOKEN_INVALID"
    if (code === "REFRESH_REUSED" || code === "SESSION_REVOKED" || code === "TOKEN_INVALID") {
      wipe(code === "REFRESH_REUSED" || code === "SESSION_REVOKED" ? code : "TOKEN_INVALID", true)
    }
    throw new Error(body.message || "No se pudo renovar la sesión.")
  }
  if (!body.accessToken || !body.refreshToken || typeof body.expiresIn !== "number") {
    throw new Error("Respuesta de refresh incompleta.")
  }
  remember(body.accessToken, body.refreshToken, body.expiresIn, true)
}

async function withRefreshLock(task: () => Promise<void>): Promise<void> {
  if (navigator.locks) {
    await navigator.locks.request(LOCK, task)
    return
  }
  await task()
}

export function refreshSession(): Promise<void> {
  if (refreshInflight) return refreshInflight
  refreshInflight = withRefreshLock(async () => {
    if (hasFreshAccess()) return
    const token = localStorage.getItem(REFRESH_KEY)
    if (!token) {
      wipe("TOKEN_INVALID", false)
      throw new Error("No hay sesión.")
    }
    await rotate(token)
  }).finally(() => {
    refreshInflight = null
  })
  return refreshInflight
}

export async function logoutSession(): Promise<void> {
  await withRefreshLock(async () => {
    const token = localStorage.getItem(REFRESH_KEY)
    accessToken = null
    expiresAt = 0
    localStorage.removeItem(REFRESH_KEY)
    post({ type: "logout" })
    emit({ type: "logout" })
    if (!token) return
    await fetch(endpoint("/auth/logout"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refreshToken: token }),
    }).catch(() => undefined)
  })
}

export function endpoint(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export function jsonHeaders(): Headers {
  const headers = new Headers()
  headers.set("Content-Type", "application/json")
  headers.set("Accept", "application/json")
  headers.set("X-Lumon-Build", __LUMON_BUILD__)
  return headers
}

export function buildHeader(): string {
  return __LUMON_BUILD__
}

export function revokeFromServer(code: SessionNotice) {
  wipe(code === "LOGOUT" ? "LOGOUT" : code, true)
}
