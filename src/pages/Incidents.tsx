import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import { Banner, Spinner, useTitle } from "../components/ui"
import type { Incident, Page } from "../types"

const SEVERITY: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Crítica",
}

export function Incidents() {
  useTitle("Incidencias")
  const { can } = useAuth()
  const [page, setPage] = useState<Page<Incident> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    void api<Page<Incident>>(`/incidents?page=${index}&size=10`).then((result) => setPage(result.data)).catch((reason: unknown) => {
      setError(reason instanceof ApiError ? reason.message : "No se pudieron cargar las incidencias.")
    })
  }, [index])

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">Incidencias</h1>
        {can("incidents:create") ? <Link className="rounded bg-pine px-3 py-2 text-sm text-white" to="/incidents/new">Nuevo reporte</Link> : null}
      </div>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {!page && !error ? <Spinner label="Cargando incidencias…" /> : null}
      <ul className="flex flex-col gap-4">
        {page?.content.map((incident) => (
          <li key={incident.id} className="rounded border border-line bg-white p-4">
            <h2 className="font-medium">{incident.title}</h2>
            <p className="text-sm">{SEVERITY[incident.severity] ?? incident.severity} · {incident.createdBy.displayName}</p>
            <p className="mt-2 whitespace-pre-wrap">{incident.description}</p>
            {incident.file ? <p className="text-sm">Archivo: {incident.file.name}</p> : null}
            <div className="mt-3 flex gap-2">
              {incident.photos.map((photo) => (
                <img key={photo.mediaId} src={photo.url} alt="" width={96} height={96} loading="lazy" className="h-24 w-24 object-cover" />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {page && page.content.length === 0 ? <p>No hay reportes.</p> : null}
      {page && page.totalPages > 1 ? (
        <nav className="flex gap-3" aria-label="Paginación">
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={index <= 0} onClick={() => setIndex((value) => value - 1)}>Anterior</button>
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={index + 1 >= page.totalPages} onClick={() => setIndex((value) => value + 1)}>Siguiente</button>
        </nav>
      ) : null}
    </main>
  )
}
