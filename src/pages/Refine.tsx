import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, ApiError, detailRecord, isAbort } from "../lib/api"
import { collectGroup, type GroupCell } from "../lib/groups"
import { onLive } from "../lib/events"
import { dropTiles, loadTile, paintCells } from "../lib/tiles"
import { useAuth } from "../lib/auth"
import { CELL, Grid } from "../components/Grid"
import { useCursorSnapshot, useFloor } from "../components/floor"
import { Banner, Spinner, useTitle } from "../components/ui"
import { BIN_CHAR, BINS, type Bin, type DataFile, type Progress, type RefineResult, type Rules } from "../types"

const REASONS: Record<string, string> = {
  BELOW_THRESHOLD: "Hay celdas que no dan miedo.",
  NOT_CONNECTED: "Las celdas no forman un solo grupo.",
  INCOMPLETE: "Faltan celdas del grupo. Vuelve a seleccionarlo.",
  SIZE_OUT_OF_RANGE: "El grupo es ruido: está fuera del tamaño permitido.",
}

export function Refine() {
  const params = useParams()
  const fileId = Number(params.id)
  const { me, can } = useAuth()
  const [file, setFile] = useState<DataFile | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [group, setGroup] = useState<GroupCell[] | null>(null)
  const [noise, setNoise] = useState(false)
  const [refined, setRefined] = useState(false)
  const [suggested, setSuggested] = useState<Bin | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const intent = useRef<{ key: string; body: string } | null>(null)
  const lock = useRef(false)
  const selectAbort = useRef<AbortController | null>(null)
  const floor = useFloor(Number.isInteger(fileId) ? fileId : null, me?.id ?? null)
  useTitle(file ? file.name : "Refinar")

  useEffect(() => {
    if (!Number.isInteger(fileId) || fileId < 1) {
      setError("El archivo no existe.")
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    void Promise.all([
      api<DataFile>(`/files/${fileId}`, { signal: ctrl.signal }),
      api<Rules>(`/files/${fileId}/rules`, { signal: ctrl.signal }),
    ]).then(([fileResult, rulesResult]) => {
      setFile(fileResult.data)
      setRules(rulesResult.data)
      setDone(fileResult.data.status === "COMPLETE" || fileResult.data.progress.overall >= 1)
      setError(null)
    }).catch((reason: unknown) => {
      if (isAbort(reason)) return
      setError(reason instanceof ApiError ? reason.message : "No se pudo abrir el archivo.")
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false)
    })
    return () => ctrl.abort()
  }, [fileId])

  useEffect(() => {
    return onLive((event) => {
      if (event.type === "reset") {
        setVersion((value) => value + 1)
        return
      }
      if (event.type === "file.completed" && event.fileId === fileId) {
        setDone(true)
        setFile((current) => current ? { ...current, status: "COMPLETE" } : current)
      }
      if (event.type === "refinement.created" && event.fileId === fileId && rules) {
        paintCells(fileId, file?.tileSize ?? 32, event.cells, BIN_CHAR[event.bin as Bin] ?? ".")
        setVersion((value) => value + 1)
        setFile((current) => current ? { ...current, progress: event.progress } : current)
        if (event.progress.overall >= 1) setDone(true)
      }
    })
  }, [fileId, file?.tileSize, rules])

  async function select(row: number, col: number) {
    if (!file || !rules) return
    selectAbort.current?.abort()
    const ctrl = new AbortController()
    selectAbort.current = ctrl
    setNotice(null)
    try {
      const found = await collectGroup(fileId, file.rows, file.cols, file.tileSize, rules, row, col, ctrl.signal)
      if (ctrl.signal.aborted) return
      setVersion((value) => value + 1)
      if (found.cells.length === 0) {
        setGroup(null)
        setNotice("Esa celda no da miedo.")
        return
      }
      setGroup(found.cells)
      setNoise(found.noise)
      setRefined(found.refined)
      setSuggested(found.suggested)
      if (found.refined) {
        setNotice("Parte del grupo ya está refinada. Se actualizan esos bloques.")
        return
      }
      if (found.noise) {
        setNotice(`Ruido: ${found.cells.length} celdas, fuera de ${rules.minGroupSize}–${rules.maxGroupSize}.`)
        return
      }
      const claim = await floor.claim(row, col)
      if (!claim.ok && claim.reason !== "OFFLINE" && claim.reason !== "TIMEOUT") {
        setNotice(claim.holder ? `${claim.holder} tiene reservado ese grupo.` : "No se pudo reservar el grupo.")
        setRefined(true)
      }
    } catch (reason) {
      if (!isAbort(reason)) setNotice(reason instanceof Error ? reason.message : "No se pudo leer el grupo.")
    }
  }

  async function commit(bin: string) {
    if (!file || !group || noise || refined || pending || lock.current || !can("files:refine")) return
    lock.current = true
    const cells = group.map((cell) => ({ r: cell.r, c: cell.c }))
    const body = { bin, cells }
    const serialized = JSON.stringify(body)
    if (!intent.current || intent.current.body !== serialized) {
      intent.current = { key: crypto.randomUUID(), body: serialized }
    }
    setPending(true)
    setNotice(null)
    try {
      const result = await api<RefineResult>(`/files/${fileId}/refinements`, {
        method: "POST",
        body,
        idempotencyKey: intent.current.key,
      })
      paintCells(fileId, file.tileSize, cells, BIN_CHAR[result.data.bin])
      setFile((current) => current ? {
        ...current,
        progress: result.data.file.progress,
        refinedGroups: result.data.file.refinedGroups,
        totalGroups: result.data.file.totalGroups,
        mistakes: result.data.file.mistakes,
        status: result.data.file.status,
      } : current)
      setGroup(null)
      intent.current = null
      floor.release()
      setVersion((value) => value + 1)
      if (result.data.file.status === "COMPLETE" || result.data.file.progress.overall >= 1) setDone(true)
      setNotice(result.replayed ? "Esa intención ya se había enviado." : `Grupo en ${result.data.bin}.`)
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "ALREADY_REFINED") {
        const tiles = detailRecord(reason.details).tiles
        if (Array.isArray(tiles)) {
          dropTiles(fileId, tiles.filter((item) => Array.isArray(item) && item.length === 2) as Array<[number, number]>)
          await Promise.all((tiles as Array<[number, number]>).map(([tileRow, tileCol]) => loadTile(fileId, tileRow, tileCol).catch(() => undefined)))
        }
        setVersion((value) => value + 1)
        setNotice("Esas celdas ya estaban refinadas. Se volvieron a pedir los bloques.")
        intent.current = null
      } else if (reason instanceof ApiError && (reason.code === "WRONG_BIN" || reason.code === "GROUP_INVALID")) {
        const details = detailRecord(reason.details)
        const reasonCode = typeof details.reason === "string" ? details.reason : ""
        const mistakes = typeof details.mistakes === "number" ? details.mistakes : null
        setNotice(reason.code === "WRONG_BIN"
          ? `La caja no corresponde.${mistakes !== null ? ` El archivo suma ${mistakes} errores.` : ""}`
          : (REASONS[reasonCode] ?? reason.message))
        if (mistakes !== null) setFile((current) => current ? { ...current, mistakes } : current)
        intent.current = null
      } else if (reason instanceof ApiError && reason.code === "GROUP_CLAIMED") {
        const holder = detailRecord(detailRecord(reason.details).holder).displayName
        setNotice(typeof holder === "string" ? `${holder} tiene reservado ese grupo.` : reason.message)
      } else {
        setNotice(reason instanceof Error ? `${reason.message} Puedes reintentar: se usa la misma intención.` : "Error de red.")
      }
    } finally {
      lock.current = false
      setPending(false)
    }
  }

  const selected = new Set((group ?? []).map((cell) => `${cell.r}:${cell.c}`))
  const claimed = new Set<string>()
  for (const claim of floor.claims) {
    if (claim.userId === me?.id) continue
    for (const cell of claim.cells) claimed.add(`${cell.r}:${cell.c}`)
  }
  const blocked = group?.some((cell) => claimed.has(`${cell.r}:${cell.c}`)) ?? false

  if (loading) return <main className="p-6"><Spinner label="Abriendo archivo…" /></main>
  if (error || !file || !rules) {
    return <main className="p-6"><Banner kind="error">{error ?? "Archivo no disponible."}</Banner></main>
  }

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">{file.name}</h1>
          <p className="text-sm">{file.rows} × {file.cols} · umbral {rules.tremorThreshold} · conectividad {rules.connectivity}</p>
        </div>
        <Link className="text-sm text-pine underline" to="/files">Volver</Link>
      </div>
      <ProgressBars progress={file.progress} />
      <p className="text-sm" role="status">Piso: {floor.status}{floor.detail ? `. ${floor.detail}` : ""}</p>
      {notice ? <Banner kind="info">{notice}</Banner> : null}
      {done ? (
        <section className="rounded border border-moss bg-white p-8">
          <h2 className="font-serif text-3xl">Archivo completado</h2>
          <p className="mt-2">Los grupos válidos ya están en su caja.</p>
          <button type="button" className="mt-4 underline" onClick={() => setDone(false)}>Ver la grilla</button>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Grid
            fileId={file.id}
            rows={file.rows}
            cols={file.cols}
            tileSize={file.tileSize}
            threshold={rules.tremorThreshold}
            version={version}
            selected={selected}
            claimed={claimed}
            onSelect={(row, col) => void select(row, col)}
            onDropBin={(bin) => void commit(bin)}
            onCursor={(row, col) => floor.sendCursor(row, col)}
          />
          <aside className="flex flex-col gap-3">
            <h2 className="font-serif text-xl">Grupo</h2>
            {group ? (
              <p>{group.length} celdas. {noise ? "Ruido." : refined ? "Ya refinado." : `Caja sugerida: ${suggested}.`}</p>
            ) : <p>Elige una celda que da miedo.</p>}
            <div role="group" aria-label="Cajas" className="grid grid-cols-2 gap-2">
              {BINS.map((bin, index) => (
                <button
                  key={bin}
                  type="button"
                  data-bin={bin}
                  className="rounded border border-pine px-3 py-3 disabled:opacity-40"
                  disabled={!can("files:refine") || !group || noise || refined || pending || blocked}
                  onClick={() => void commit(bin)}
                >
                  {index + 1}. {bin}{suggested === bin ? " · corresponde" : ""}
                </button>
              ))}
            </div>
            {!can("files:refine") ? <p className="text-sm">Solo lectura: no puedes refinar.</p> : null}
            {blocked ? <p className="text-sm">Otro refinador tiene reservada una de estas celdas.</p> : null}
            <button type="button" className="text-left text-sm underline" onClick={() => { setGroup(null); floor.release() }}>Soltar selección</button>
            <h2 className="font-serif text-xl">Presentes</h2>
            <ul className="text-sm">
              {floor.members.map((member) => <li key={member.userId}>{member.displayName}</li>)}
              {floor.members.length === 0 ? <li>Nadie más en el piso.</li> : null}
            </ul>
            <PresenceLinks />
          </aside>
        </div>
      )}
    </main>
  )
}

function ProgressBars({ progress }: { progress: Progress }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {(["WO", "FC", "DR", "MA", "overall"] as const).map((bin) => (
        <div key={bin}>
          <div className="mb-1 flex justify-between text-xs"><span>{bin === "overall" ? "Total" : bin}</span><span>{Math.round(progress[bin] * 100)}%</span></div>
          <div className="h-2 bg-line" role="meter" aria-label={bin} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress[bin] * 100)}>
            <div className="h-2 bg-pine" style={{ width: `${progress[bin] * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PresenceLinks() {
  const cursors = useCursorSnapshot()
  if (cursors.length === 0) return null
  return (
    <ul className="text-sm">
      {cursors.map((cursor) => (
        <li key={cursor.userId}>
          <button
            type="button"
            className="underline"
            onClick={() => {
              const node = document.getElementById("grid-scroll")
              if (!node) return
              node.scrollTop = cursor.r * CELL
              node.scrollLeft = cursor.c * CELL
            }}
          >
            Ir a {cursor.name} ({cursor.r}, {cursor.c})
          </button>
        </li>
      ))}
    </ul>
  )
}
