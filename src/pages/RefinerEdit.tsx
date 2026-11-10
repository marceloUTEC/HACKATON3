import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, ApiError, detailRecord } from "../lib/api"
import { onLive } from "../lib/events"
import { Banner, Field, Spinner, inputClass, useTitle } from "../components/ui"
import type { Department, Refiner } from "../types"

interface Draft {
  title: string
  extension: string
  bio: string
  departmentId: string
}

export function RefinerEdit() {
  const params = useParams()
  const id = Number(params.id)
  useTitle("Editar expediente")
  const [refiner, setRefiner] = useState<Refiner | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [conflict, setConflict] = useState<Refiner | null>(null)
  const [conflictEtag, setConflictEtag] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    void Promise.all([
      api<Refiner>(`/refiners/${id}`, { signal: ctrl.signal }),
      api<Department[]>("/departments", { signal: ctrl.signal }),
    ]).then(([person, deps]) => {
      setRefiner(person.data)
      setEtag(person.etag ?? `"${person.data.version}"`)
      setDraft(toDraft(person.data))
      setDepartments(deps.data)
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError) setError(reason.message)
    })
    return () => ctrl.abort()
  }, [id])

  useEffect(() => onLive((event) => {
    if (event.type === "refiner.updated" && event.id === id && refiner && event.version > refiner.version) {
      setStale(true)
    }
  }), [id, refiner])

  async function save(match: string) {
    if (!draft) return
    setPending(true)
    setSaved(null)
    try {
      const result = await api<Refiner>(`/refiners/${id}`, {
        method: "PATCH",
        ifMatch: match,
        body: {
          title: draft.title,
          extension: draft.extension,
          bio: draft.bio,
          departmentId: Number(draft.departmentId),
        },
      })
      setRefiner(result.data)
      setEtag(result.etag ?? `"${result.data.version}"`)
      setDraft(toDraft(result.data))
      setConflict(null)
      setStale(false)
      setSaved("Expediente guardado.")
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 412) {
        const current = detailRecord(reason.details).current
        const nextEtag = reason.etag ?? match
        if (current && typeof current === "object" && "title" in current) {
          setConflict(current as Refiner)
          setConflictEtag(nextEtag)
        } else {
          const fresh = await api<Refiner>(`/refiners/${id}`)
          setConflict(fresh.data)
          setConflictEtag(fresh.etag ?? nextEtag)
        }
      } else {
        setError(reason instanceof Error ? reason.message : "No se pudo guardar.")
      }
    } finally {
      setPending(false)
    }
  }

  if (error && !refiner) return <main className="p-6"><Banner kind="error">{error}</Banner></main>
  if (!refiner || !draft) return <main className="p-6"><Spinner label="Cargando expediente…" /></main>

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <h1 className="font-serif text-3xl">{refiner.fullName}</h1>
      <Link className="text-sm text-pine underline" to="/refiners">Volver al directorio</Link>
      {stale ? <Banner kind="info">Este expediente cambió mientras lo editabas. Si guardas y hay conflicto, podrás comparar.</Banner> : null}
      {saved ? <Banner kind="ok">{saved}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {conflict ? (
        <section className="rounded border border-red-800 bg-white p-4">
          <h2 className="font-serif text-2xl">Conflicto de versión</h2>
          <p className="mt-2 text-sm">Alguien guardó este expediente después de que lo abriste. Elige qué hacer. Nada se sobrescribe solo.</p>
          <table className="mt-3 w-full text-sm">
            <thead><tr><th scope="col" className="text-left">Campo</th><th scope="col" className="text-left">Lo que escribiste</th><th scope="col" className="text-left">En el servidor</th></tr></thead>
            <tbody>
              <Compare label="Título" mine={draft.title} theirs={conflict.title} />
              <Compare label="Anexo" mine={draft.extension} theirs={conflict.extension} />
              <Compare label="Bio" mine={draft.bio} theirs={conflict.bio} />
              <Compare label="Departamento" mine={draft.departmentId} theirs={String(conflict.department?.id ?? "")} />
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="rounded bg-pine px-3 py-2 text-white" onClick={() => void save(conflictEtag ?? etag ?? `"${conflict.version}"`)}>Guardar lo que escribí</button>
            <button type="button" className="rounded border px-3 py-2" onClick={() => { setDraft(toDraft(conflict)); setRefiner(conflict); setEtag(conflictEtag ?? `"${conflict.version}"`); setConflict(null); setStale(false) }}>Quedarme con el servidor</button>
          </div>
        </section>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (etag) void save(etag) }}>
          <Field id="title" label="Título">
            <input id="title" className={inputClass} required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </Field>
          <Field id="extension" label="Anexo">
            <input id="extension" className={inputClass} required pattern="[0-9]{3,6}" value={draft.extension} onChange={(event) => setDraft({ ...draft, extension: event.target.value })} />
          </Field>
          <Field id="bio" label="Biografía">
            <textarea id="bio" className={inputClass} maxLength={2000} rows={6} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} />
          </Field>
          <Field id="department" label="Departamento">
            <select id="department" className={inputClass} value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <button type="submit" className="w-fit rounded bg-pine px-4 py-2 text-white disabled:opacity-50" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
        </form>
      )}
    </main>
  )
}

function toDraft(refiner: Refiner): Draft {
  return {
    title: refiner.title,
    extension: refiner.extension,
    bio: refiner.bio,
    departmentId: String(refiner.department.id),
  }
}

function Compare({ label, mine, theirs }: { label: string; mine: string; theirs: string }) {
  return (
    <tr className="align-top">
      <th scope="row" className="py-1 pr-2 text-left">{label}</th>
      <td className="py-1 pr-2">{mine}</td>
      <td className="py-1">{theirs}</td>
    </tr>
  )
}
