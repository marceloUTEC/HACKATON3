import { useEffect, useState, type ReactNode } from "react"
import { api } from "../lib/api"

export function HealthGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<"checking" | "ok" | "down">("checking")
  const [wait, setWait] = useState(1)

  useEffect(() => {
    let stop = false
    let timer = 0
    let delay = 1
    let ctrl = new AbortController()
    const ping = () => {
      setPhase("checking")
      ctrl.abort()
      const current = new AbortController()
      ctrl = current
      const killer = window.setTimeout(() => current.abort(), 12_000)
      void api("/meta/health", { auth: false, signal: current.signal }).then(() => {
        if (!stop) setPhase("ok")
      }).catch(() => {
        if (stop) return
        setPhase("down")
        delay = Math.min(15, delay * 2)
        setWait(delay)
        timer = window.setTimeout(ping, delay * 1000)
      }).finally(() => window.clearTimeout(killer))
    }
    ping()
    return () => {
      stop = true
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [attempt])

  if (phase === "ok") return children

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
      <p className="font-serif text-3xl text-pine">Conectando con Lumon…</p>
      <p className="text-sm" role="status">
        {phase === "checking" ? "Comprobando el servicio." : `Reintento automático en ${wait} s.`}
      </p>
      <button type="button" className="w-fit rounded bg-pine px-4 py-2 text-white" onClick={() => setAttempt((value) => value + 1)}>
        Reintentar ahora
      </button>
    </main>
  )
}
