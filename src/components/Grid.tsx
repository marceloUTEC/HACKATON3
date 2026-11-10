import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { isAbort } from "../lib/api"
import { loadTile, readCell } from "../lib/tiles"
import { useCursorSnapshot } from "./floor"

export const CELL = 28
const MAX_CELLS = 2400

const BIN_COLOR: Record<string, string> = {
  W: "#b45309",
  F: "#047857",
  D: "#6d28d9",
  M: "#1d4ed8",
  ".": "transparent",
}

interface Props {
  fileId: number
  rows: number
  cols: number
  tileSize: number
  threshold: number
  version: number
  selected: Set<string>
  claimed: Set<string>
  onSelect: (row: number, col: number) => void
  onDropBin: (bin: string) => void
  onCursor: (row: number, col: number) => void
}

export function Grid(props: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 560, top: 0, left: 0 })
  const [focus, setFocus] = useState(() => initialFocus(props.rows, props.cols))
  const [tick, setTick] = useState(0)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; row: number; col: number } | null>(null)
  const cursorRef = useRef(props.onCursor)
  cursorRef.current = props.onCursor

  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const start = initialFocus(props.rows, props.cols)
    node.scrollTop = start.r * CELL
    node.scrollLeft = start.c * CELL
    setFocus(start)
  }, [props.fileId, props.rows, props.cols])

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const measure = () => {
      setViewport({
        width: node.clientWidth,
        height: node.clientHeight,
        top: node.scrollTop,
        left: node.scrollLeft,
      })
    }
    measure()
    const onScroll = () => {
      measure()
      const topRow = Math.max(0, Math.floor(node.scrollTop / CELL))
      const topCol = Math.max(0, Math.floor(node.scrollLeft / CELL))
      const url = new URL(window.location.href)
      url.searchParams.set("r", String(topRow))
      url.searchParams.set("c", String(topCol))
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
    }
    node.addEventListener("scroll", onScroll, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      node.removeEventListener("scroll", onScroll)
      observer.disconnect()
    }
  }, [])

  const windowSize = fitWindow(viewport.width, viewport.height)
  let startRow = Math.max(0, Math.floor(viewport.top / CELL) - 1)
  let startCol = Math.max(0, Math.floor(viewport.left / CELL) - 1)
  if (focus.r < startRow) startRow = focus.r
  if (focus.c < startCol) startCol = focus.c
  if (startRow + windowSize.rows > props.rows) startRow = Math.max(0, props.rows - windowSize.rows)
  if (startCol + windowSize.cols > props.cols) startCol = Math.max(0, props.cols - windowSize.cols)
  const rowCount = Math.min(windowSize.rows, props.rows - startRow)
  const colCount = Math.min(windowSize.cols, props.cols - startCol)

  useEffect(() => {
    const ctrl = new AbortController()
    const row0 = Math.floor(startRow / props.tileSize)
    const row1 = Math.floor((startRow + rowCount - 1) / props.tileSize)
    const col0 = Math.floor(startCol / props.tileSize)
    const col1 = Math.floor((startCol + colCount - 1) / props.tileSize)
    for (let tileRow = row0; tileRow <= row1; tileRow += 1) {
      for (let tileCol = col0; tileCol <= col1; tileCol += 1) {
        void loadTile(props.fileId, tileRow, tileCol, ctrl.signal).then(() => {
          if (!ctrl.signal.aborted) setTick((value) => value + 1)
        }).catch((error: unknown) => {
          if (!isAbort(error)) setTick((value) => value + 1)
        })
      }
    }
    return () => ctrl.abort()
    // La ventana visible cambia con el scroll; el resto identifica el archivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fileId, props.tileSize, props.version, startRow, startCol, rowCount, colCount])

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const top = focus.r * CELL
    const left = focus.c * CELL
    if (top < node.scrollTop) node.scrollTop = top
    else if (top + CELL > node.scrollTop + node.clientHeight) node.scrollTop = top - node.clientHeight + CELL
    if (left < node.scrollLeft) node.scrollLeft = left
    else if (left + CELL > node.scrollLeft + node.clientWidth) node.scrollLeft = left - node.clientWidth + CELL
    cursorRef.current(focus.r, focus.c)
    document.getElementById(`cell-${focus.r}-${focus.c}`)?.focus()
  }, [focus.r, focus.c])

  function move(nextRow: number, nextCol: number) {
    setFocus({
      r: clamp(nextRow, 0, props.rows - 1),
      c: clamp(nextCol, 0, props.cols - 1),
    })
  }

  const pageRows = Math.max(1, Math.floor(viewport.height / CELL) - 1)
  void tick

  return (
    <div className="relative h-[70vh] min-h-80">
    <div
      ref={scroller}
      id="grid-scroll"
      className="h-full overflow-auto rounded border border-line bg-mist"
      onKeyDown={(event) => {
        const key = event.key
        if (key === "ArrowUp") move(focus.r - 1, focus.c)
        else if (key === "ArrowDown") move(focus.r + 1, focus.c)
        else if (key === "ArrowLeft") move(focus.r, focus.c - 1)
        else if (key === "ArrowRight") move(focus.r, focus.c + 1)
        else if (key === "PageUp") move(focus.r - pageRows, focus.c)
        else if (key === "PageDown") move(focus.r + pageRows, focus.c)
        else if (key === "Home" && event.ctrlKey) move(0, 0)
        else if (key === "End" && event.ctrlKey) move(props.rows - 1, props.cols - 1)
        else if (key === "Home") move(focus.r, 0)
        else if (key === "End") move(focus.r, props.cols - 1)
        else if (key === "Enter" || key === " ") props.onSelect(focus.r, focus.c)
        else return
        event.preventDefault()
      }}
    >
      <div
        role="grid"
        aria-rowcount={props.rows}
        aria-colcount={props.cols}
        aria-label="Grilla de macrodatos"
        className="relative outline-none"
        style={{ width: props.cols * CELL, height: props.rows * CELL }}
        onPointerDown={(event) => {
          const cell = (event.target as HTMLElement).closest("[data-cell]")
          if (!cell) return
          const [row, col] = String(cell.getAttribute("data-cell")).split(":").map(Number)
          if (row === undefined || col === undefined || Number.isNaN(row) || Number.isNaN(col)) return
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, row, col }
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.id !== event.pointerId) return
          if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 6) drag.current.moved = true
        }}
        onPointerUp={(event) => {
          const current = drag.current
          drag.current = null
          if (!current || current.id !== event.pointerId) return
          if (!current.moved) {
            props.onSelect(current.row, current.col)
            move(current.row, current.col)
            return
          }
          const element = document.elementFromPoint(event.clientX, event.clientY)
          const bin = element?.closest("[data-bin]")?.getAttribute("data-bin")
          if (bin) props.onDropBin(bin)
        }}
      >
        {Array.from({ length: rowCount }, (_, rowOffset) => {
          const row = startRow + rowOffset
          return (
            <div key={row} role="row" aria-rowindex={row + 1}>
              {Array.from({ length: colCount }, (_, colOffset) => {
                const col = startCol + colOffset
                const cell = readCell(props.fileId, props.tileSize, row, col)
                const id = `${row}:${col}`
                const focused = focus.r === row && focus.c === col
                const scary = Boolean(cell && cell.tremor >= props.threshold && cell.bin === ".")
                const color = cell ? BIN_COLOR[cell.bin] ?? "transparent" : "transparent"
                return (
                  <div
                    key={id}
                    id={`cell-${row}-${col}`}
                    role="gridcell"
                    aria-rowindex={row + 1}
                    aria-colindex={col + 1}
                    aria-selected={props.selected.has(id)}
                    data-cell={id}
                    tabIndex={focused ? 0 : -1}
                    className={`absolute box-border border border-white/40 text-center text-[10px] leading-7 ${scary ? "cell-scary bg-amber-200" : "bg-white"} ${props.selected.has(id) ? "outline outline-2 outline-pine" : ""} ${props.claimed.has(id) ? "bg-stone-300" : ""}`}
                    style={{
                      left: col * CELL,
                      top: row * CELL,
                      width: CELL,
                      height: CELL,
                      backgroundColor: cell?.bin && cell.bin !== "." ? color : undefined,
                      ["--shake" as string]: `${Math.min(2.5, ((cell?.tremor ?? 0) - props.threshold) / 25)}px`,
                      ["--dur" as string]: `${Math.max(90, 420 - (cell?.tremor ?? 0) * 3)}ms`,
                    }}
                  >
                    {cell ? cell.value : ""}
                    <span className="sr-only">
                      {scary ? `, da miedo, temblor ${cell?.tremor}` : ""}
                      {props.claimed.has(id) ? ", reservada por otro" : ""}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
    <CursorOverlay scroller={scroller} />
    </div>
  )
}

function CursorOverlay({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
  const cursors = useCursorSnapshot()
  const [, setScroll] = useState(0)
  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const onScroll = () => setScroll(node.scrollTop + node.scrollLeft)
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => node.removeEventListener("scroll", onScroll)
  }, [scroller])
  const node = scroller.current
  if (!node) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {cursors.map((cursor) => {
        const x = cursor.c * CELL - node.scrollLeft
        const y = cursor.r * CELL - node.scrollTop
        if (x < -CELL || y < -CELL || x > node.clientWidth || y > node.clientHeight) return null
        return (
          <span key={cursor.userId} className="absolute rounded bg-pine px-1 text-[10px] text-white" style={{ left: x, top: y }}>
            {cursor.name}
          </span>
        )
      })}
    </div>
  )
}

function fitWindow(width: number, height: number) {
  let rows = Math.max(1, Math.ceil(height / CELL) + 2)
  let cols = Math.max(1, Math.ceil(width / CELL) + 2)
  while (rows * cols > MAX_CELLS) {
    if (rows > cols) rows -= 1
    else cols -= 1
  }
  return { rows, cols }
}

function initialFocus(rows: number, cols: number) {
  const params = new URLSearchParams(window.location.search)
  return {
    r: clamp(Number(params.get("r")), 0, Math.max(0, rows - 1)),
    c: clamp(Number(params.get("c")), 0, Math.max(0, cols - 1)),
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function useOffscreenCursors(scroller: RefObject<HTMLDivElement | null>) {
  const cursors = useCursorSnapshot()
  const node = scroller.current
  if (!node) return cursors.map((cursor) => ({ ...cursor, visible: true }))
  return cursors.map((cursor) => {
    const x = cursor.c * CELL - node.scrollLeft
    const y = cursor.r * CELL - node.scrollTop
    const visible = x >= 0 && y >= 0 && x < node.clientWidth && y < node.clientHeight
    return { ...cursor, visible }
  })
}
