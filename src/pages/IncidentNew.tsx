import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { api, ApiError, isAbort } from "../lib/api"
import { prepareWebp, startUpload, type CropRect } from "../lib/media"
import { Cropper } from "../components/Cropper"
import { DropPaste } from "./Badge"
import { Banner, Field, inputClass, useTitle } from "../components/ui"
import type { Severity } from "../types"

interface Photo {
  id: string
  file: File
  crop: CropRect | null
  progress: number
  mediaId: number | null
  error: string | null
  abort: (() => void) | null
}

export function IncidentNew() {
  useTitle("Nueva incidencia")
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [severity, setSeverity] = useState<Severity>("MEDIUM")
  const [fileId, setFileId] = useState("")
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function addFile(file: File) {
    setPhotos((current) => current.length >= 3 ? current : [...current, {
      id: crypto.randomUUID(),
      file,
      crop: null,
      progress: 0,
      mediaId: null,
      error: null,
      abort: null,
    }])
  }

  async function upload(photo: Photo) {
    if (!photo.crop || photo.mediaId) return
    setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, error: null, progress: 0 } : item))
    try {
      const prepared = await prepareWebp(photo.file, photo.crop, 1024, 307_200)
      const task = startUpload(prepared, "INCIDENT", (ratio) => {
        setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, progress: ratio } : item))
      })
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, abort: task.abort } : item))
      const media = await task.promise
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, mediaId: media.mediaId, progress: 1, abort: null } : item))
    } catch (reason) {
      if (isAbort(reason)) return
      const message = reason instanceof Error ? reason.message : "Falló la foto."
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, error: message, abort: null } : item))
    }
  }

  const ready = photos.length >= 1 && photos.every((photo) => photo.mediaId)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <h1 className="font-serif text-3xl">Nuevo reporte</h1>
      <Link className="text-sm text-pine underline" to="/incidents">Volver</Link>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready) return
          setPending(true)
          setError(null)
          void api("/incidents", {
            method: "POST",
            body: {
              title,
              description,
              severity,
              mediaIds: photos.map((photo) => photo.mediaId),
              fileId: fileId ? Number(fileId) : null,
            },
          }).then(() => navigate("/incidents")).catch((reason: unknown) => {
            setError(reason instanceof ApiError ? reason.message : "No se envió el reporte. Las fotos confirmadas siguen aquí.")
          }).finally(() => setPending(false))
        }}
      >
        <Field id="title" label="Título">
          <input id="title" className={inputClass} required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field id="description" label="Descripción">
          <textarea id="description" className={inputClass} required maxLength={4000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field id="severity" label="Severidad">
          <select id="severity" className={inputClass} value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
            <option value="CRITICAL">Crítica</option>
          </select>
        </Field>
        <Field id="fileId" label="Archivo relacionado (opcional)">
          <input id="fileId" className={inputClass} inputMode="numeric" value={fileId} onChange={(event) => setFileId(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <DropPaste onFile={addFile} />
        <label htmlFor="photos" className="text-sm">Fotos (1 a 3)</label>
        <input id="photos" type="file" accept="image/*" onChange={(event) => { const next = event.target.files?.[0]; if (next) addFile(next) }} />
        {photos.map((photo) => (
          <section key={photo.id} className="rounded border border-line p-3">
            <Cropper file={photo.file} onChange={(crop) => setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, crop } : item))} />
            <div className="mt-2 h-2 bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(photo.progress * 100)} aria-label="Subida de foto">
              <div className="h-2 bg-pine" style={{ width: `${photo.progress * 100}%` }} />
            </div>
            {photo.mediaId ? <p className="text-sm">Confirmada.</p> : null}
            {photo.error ? <p className="text-sm text-red-900" role="alert">{photo.error}</p> : null}
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded border px-3 py-1" disabled={Boolean(photo.mediaId)} onClick={() => void upload(photo)}>Subir</button>
              {photo.abort ? <button type="button" className="rounded border px-3 py-1" onClick={() => photo.abort?.()}>Cancelar</button> : null}
              <button type="button" className="rounded border px-3 py-1" onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}>Quitar</button>
            </div>
          </section>
        ))}
        {error ? <Banner kind="error">{error}</Banner> : null}
        <button type="submit" className="w-fit rounded bg-pine px-4 py-2 text-white disabled:opacity-50" disabled={!ready || pending}>
          {pending ? "Enviando…" : "Enviar reporte"}
        </button>
      </form>
    </main>
  )
}
