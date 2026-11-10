import { api } from "./api"
import { uploadToTicket } from "./storage"
import type { Media, MediaTicket } from "../types"

export interface CropRect {
  sx: number
  sy: number
  size: number
}

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
  sha256: string
}

export async function prepareWebp(file: File, crop: CropRect, target: number, maxBytes: number): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  canvas.width = target
  canvas.height = target
  const context = canvas.getContext("2d")
  if (!context) throw new Error("No se pudo preparar la imagen.")
  context.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, target, target)
  bitmap.close()
  let quality = 0.9
  let blob: Blob | null = null
  while (quality >= 0.4) {
    blob = await toBlob(canvas, quality)
    if (blob.type !== "image/webp") {
      throw new Error("Este navegador no puede generar WebP.")
    }
    if (blob.size <= maxBytes) break
    quality -= 0.1
  }
  if (!blob || blob.type !== "image/webp") throw new Error("Este navegador no puede generar WebP.")
  if (blob.size > maxBytes) throw new Error("La imagen sigue siendo demasiado pesada.")
  const sha256 = await digest(blob)
  return { blob, width: target, height: target, sha256 }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Este navegador no puede generar WebP."))
      else resolve(blob)
    }, "image/webp", quality)
  })
}

async function digest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("")
}

export function startUpload(
  prepared: PreparedImage,
  purpose: "BADGE" | "INCIDENT",
  onProgress: (ratio: number) => void,
): { promise: Promise<Media>; abort: () => void } {
  let cancelled = false
  const handle = {
    abort: () => {
      cancelled = true
    },
  }
  const promise = (async () => {
    const ticket = await api<MediaTicket>("/media/tickets", {
      method: "POST",
      body: {
        purpose,
        contentType: "image/webp",
        bytes: prepared.blob.size,
        sha256: prepared.sha256,
        width: prepared.width,
        height: prepared.height,
      },
    })
    if (cancelled) throw new DOMException("Aborted", "AbortError")
    const upload = uploadToTicket(ticket.data, prepared.blob, onProgress)
    handle.abort = () => {
      cancelled = true
      upload.abort()
    }
    const url = await upload.promise
    const confirmed = await api<Media>(`/media/tickets/${ticket.data.ticketId}/confirm`, {
      method: "POST",
      body: { url },
    })
    return confirmed.data
  })()
  return { promise, abort: () => handle.abort() }
}
