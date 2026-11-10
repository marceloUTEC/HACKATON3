import { loadTile, readCell, type CellData } from "./tiles"
import type { Bin, Rules } from "../types"

export interface GroupCell {
  r: number
  c: number
  value: number
  bin: string
  tremor: number
}

const DELTA_4: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DELTA_8: Array<[number, number]> = [...DELTA_4, [-1, -1], [-1, 1], [1, -1], [1, 1]]

export function suggestedBin(values: number[], rules: Rules): Bin {
  const index = rules.binning.strategy === "MAX_DIGIT_MOD"
    ? Math.max(...values) % 4
    : values.reduce((sum, value) => sum + value, 0) % 4
  return rules.binning.order[index] ?? rules.binning.order[0] ?? "WO"
}

export async function collectGroup(
  fileId: number,
  rows: number,
  cols: number,
  tileSize: number,
  rules: Rules,
  row: number,
  col: number,
  signal: AbortSignal,
): Promise<{ cells: GroupCell[]; noise: boolean; suggested: Bin | null; refined: boolean }> {
  const origin = await ensure(fileId, tileSize, row, col, signal)
  if (!origin || origin.tremor < rules.tremorThreshold) {
    return { cells: [], noise: false, suggested: null, refined: false }
  }
  const deltas = rules.connectivity === 4 ? DELTA_4 : DELTA_8
  const seen = new Set<string>()
  const stack: Array<[number, number]> = [[row, col]]
  const cells: GroupCell[] = []
  while (stack.length > 0) {
    const next = stack.pop()
    if (!next) break
    const [r, c] = next
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue
    const id = `${r}:${c}`
    if (seen.has(id)) continue
    seen.add(id)
    const cell = await ensure(fileId, tileSize, r, c, signal)
    if (!cell || cell.tremor < rules.tremorThreshold) continue
    cells.push({ r, c, value: cell.value, bin: cell.bin, tremor: cell.tremor })
    for (const [dr, dc] of deltas) stack.push([r + dr, c + dc])
  }
  const noise = cells.length < rules.minGroupSize || cells.length > rules.maxGroupSize
  const refined = cells.some((cell) => cell.bin !== ".")
  return {
    cells,
    noise,
    refined,
    suggested: noise ? null : suggestedBin(cells.map((cell) => cell.value), rules),
  }
}

async function ensure(fileId: number, tileSize: number, row: number, col: number, signal: AbortSignal): Promise<CellData | null> {
  const tileRow = Math.floor(row / tileSize)
  const tileCol = Math.floor(col / tileSize)
  const known = readCell(fileId, tileSize, row, col)
  if (known) return known
  await loadTile(fileId, tileRow, tileCol, signal)
  return readCell(fileId, tileSize, row, col)
}
