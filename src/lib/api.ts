import { endpoint, getAccessToken, jsonHeaders, refreshSession } from "./session"

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly retryAfter: number | null
  readonly etag: string | null

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown,
    retryAfter: number | null,
    etag: string | null,
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
    this.etag = etag
  }
}

export interface ApiResult<T> {
  data: T
  status: number
  etag: string | null
  replayed: boolean
}

interface Options {
  method?: string
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
  idempotencyKey?: string
  ifMatch?: string
  retry503?: boolean
  retry429?: boolean
}

const PUBLIC_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout", "/meta/health"]

export async function api<T>(path: string, options: Options = {}, retriedAuth = false, attempt = 0): Promise<ApiResult<T>> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST")
  const headers = jsonHeaders()
  if (options.body === undefined) headers.delete("Content-Type")
  const needsAuth = options.auth !== false && !PUBLIC_PATHS.some((item) => path.startsWith(item))
  if (needsAuth) {
    const token = getAccessToken()
    if (!token) await refreshSession()
    const fresh = getAccessToken()
    if (fresh) headers.set("Authorization", `Bearer ${fresh}`)
  }
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey)
  if (options.ifMatch) headers.set("If-Match", options.ifMatch)

  let response: Response
  try {
    response = await fetch(endpoint(path), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (isAbort(error)) throw error
    if ((options.retry503 ?? true) && attempt < 3 && !options.signal?.aborted) {
      await sleep(400 * 2 ** attempt, options.signal)
      return api<T>(path, options, retriedAuth, attempt + 1)
    }
    throw new ApiError(0, "NETWORK", "Sin conexión con Lumon.", null, null, null)
  }

  if (response.status === 401 && needsAuth && !retriedAuth) {
    const error = await toError(response)
    if (error.code === "TOKEN_EXPIRED") {
      await refreshSession()
      return api<T>(path, options, true, attempt)
    }
    throw error
  }

  if (response.status === 503 && (options.retry503 ?? true) && attempt < 3) {
    const error = await toError(response)
    const wait = (error.retryAfter ?? Math.min(8, 0.4 * 2 ** attempt)) * 1000
    await sleep(wait, options.signal)
    return api<T>(path, options, retriedAuth, attempt + 1)
  }

  if (response.status === 429 && (options.retry429 ?? true)) {
    const error = await toError(response)
    const wait = (error.retryAfter ?? 1) * 1000
    await sleep(wait, options.signal)
    return api<T>(path, { ...options, retry429: false }, retriedAuth)
  }

  if (!response.ok) throw await toError(response)

  const etag = response.headers.get("ETag")
  const replayed = response.headers.get("Idempotent-Replayed") === "true"
  if (response.status === 204) {
    return { data: undefined as T, status: 204, etag, replayed }
  }
  const data = (await response.json()) as T
  return { data, status: response.status, etag, replayed }
}

async function toError(response: Response): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as { error?: string; message?: string; details?: unknown } | null
  return new ApiError(
    response.status,
    payload?.error ?? `HTTP_${response.status}`,
    payload?.message ?? "La solicitud no se completó.",
    payload?.details ?? null,
    parseRetryAfter(response.headers.get("Retry-After")),
    response.headers.get("ETag"),
  )
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const when = Date.parse(header)
  if (Number.isFinite(when)) return Math.max(0, (when - Date.now()) / 1000)
  return null
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return {}
  const fields = (error.details as { fields?: unknown }).fields
  if (!fields || typeof fields !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function detailRecord(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {}
}
