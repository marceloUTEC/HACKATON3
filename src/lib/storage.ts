import type { MediaTicket } from "../types"

export function uploadToTicket(
  ticket: MediaTicket,
  blob: Blob,
  onProgress: (ratio: number) => void,
): { promise: Promise<string>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<string>((resolve, reject) => {
    xhr.open(ticket.provider === "SUPABASE" ? "POST" : "POST", targetUrl(ticket))
    xhr.responseType = "json"
    if (ticket.provider === "SUPABASE") {
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!key || !import.meta.env.VITE_SUPABASE_URL) {
        reject(new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."))
        return
      }
      xhr.setRequestHeader("Authorization", `Bearer ${key}`)
      xhr.setRequestHeader("apikey", key)
      xhr.setRequestHeader("Content-Type", "image/webp")
      xhr.setRequestHeader("x-upsert", "false")
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new Error("La subida se interrumpió."))
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error("El storage rechazó la imagen."))
        return
      }
      onProgress(1)
      resolve(publicUrl(ticket, xhr.response))
    }
    if (ticket.provider === "CLOUDINARY") {
      const form = new FormData()
      form.append("file", blob, "image.webp")
      form.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ?? "")
      if (ticket.uploadPublicId) form.append("public_id", ticket.uploadPublicId)
      xhr.send(form)
      return
    }
    xhr.send(blob)
  })
  return { promise, abort: () => xhr.abort() }
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/")
}

function targetUrl(ticket: MediaTicket): string {
  if (ticket.provider === "SUPABASE") {
    const base = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")
    const bucket = ticket.bucket ?? "lumon-media"
    return `${base}/storage/v1/object/${bucket}/${encodePath(ticket.objectPath ?? "")}`
  }
  const cloud = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  if (!cloud || !import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET) {
    throw new Error("Faltan VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET.")
  }
  return `https://api.cloudinary.com/v1_1/${cloud}/image/upload`
}

function publicUrl(ticket: MediaTicket, response: unknown): string {
  if (ticket.provider === "SUPABASE") {
    const base = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")
    const bucket = ticket.bucket ?? "lumon-media"
    return `${base}/storage/v1/object/public/${bucket}/${encodePath(ticket.objectPath ?? "")}`
  }
  const body = response && typeof response === "object" ? response as { secure_url?: string } : {}
  if (body.secure_url && !body.secure_url.includes("/upload/")) return body.secure_url
  if (body.secure_url) return body.secure_url
  const cloud = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  return `https://res.cloudinary.com/${cloud}/image/upload/${ticket.expectedPublicId ?? ""}.webp`
}
