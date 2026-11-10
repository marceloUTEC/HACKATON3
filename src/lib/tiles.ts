import { api, ApiError, isAbort, sleep } from "./api"
import type { Tile } from "../types"

export interface CachedTile {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: Uint8Array
  bins: string
  version: number
}

export interface CellData {
  value: number
  tremor: number
  bin: string
}

const cache = new Map<string, CachedTile>()
const inflight = new Map<string, { ctrl: AbortController; refs: number; promise: Promise<CachedTile> }>()

let active = 0
const MAX_PARALLEL = 3
let pauseUntil = 0
const waiters: Array<() => void> = []

function keyOf(fileId: number, tileRow: number, tileCol: number) {
  return `${fileId}:${tileRow}:${tileCol}`
}

function pump() {
  if (Date.now() < pauseUntil) {
    window.setTimeout(pump, pauseUntil - Date.now())
    return
  }
  while (active < MAX_PARALLEL && waiters.length > 0) {
    active += 1
    const next = waiters.shift()
    next?.()
  }
}

function slot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const abort = () => reject(new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    waiters.push(() => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) {
        active -= 1
        pump()
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      resolve(() => {
        active -= 1
        pump()
      })
    })
    pump()
  })
}

function decode(tile: Tile): CachedTile {
  const count = tile.rows * tile.cols
  const raw = atob(tile.tremor)
  const tremor = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) tremor[index] = raw.charCodeAt(index) || 0
  return {
    tileRow: tile.tileRow,
    tileCol: tile.tileCol,
    originRow: tile.originRow,
    originCol: tile.originCol,
    rows: tile.rows,
    cols: tile.cols,
    values: tile.values,
    tremor,
    bins: tile.bins,
    version: tile.version,
  }
}

async function fetchTile(fileId: number, tileRow: number, tileCol: number, signal: AbortSignal): Promise<CachedTile> {
  let attempt = 0
  for (;;) {
    const release = await slot(signal)
    try {
      const result = await api<Tile>(`/files/${fileId}/tiles/${tileRow}/${tileCol}`, {
        signal,
        retry503: false,
        retry429: false,
      })
      return decode(result.data)
    } catch (error) {
      if (isAbort(error)) throw error
      if (error instanceof ApiError && error.status === 429) {
        pauseUntil = Math.max(pauseUntil, Date.now() + (error.retryAfter ?? 1) * 1000)
        continue
      }
      if (error instanceof ApiError && error.status === 503 && attempt < 4) {
        attempt += 1
        await sleep((error.retryAfter ?? Math.min(8, 0.4 * 2 ** attempt)) * 1000, signal)
        continue
      }
      throw error
    } finally {
      release()
    }
  }
}

export function readCell(fileId: number, tileSize: number, row: number, col: number): CellData | null {
  const tileRow = Math.floor(row / tileSize)
  const tileCol = Math.floor(col / tileSize)
  const tile = cache.get(keyOf(fileId, tileRow, tileCol))
  if (!tile) return null
  const localRow = row - tile.originRow
  const localCol = col - tile.originCol
  if (localRow < 0 || localCol < 0 || localRow >= tile.rows || localCol >= tile.cols) return null
  const index = localRow * tile.cols + localCol
  const digit = tile.values.charCodeAt(index) - 48
  return {
    value: digit >= 0 && digit <= 9 ? digit : 0,
    tremor: tile.tremor[index] ?? 0,
    bin: tile.bins[index] ?? ".",
  }
}

export function paintCells(fileId: number, tileSize: number, cells: Array<{ r: number; c: number }>, binChar: string) {
  const touched = new Map<string, CachedTile>()
  for (const cell of cells) {
    const tileRow = Math.floor(cell.r / tileSize)
    const tileCol = Math.floor(cell.c / tileSize)
    const key = keyOf(fileId, tileRow, tileCol)
    const tile = touched.get(key) ?? cache.get(key)
    if (!tile) continue
    const localRow = cell.r - tile.originRow
    const localCol = cell.c - tile.originCol
    const index = localRow * tile.cols + localCol
    if (index < 0 || index >= tile.bins.length) continue
    const bins = `${tile.bins.slice(0, index)}${binChar}${tile.bins.slice(index + 1)}`
    const next = { ...tile, bins }
    touched.set(key, next)
  }
  for (const [key, tile] of touched) cache.set(key, tile)
}

export function dropTiles(fileId: number, tiles: Array<[number, number]>) {
  for (const [tileRow, tileCol] of tiles) cache.delete(keyOf(fileId, tileRow, tileCol))
}

export function loadTile(fileId: number, tileRow: number, tileCol: number, signal?: AbortSignal): Promise<CachedTile> {
  const key = keyOf(fileId, tileRow, tileCol)
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  let job = inflight.get(key)
  if (!job) {
    const ctrl = new AbortController()
    const promise = fetchTile(fileId, tileRow, tileCol, ctrl.signal).then((tile) => {
      cache.set(key, tile)
      if (inflight.get(key)?.promise === promise) inflight.delete(key)
      return tile
    }).catch((error: unknown) => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key)
      throw error
    })
    job = { ctrl, refs: 0, promise }
    inflight.set(key, job)
  }
  const current = job
  current.refs += 1
  const releaseRef = () => {
    current.refs -= 1
    if (current.refs <= 0) current.ctrl.abort()
  }
  if (signal?.aborted) {
    releaseRef()
    return Promise.reject(new DOMException("Aborted", "AbortError"))
  }
  signal?.addEventListener("abort", releaseRef, { once: true })
  return current.promise.finally(() => {
    signal?.removeEventListener("abort", releaseRef)
  })
}
