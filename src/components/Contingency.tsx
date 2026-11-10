import { useEffect, useRef } from "react"
import { useEvents } from "../lib/events"

export function Contingency() {
  const { contingency, acknowledge } = useEvents()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contingency) return
    const node = panel.current
    const focusable = node?.querySelector<HTMLElement>("button")
    focusable?.focus()
  }, [contingency])

  if (!contingency) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cont-title"
        className="w-full max-w-md rounded bg-paper p-6 shadow-lg"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return
          const items = panel.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")
          if (!items || items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          if (!first || !last) return
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id="cont-title" className="font-serif text-2xl">Contingencia</h2>
        <p className="mt-3">{contingency.message}</p>
        {contingency.error ? <p role="alert" className="mt-3 text-sm text-red-900">{contingency.error}</p> : null}
        <button type="button" className="mt-5 rounded bg-pine px-4 py-2 text-white" onClick={() => void acknowledge()}>
          Confirmar
        </button>
      </div>
    </div>
  )
}
