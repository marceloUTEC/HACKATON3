import { useEffect, type ReactNode } from "react"

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · MDR`
  }, [title])
}

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="text-sm text-red-900">{error}</p> : null}
    </div>
  )
}

export const inputClass = "rounded border border-line bg-white px-3 py-2 text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"

export function Banner({ kind, children }: { kind: "error" | "info" | "ok"; children: ReactNode }) {
  const tone = kind === "error" ? "border-red-800 bg-red-50 text-red-950" : kind === "ok" ? "border-moss bg-green-50 text-green-950" : "border-pine bg-white text-ink"
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded border px-3 py-2 text-sm ${tone}`}>{children}</p>
}

export function Spinner({ label }: { label: string }) {
  return <p className="text-sm text-ink/80" role="status">{label}</p>
}

export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString()
  } catch {
    return null
  }
  return null
}
