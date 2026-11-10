import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { api, ApiError, isAbort } from "../lib/api"
import { onLive } from "../lib/events"
import { useAuth } from "../lib/auth"
import { Banner, Spinner, inputClass, safeHttpUrl, useTitle } from "../components/ui"
import type { Department, Page, Refiner } from "../types"

export function Refiners() {
  useTitle("Personal")
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const query = sanitize(params)
  const [draft, setDraft] = useState(query.q)
  const [departments, setDepartments] = useState<Department[]>([])
  const [page, setPage] = useState<Page<Refiner> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => setDraft(query.q), [query.q])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft !== query.q) write(setParams, { ...query, q: draft, page: 0 })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [draft, query.q, query.page, query.size, query.departmentId, setParams])

  useEffect(() => {
    const ctrl = new AbortController()
    void api<Department[]>("/departments", { signal: ctrl.signal }).then((result) => setDepartments(result.data)).catch((reason: unknown) => {
      if (!isAbort(reason)) setError(reason instanceof ApiError ? reason.message : "No se cargaron los departamentos.")
    })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const search = new URLSearchParams()
    search.set("page", String(query.page))
    search.set("size", String(query.size))
    if (query.q) search.set("q", query.q)
    if (query.departmentId) search.set("departmentId", query.departmentId)
    void api<Page<Refiner>>(`/refiners?${search.toString()}`, { signal: ctrl.signal }).then((result) => {
      setPage(result.data)
      setError(null)
    }).catch((reason: unknown) => {
      if (isAbort(reason)) return
      setError(reason instanceof ApiError ? reason.message : "No se pudo abrir el directorio.")
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false)
    })
    return () => ctrl.abort()
  }, [query.page, query.size, query.q, query.departmentId])

  useEffect(() => onLive((event) => {
    if (event.type === "reset") setParams((current) => new URLSearchParams(current))
    if (event.type !== "refiner.updated") return
    setPage((current) => {
      if (!current) return current
      return {
        ...current,
        content: current.content.map((item) => item.id === event.id && event.version >= item.version ? event.refiner : item),
      }
    })
  }), [setParams])

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Personal</h1>
        {can("incidents:create") ? <Link className="rounded bg-pine px-3 py-2 text-sm text-white" to="/incidents/new">Nueva incidencia</Link> : null}
      </div>
      <form className="flex flex-wrap gap-3" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="q" className="text-sm">Buscar</label>
        <input id="q" className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 60))} />
        <label htmlFor="dept" className="text-sm">Departamento</label>
        <select id="dept" className={inputClass} value={query.departmentId} onChange={(event) => write(setParams, { ...query, departmentId: event.target.value, page: 0 })}>
          <option value="">Todos</option>
          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </form>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {loading ? <Spinner label="Cargando directorio…" /> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {page?.content.map((refiner) => {
          const profile = safeHttpUrl(refiner.profileUrl)
          return (
            <li key={refiner.id} className="flex gap-3 rounded border border-line bg-white p-3">
              <div className="h-16 w-16 shrink-0 bg-mist">
                {refiner.badge ? (
                  <img src={refiner.badge.url} alt={`Fotocheck de ${refiner.fullName}`} width={64} height={64} loading="lazy" className="h-16 w-16 object-cover" />
                ) : <span className="block p-1 text-xs">Sin fotocheck</span>}
              </div>
              <div className="min-w-0">
                <h2 className="font-medium">{refiner.fullName}</h2>
                <p className="text-sm">{refiner.title}</p>
                <p className="text-sm">{refiner.department.name} · anexo {refiner.extension}</p>
                {profile ? <a className="text-sm text-pine underline" href={profile} rel="noreferrer">Perfil</a> : refiner.profileUrl ? <p className="text-sm">{refiner.profileUrl}</p> : null}
                <p className="mt-2 flex gap-3 text-sm">
                  {can("refiners:write") ? <Link className="text-pine underline" to={`/refiners/${refiner.id}/edit`}>Editar</Link> : null}
                  {can("media:upload") ? <Link className="text-pine underline" to={`/refiners/${refiner.id}/badge`}>Fotocheck</Link> : null}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      {page && page.content.length === 0 ? <p>No hay expedientes con ese filtro.</p> : null}
      {page ? (
        <nav className="flex gap-3" aria-label="Paginación">
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={query.page <= 0} onClick={() => write(setParams, { ...query, page: query.page - 1 })}>Anterior</button>
          <p>Página {page.page + 1} de {Math.max(1, page.totalPages)}</p>
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={page.page + 1 >= page.totalPages} onClick={() => write(setParams, { ...query, page: query.page + 1 })}>Siguiente</button>
        </nav>
      ) : null}
    </main>
  )
}

function sanitize(params: URLSearchParams) {
  const page = Number(params.get("page") ?? "0")
  const size = Number(params.get("size") ?? "10")
  const department = params.get("departmentId") ?? ""
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: size === 25 || size === 50 ? size : 10,
    q: (params.get("q") ?? "").slice(0, 60),
    departmentId: /^[1-9]\d*$/.test(department) ? department : "",
  }
}

function write(setParams: (next: URLSearchParams) => void, query: ReturnType<typeof sanitize>) {
  const next = new URLSearchParams()
  if (query.page) next.set("page", String(query.page))
  if (query.size !== 10) next.set("size", String(query.size))
  if (query.q) next.set("q", query.q)
  if (query.departmentId) next.set("departmentId", query.departmentId)
  setParams(next)
}
