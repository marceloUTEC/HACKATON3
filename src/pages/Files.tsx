import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { api, ApiError, isAbort } from "../lib/api"
import { onLive } from "../lib/events"
import { Banner, Spinner, inputClass, useTitle } from "../components/ui"
import type { DataFile, Page, Progress } from "../types"

const SORTS = ["updatedAt,desc", "name,asc", "progress,desc"] as const
const SIZES = [10, 25, 50] as const

export function Files() {
  useTitle("Archivos")
  const [params, setParams] = useSearchParams()
  const query = sanitize(params)
  const [draft, setDraft] = useState(query.q)
  const [page, setPage] = useState<Page<DataFile> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setDraft(query.q)
  }, [query.q])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft === query.q) return
      write(setParams, { ...query, q: draft, page: 0 })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [draft, query.q, query.page, query.size, query.sort, query.status, setParams])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const search = new URLSearchParams()
    search.set("page", String(query.page))
    search.set("size", String(query.size))
    search.set("sort", query.sort)
    if (query.q) search.set("q", query.q)
    if (query.status) search.set("status", query.status)
    void api<Page<DataFile>>(`/files?${search.toString()}`, { signal: ctrl.signal }).then((result) => {
      setPage(result.data)
      setError(null)
    }).catch((reason: unknown) => {
      if (isAbort(reason)) return
      setError(reason instanceof ApiError ? reason.message : "No se pudieron cargar los archivos.")
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false)
    })
    return () => ctrl.abort()
  }, [query.page, query.size, query.sort, query.q, query.status])

  useEffect(() => {
    return onLive((event) => {
      if (!page) return
      if (event.type === "refinement.created" || event.type === "file.completed") {
        setPage((current) => current ? patchFile(current, event) : current)
      }
      if (event.type === "reset") setParams((current) => new URLSearchParams(current))
    })
  }, [page, setParams])

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <h1 className="font-serif text-3xl">Archivos</h1>
      <form className="flex flex-wrap gap-3" onSubmit={(event) => event.preventDefault()}>
        <label className="text-sm" htmlFor="q">Buscar</label>
        <input id="q" className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 60))} />
        <label className="text-sm" htmlFor="status">Estado</label>
        <select id="status" className={inputClass} value={query.status} onChange={(event) => write(setParams, { ...query, status: event.target.value, page: 0 })}>
          <option value="">Todos</option>
          <option value="ACTIVE">Activos</option>
          <option value="COMPLETE">Completos</option>
        </select>
        <label className="text-sm" htmlFor="sort">Orden</label>
        <select id="sort" className={inputClass} value={query.sort} onChange={(event) => write(setParams, { ...query, sort: event.target.value, page: 0 })}>
          <option value="updatedAt,desc">Actualización</option>
          <option value="name,asc">Nombre</option>
          <option value="progress,desc">Progreso</option>
        </select>
        <label className="text-sm" htmlFor="size">Tamaño</label>
        <select id="size" className={inputClass} value={query.size} onChange={(event) => write(setParams, { ...query, size: Number(event.target.value), page: 0 })}>
          {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </form>
      {error ? <Banner kind="error">{error} <button type="button" className="underline" onClick={() => setParams(new URLSearchParams(params))}>Reintentar</button></Banner> : null}
      {loading ? <Spinner label="Cargando archivos…" /> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2">Nombre</th>
              <th scope="col">Tamaño</th>
              <th scope="col">Estado</th>
              <th scope="col">Progreso</th>
              <th scope="col">Errores</th>
            </tr>
          </thead>
          <tbody>
            {page?.content.map((file) => (
              <tr key={file.id} className="border-b border-line">
                <td className="py-2"><Link className="text-pine underline" to={`/files/${file.id}/refine`}>{file.name}</Link></td>
                <td>{file.rows} × {file.cols}</td>
                <td>{file.status === "COMPLETE" ? "Completo" : "Activo"}</td>
                <td>{Math.round(file.progress.overall * 100)}%</td>
                <td>{file.mistakes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page && page.content.length === 0 ? <p>No hay archivos con ese filtro.</p> : null}
      {page ? (
        <nav className="flex items-center gap-3" aria-label="Paginación">
          <button type="button" className="rounded border border-pine px-3 py-1 disabled:opacity-40" disabled={query.page <= 0} onClick={() => write(setParams, { ...query, page: query.page - 1 })}>Anterior</button>
          <p>Página {page.page + 1} de {Math.max(1, page.totalPages)}</p>
          <button type="button" className="rounded border border-pine px-3 py-1 disabled:opacity-40" disabled={page.page + 1 >= page.totalPages} onClick={() => write(setParams, { ...query, page: query.page + 1 })}>Siguiente</button>
        </nav>
      ) : null}
    </main>
  )
}

function sanitize(params: URLSearchParams) {
  const page = Number(params.get("page") ?? "0")
  const size = Number(params.get("size") ?? "10")
  const sort = params.get("sort") ?? "updatedAt,desc"
  const status = params.get("status") ?? ""
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: size === 25 || size === 50 ? size : 10,
    sort: SORTS.includes(sort as (typeof SORTS)[number]) ? sort : "updatedAt,desc",
    status: status === "ACTIVE" || status === "COMPLETE" ? status : "",
    q: (params.get("q") ?? "").slice(0, 60),
  }
}

function write(setParams: ReturnType<typeof useSearchParams>[1], query: ReturnType<typeof sanitize>) {
  const next = new URLSearchParams()
  if (query.page) next.set("page", String(query.page))
  if (query.size !== 10) next.set("size", String(query.size))
  if (query.sort !== "updatedAt,desc") next.set("sort", query.sort)
  if (query.status) next.set("status", query.status)
  if (query.q) next.set("q", query.q)
  setParams(next)
}

function patchFile(page: Page<DataFile>, event: { type: string; fileId?: number; progress?: Progress; name?: string }): Page<DataFile> {
  if (event.type === "reset" || typeof event.fileId !== "number") return page
  return {
    ...page,
    content: page.content.map((file) => {
      if (file.id !== event.fileId) return file
      if (event.type === "file.completed") return { ...file, status: "COMPLETE", progress: { ...file.progress, overall: 1 } }
      if (event.progress) return { ...file, progress: event.progress }
      return file
    }),
  }
}
