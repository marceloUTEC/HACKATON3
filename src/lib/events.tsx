import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api, isAbort } from "./api"
import { endpoint, revokeFromServer } from "./session"
import { useAuth } from "./auth"
import type { Progress, Refiner } from "../types"

export type LiveEvent =
  | { type: "refiner.updated"; id: number; version: number; refiner: Refiner }
  | { type: "refinement.created"; fileId: number; cells: Array<{ r: number; c: number }>; bin: string; progress: Progress }
  | { type: "file.completed"; fileId: number; name: string }
  | { type: "reset" }
  | { type: "contingency"; id: number; message: string }
  | { type: "contingency.resolved"; id: number }
  | { type: "session.revoked"; reason: string }

const listeners = new Set<(event: LiveEvent) => void>()

export function onLive(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emitLive(event: LiveEvent) {
  listeners.forEach((listener) => listener(event))
}

const NAMES = [
  "refiner.updated",
  "refinement.created",
  "file.completed",
  "contingency.activated",
  "contingency.resolved",
  "session.revoked",
  "stream.reset",
  "stream.superseded",
] as const

const LAST_KEY = "lumon.lastEventId"
const seen = new Set<number>()

function rememberId(id: string | null): boolean {
  if (!id) return true
  const numeric = Number(id)
  if (!Number.isFinite(numeric)) return true
  if (seen.has(numeric)) return false
  seen.add(numeric)
  if (seen.size > 4000) {
    const keep = [...seen].sort((a, b) => b - a).slice(0, 800)
    seen.clear()
    keep.forEach((value) => seen.add(value))
  }
  const current = Number(localStorage.getItem(LAST_KEY) ?? "0")
  if (numeric > current) localStorage.setItem(LAST_KEY, String(numeric))
  return true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function publish(name: string, raw: string, id: string | null): LiveEvent | null {
  if (!rememberId(id)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const data = asRecord(parsed)
  if (!data && name !== "stream.superseded") return null
  if (name === "refiner.updated" && data) {
    const refiner = data.refiner as Refiner | undefined
    const version = typeof data.version === "number" ? data.version : refiner?.version
    const refinerId = typeof data.id === "number" ? data.id : refiner?.id
    if (!refiner || typeof refinerId !== "number" || typeof version !== "number") return null
    return { type: "refiner.updated", id: refinerId, version, refiner }
  }
  if (name === "refinement.created" && data && typeof data.fileId === "number" && typeof data.bin === "string") {
    const cells = Array.isArray(data.cells) ? data.cells.filter((cell) => asRecord(cell) && typeof (cell as { r: unknown }).r === "number") as Array<{ r: number; c: number }> : []
    return { type: "refinement.created", fileId: data.fileId, cells, bin: data.bin, progress: data.progress as Progress }
  }
  if (name === "file.completed" && data && typeof data.fileId === "number") {
    return { type: "file.completed", fileId: data.fileId, name: String(data.name ?? "") }
  }
  if (name === "contingency.activated" && data && typeof data.id === "number") {
    return { type: "contingency", id: data.id, message: String(data.message ?? "Contingencia de horas extra.") }
  }
  if (name === "contingency.resolved" && data && typeof data.id === "number") {
    return { type: "contingency.resolved", id: data.id }
  }
  if (name === "session.revoked") {
    return { type: "session.revoked", reason: String(data?.reason ?? "SESSION_REVOKED") }
  }
  if (name === "stream.reset") return { type: "reset" }
  return null
}

interface EventsState {
  status: string
  contingency: { id: number; message: string; error: string | null } | null
  acknowledge: () => Promise<void>
}

const EventsContext = createContext<EventsState>({
  status: "inactivo",
  contingency: null,
  acknowledge: async () => undefined,
})

export function EventsProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth()
  const [link, setLink] = useState("inactivo")
  const [contingency, setContingency] = useState<EventsState["contingency"]>(null)

  useEffect(() => {
    return onLive((event) => {
      if (event.type === "contingency") {
        setContingency({ id: event.id, message: event.message, error: null })
      } else if (event.type === "contingency.resolved") {
        setContingency((current) => (current?.id === event.id ? null : current))
      } else if (event.type === "session.revoked") {
        const code = event.reason === "REFRESH_REUSED" ? "REFRESH_REUSED" : event.reason === "LOGOUT" ? "LOGOUT" : "SESSION_REVOKED"
        revokeFromServer(code)
      }
    })
  }, [])

  useEffect(() => {
    if (authStatus !== "in") {
      setLink("inactivo")
      return
    }
    const channel = new BroadcastChannel("lumon-events")
    const abort = new AbortController()
    channel.onmessage = (event: MessageEvent<LiveEvent>) => {
      if (event.data?.type) emitLive(event.data)
    }
    const run = async () => {
      let backoff = 1000
      while (!abort.signal.aborted) {
        try {
          setLink("conectando")
          await connectOnce(abort.signal, (next) => setLink(next), channel)
          backoff = 1000
        } catch (error) {
          if (abort.signal.aborted || isAbort(error)) return
          const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : ""
          if (code === "CLEARANCE_REQUIRED") {
            setLink("Piso de Pruebas cerrado")
            return
          }
          setLink("reconectando")
          await new Promise((resolve) => setTimeout(resolve, backoff))
          backoff = Math.min(15_000, backoff * 2)
        }
      }
    }
    const lead = navigator.locks
      ? navigator.locks.request("lumon-sse", { signal: abort.signal }, () => run())
      : run()
    void lead.catch(() => undefined)
    return () => {
      abort.abort()
      channel.close()
    }
  }, [authStatus])

  async function acknowledge() {
    if (!contingency) return
    try {
      await api(`/contingency/${contingency.id}/ack`, { method: "POST" })
      setContingency(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo confirmar."
      setContingency((current) => (current ? { ...current, error: message } : current))
    }
  }

  return (
    <EventsContext.Provider value={{ status: link, contingency, acknowledge }}>
      {children}
    </EventsContext.Provider>
  )
}

export function useEvents() {
  return useContext(EventsContext)
}

async function connectOnce(signal: AbortSignal, setLink: (status: string) => void, channel: BroadcastChannel) {
  const ticket = await api<{ ticket: string }>("/events/tickets", { method: "POST", signal })
  if (signal.aborted) return
  const last = localStorage.getItem(LAST_KEY)
  const url = `${endpoint("/events/stream")}?ticket=${encodeURIComponent(ticket.data.ticket)}${last ? `&lastEventId=${encodeURIComponent(last)}` : ""}`
  await new Promise<void>((resolve) => {
    const source = new EventSource(url)
    let settled = false
    let watchdog = window.setTimeout(() => finish(), 45_000)
    const kick = () => {
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => finish(), 45_000)
    }
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(watchdog)
      source.close()
      signal.removeEventListener("abort", finish)
      resolve()
    }
    signal.addEventListener("abort", finish)
    source.onopen = () => {
      setLink("en vivo")
      kick()
    }
    const onEvent = (event: Event) => {
      kick()
      const message = event as MessageEvent
      const live = publish(message.type || "message", String(message.data ?? ""), message.lastEventId || null)
      if (!live) {
        if ((message.type || "") === "stream.superseded") finish()
        return
      }
      emitLive(live)
      channel.postMessage(live)
    }
    for (const name of NAMES) source.addEventListener(name, onEvent)
    source.onerror = () => finish()
  })
}
