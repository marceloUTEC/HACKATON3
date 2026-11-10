import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api, ApiError } from "../lib/api"
import { prepareWebp, startUpload, type CropRect } from "../lib/media"
import { Cropper } from "../components/Cropper"
import { Banner, Spinner, useTitle } from "../components/ui"
import type { Refiner } from "../types"

export function Badge() {
  const id = Number(useParams().id)
  useTitle("Fotocheck")
  const [refiner, setRefiner] = useState<Refiner | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void api<Refiner>(`/refiners/${id}`).then((result) => {
      setRefiner(result.data)
      setEtag(result.etag ?? `"${result.data.version}"`)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se abrió el expediente."))
  }, [id])

  async function save() {
    if (!file || !crop || !etag) return
    setPending(true)
    setError(null)
    try {
      const prepared = await prepareWebp(file, crop, 512, 122_880)
      const upload = startUpload(prepared, "BADGE", setProgress)
      abortRef.current = upload.abort
      const media = await upload.promise
      const updated = await api<Refiner>(`/refiners/${id}`, {
        method: "PATCH",
        ifMatch: etag,
        body: { badgeMediaId: media.mediaId },
      })
      setRefiner(updated.data)
      setEtag(updated.etag ?? `"${updated.data.version}"`)
      setFile(null)
      setProgress(null)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 412) {
        const fresh = await api<Refiner>(`/refiners/${id}`)
        setRefiner(fresh.data)
        setEtag(fresh.etag ?? `"${fresh.data.version}"`)
        setError("El expediente cambió. Revisa el fotocheck actual y vuelve a guardar si sigue siendo el que quieres.")
      } else {
        setError(reason instanceof Error ? reason.message : "No se pudo subir el fotocheck.")
      }
    } finally {
      setPending(false)
    }
  }

  if (!refiner && !error) return <main className="p-6"><Spinner label="Cargando expediente…" /></main>

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="font-serif text-3xl">Fotocheck</h1>
      <Link className="text-sm text-pine underline" to="/refiners">Volver</Link>
      {refiner?.badge ? <img src={refiner.badge.url} alt={`Fotocheck de ${refiner.fullName}`} width={160} height={160} className="h-40 w-40 object-cover" /> : <p>Sin fotocheck.</p>}
      <label htmlFor="file" className="text-sm">Imagen</label>
      <input id="file" type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <DropPaste onFile={setFile} />
      {file ? <Cropper file={file} onChange={(next) => setCrop(next)} /> : null}
      {progress !== null ? (
        <div>
          <div className="h-2 bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Subida">
            <div className="h-2 bg-pine" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="text-sm">{Math.round(progress * 100)}%</p>
        </div>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="flex gap-2">
        <button type="button" className="rounded bg-pine px-4 py-2 text-white disabled:opacity-50" disabled={!file || pending} onClick={() => void save()}>{pending ? "Subiendo…" : "Guardar fotocheck"}</button>
        {pending ? <button type="button" className="rounded border px-3 py-2" onClick={() => abortRef.current?.()}>Cancelar</button> : null}
      </div>
    </main>
  )
}

export function DropPaste({ onFile }: { onFile: (file: File) => void }) {
  return (
    <div
      className="rounded border border-dashed border-pine p-4 text-sm"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const next = event.dataTransfer.files[0]
        if (next) onFile(next)
      }}
      onPaste={(event) => {
        const next = [...event.clipboardData.files][0]
        if (next) onFile(next)
      }}
      tabIndex={0}
    >
      Arrastra una imagen o pégala aquí.
    </div>
  )
}
