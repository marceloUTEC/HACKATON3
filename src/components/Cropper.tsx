import { useEffect, useRef, useState } from "react"
import type { CropRect } from "../lib/media"

export function Cropper({
  file,
  onChange,
}: {
  file: File
  onChange: (crop: CropRect, preview: string) => void
}) {
  const [url, setUrl] = useState("")
  const [natural, setNatural] = useState({ w: 1, h: 1 })
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  const size = Math.min(natural.w, natural.h) / zoom
  const sx = clamp(center.x - size / 2, 0, Math.max(0, natural.w - size))
  const sy = clamp(center.y - size / 2, 0, Math.max(0, natural.h - size))

  useEffect(() => {
    if (!url) return
    onChangeRef.current({ sx, sy, size }, url)
  }, [sx, sy, size, url])

  function nudge(dx: number, dy: number) {
    setCenter((current) => ({ x: current.x + dx, y: current.y + dy }))
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative h-80 overflow-hidden rounded border border-line bg-mist"
        tabIndex={0}
        role="application"
        aria-label="Recorte. Flechas para mover, más y menos para el zoom."
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") nudge(0, -8)
          else if (event.key === "ArrowDown") nudge(0, 8)
          else if (event.key === "ArrowLeft") nudge(-8, 0)
          else if (event.key === "ArrowRight") nudge(8, 0)
          else if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(3, value + 0.1))
          else if (event.key === "-" || event.key === "_") setZoom((value) => Math.max(1, value - 0.1))
          else return
          event.preventDefault()
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y }
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const scale = natural.w / 320
          setCenter({
            x: drag.current.cx - (event.clientX - drag.current.x) * scale,
            y: drag.current.cy - (event.clientY - drag.current.y) * scale,
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        {url ? (
          <img
            src={url}
            alt="Imagen a recortar"
            className="max-h-80 w-full object-contain"
            onLoad={(event) => {
              const image = event.currentTarget
              setNatural({ w: image.naturalWidth, h: image.naturalHeight })
              setCenter({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 })
            }}
          />
        ) : null}
      </div>
      <label className="text-sm" htmlFor="zoom">Zoom</label>
      <input
        id="zoom"
        type="range"
        min={1}
        max={3}
        step={0.05}
        value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}
      />
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
