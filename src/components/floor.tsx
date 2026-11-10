import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react"
import { api } from "../lib/api"
import { ApiError } from "../lib/api"

export interface FloorMember {
  userId: number
  displayName: string
}

export interface FloorClaim {
  claimId: string
  userId: number
  cells: Array<{ r: number; c: number }>
  expiresAt?: string
}

export interface FloorCursor {
  userId: number
  name: string
  r: number
  c: number
}

const FATAL = new Set([4400, 4403, 4404, 4423])

let cursorSnapshot: FloorCursor[] = []
const cursorListeners = new Set<() => void>()

function setCursors(next: FloorCursor[]) {
  cursorSnapshot = next
  cursorListeners.forEach((listener) => listener())
}

export function useCursorSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      cursorListeners.add(listener)
      return () => cursorListeners.delete(listener)
    },
    () => cursorSnapshot,
  )
}

interface ClaimResult {
  ok: boolean
  reason?: string
  holder?: string
  claimId?: string
  cells?: Array<{ r: number; c: number }>
}

export function useFloor(fileId: number | null, selfId: number | null) {
  const [status, setStatus] = useState("desconectado")
  const [detail, setDetail] = useState("")
  const [members, setMembers] = useState<FloorMember[]>([])
  const [claims, setClaims] = useState<FloorClaim[]>([])
  const apiRef = useRef<FloorApi | null>(null)

  useEffect(() => {
    if (fileId == null) return
    const connection = connectFloor(fileId, selfId, {
      setStatus,
      setDetail,
      setMembers,
      setClaims,
    })
    apiRef.current = connection
    return () => {
      apiRef.current = null
      connection.stop()
    }
  }, [fileId, selfId])

  return {
    status,
    detail,
    members,
    claims,
    sendCursor: (r: number, c: number) => apiRef.current?.sendCursor(r, c),
    claim: (r: number, c: number) => apiRef.current?.claim(r, c) ?? Promise.resolve<ClaimResult>({ ok: false, reason: "OFFLINE" }),
    release: () => apiRef.current?.release(),
  }
}

interface FloorApi {
  stop: () => void
  sendCursor: (r: number, c: number) => void
  claim: (r: number, c: number) => Promise<ClaimResult>
  release: () => void
}

function connectFloor(
  fileId: number,
  selfId: number | null,
  hooks: {
    setStatus: (value: string) => void
    setDetail: (value: string) => void
    setMembers: Dispatch<SetStateAction<FloorMember[]>>
    setClaims: Dispatch<SetStateAction<FloorClaim[]>>
  },
): FloorApi {
  let stopped = false
  let ws: WebSocket | null = null
  let attempt = 0
  let ticketFails = 0
  let gaveUp = false
  let lastSeq = 0
  let myClaimId: string | null = null
  let pingTimer = 0
  let missedPongs = 0
  let lastCursor = 0
  const cursors = new Map<number, FloorCursor>()
  const pending = new Map<string, (result: ClaimResult) => void>()
  let renewTimer = 0

  const clearFloor = () => {
    cursors.clear()
    setCursors([])
    hooks.setMembers([])
    hooks.setClaims([])
    lastSeq = 0
  }

  const send = (payload: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }

  const stopPing = () => {
    window.clearInterval(pingTimer)
    pingTimer = 0
  }

  const startPing = () => {
    stopPing()
    missedPongs = 0
    pingTimer = window.setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      missedPongs += 1
      if (missedPongs >= 2) {
        ws.close()
        return
      }
      send({ type: "ping", t: Date.now() })
    }, 15_000)
  }

  const scheduleRenew = () => {
    window.clearInterval(renewTimer)
    renewTimer = window.setInterval(() => {
      if (myClaimId) send({ type: "renew", claimId: myClaimId })
    }, 10_000)
  }

  function onMessage(raw: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const type = String(message.type ?? "")
    const seq = typeof message.seq === "number" ? message.seq : null
    if (seq !== null && type !== "snapshot") {
      if (lastSeq !== 0 && seq > lastSeq + 1) send({ type: "resync" })
      if (seq > lastSeq) lastSeq = seq
    }
    if (type === "snapshot") {
      lastSeq = seq ?? lastSeq
      cursors.clear()
      setCursors([])
      hooks.setMembers(readMembers(message.members))
      hooks.setClaims(readClaims(message.claims))
      return
    }
    if (type === "member.joined" || type === "member.left") {
      const userId = typeof message.userId === "number" ? message.userId : null
      if (userId == null) return
      hooks.setMembers((current) => {
        const list = current.filter((item) => item.userId !== userId)
        if (type === "member.joined") {
          list.push({ userId, displayName: String(message.displayName ?? "Refinador") })
        } else {
          cursors.delete(userId)
          setCursors([...cursors.values()])
        }
        return dedupe(list)
      })
      return
    }
    if (type === "cursor" && typeof message.userId === "number") {
      if (message.userId === selfId) return
      cursors.set(message.userId, {
        userId: message.userId,
        name: String(message.displayName ?? "Refinador"),
        r: Number(message.r ?? 0),
        c: Number(message.c ?? 0),
      })
      setCursors([...cursors.values()])
      return
    }
    if (type === "pong") {
      missedPongs = 0
      return
    }
    if (type === "claim.granted" && typeof message.requestId === "string") {
      myClaimId = String(message.claimId ?? "")
      scheduleRenew()
      pending.get(message.requestId)?.({
        ok: true,
        claimId: myClaimId,
        cells: readCells(message.cells),
      })
      pending.delete(message.requestId)
      hooks.setClaims((current) => upsertClaim(current, {
        claimId: myClaimId ?? "",
        userId: selfId ?? -1,
        cells: readCells(message.cells),
      }))
      return
    }
    if (type === "claim.denied" && typeof message.requestId === "string") {
      const holder = message.holder && typeof message.holder === "object"
        ? String((message.holder as { displayName?: string }).displayName ?? "otro refinador")
        : undefined
      pending.get(message.requestId)?.({ ok: false, reason: String(message.reason ?? "HELD"), holder })
      pending.delete(message.requestId)
      return
    }
    if ((type === "claim.updated" || type === "claim.released") && typeof message.claimId === "string") {
      if (message.claimId === myClaimId && type === "claim.released") myClaimId = null
      hooks.setClaims((current) => {
        if (type === "claim.released") return current.filter((item) => item.claimId !== message.claimId)
        return upsertClaim(current, {
          claimId: String(message.claimId),
          userId: typeof message.userId === "number" ? message.userId : -1,
          cells: readCells(message.cells),
          expiresAt: typeof message.expiresAt === "string" ? message.expiresAt : undefined,
        })
      })
    }
  }

  async function open() {
    if (stopped || gaveUp) return
    hooks.setStatus("conectando")
    let ticket: string
    try {
      const result = await api<{ ticket: string }>("/floor/tickets", { method: "POST", body: { fileId } })
      ticket = result.data.ticket
      ticketFails = 0
    } catch (error) {
      if (stopped) return
      if (error instanceof ApiError && error.code === "CLEARANCE_REQUIRED") {
        hooks.setStatus("sin piso")
        hooks.setDetail("El Piso de Pruebas todavía no está abierto. Puedes refinar igual.")
        gaveUp = true
        return
      }
      const delay = Math.min(10_000, 500 * 2 ** attempt)
      attempt += 1
      hooks.setStatus("reconectando")
      window.setTimeout(() => void open(), delay)
      return
    }
    if (stopped) return
    const base = import.meta.env.VITE_WS_BASE_URL.replace(/\/$/, "")
    ws = new WebSocket(`${base}/floor/ws?ticket=${encodeURIComponent(ticket)}`)
    ws.onopen = () => {
      attempt = 0
      hooks.setStatus("en vivo")
      hooks.setDetail("")
      startPing()
      send({ type: "ping", t: Date.now() })
    }
    ws.onmessage = (event) => onMessage(String(event.data))
    ws.onclose = (event) => {
      stopPing()
      clearFloor()
      myClaimId = null
      if (stopped || gaveUp) return
      const code = event.code
      if (FATAL.has(code)) {
        gaveUp = true
        hooks.setStatus("detenido")
        hooks.setDetail(event.reason || `Conexión cerrada (${code}).`)
        return
      }
      if (code === 4401) {
        ticketFails += 1
        if (ticketFails >= 2) {
          gaveUp = true
          hooks.setStatus("detenido")
          hooks.setDetail("El ticket del piso no sirve. Recarga la grilla.")
          return
        }
        void open()
        return
      }
      hooks.setStatus("reconectando")
      hooks.setDetail(event.reason || "")
      if (code === 4429) {
        window.setTimeout(() => void open(), 10_000)
        return
      }
      const delay = code === 4408 ? 0 : Math.min(10_000, 400 * 2 ** attempt)
      attempt += 1
      window.setTimeout(() => void open(), delay)
    }
  }

  void open()

  return {
    stop: () => {
      stopped = true
      stopPing()
      window.clearInterval(renewTimer)
      if (myClaimId) send({ type: "release", claimId: myClaimId })
      ws?.close()
      clearFloor()
      for (const resolve of pending.values()) resolve({ ok: false, reason: "OFFLINE" })
      pending.clear()
    },
    sendCursor: (r, c) => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastCursor < 100) return
      lastCursor = now
      send({ type: "cursor", r, c })
    },
    claim: (r, c) => new Promise<ClaimResult>((resolve) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, reason: "OFFLINE" })
        return
      }
      const requestId = crypto.randomUUID()
      pending.set(requestId, resolve)
      send({ type: "claim", requestId, r, c })
      window.setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId)
          resolve({ ok: false, reason: "TIMEOUT" })
        }
      }, 6_000)
    }),
    release: () => {
      if (!myClaimId) return
      send({ type: "release", claimId: myClaimId })
      myClaimId = null
      window.clearInterval(renewTimer)
    },
  }
}

function readMembers(value: unknown): FloorMember[] {
  if (!Array.isArray(value)) return []
  const list: FloorMember[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const userId = (item as { userId?: unknown }).userId
    if (typeof userId !== "number") continue
    list.push({ userId, displayName: String((item as { displayName?: unknown }).displayName ?? "Refinador") })
  }
  return dedupe(list)
}

function readClaims(value: unknown): FloorClaim[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const claimId = (item as { claimId?: unknown }).claimId
    if (typeof claimId !== "string") return []
    return [{
      claimId,
      userId: typeof (item as { userId?: unknown }).userId === "number" ? (item as { userId: number }).userId : -1,
      cells: readCells((item as { cells?: unknown }).cells),
      expiresAt: typeof (item as { expiresAt?: unknown }).expiresAt === "string" ? (item as { expiresAt: string }).expiresAt : undefined,
    }]
  })
}

function readCells(value: unknown): Array<{ r: number; c: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const r = (item as { r?: unknown }).r
    const c = (item as { c?: unknown }).c
    if (typeof r !== "number" || typeof c !== "number") return []
    return [{ r, c }]
  })
}

function dedupe(list: FloorMember[]): FloorMember[] {
  const map = new Map<number, FloorMember>()
  for (const item of list) map.set(item.userId, item)
  return [...map.values()]
}

function upsertClaim(list: FloorClaim[], claim: FloorClaim): FloorClaim[] {
  return [...list.filter((item) => item.claimId !== claim.claimId), claim]
}
