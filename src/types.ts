export type Permission =
  | "files:read"
  | "files:refine"
  | "refiners:read"
  | "refiners:write"
  | "media:upload"
  | "incidents:read"
  | "incidents:create"
  | "team:manage"

export interface User {
  id: number
  email: string
  displayName: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface Me {
  id: number
  email: string
  displayName: string
  team: { code: string; name: string }
  role: { code: string; name: string }
  permissions: Permission[]
  clearance: { granted: boolean; grantedAt: string | null }
}

export interface Progress {
  WO: number
  FC: number
  DR: number
  MA: number
  overall: number
}

export interface DataFile {
  id: number
  name: string
  rows: number
  cols: number
  tileSize: number
  status: "ACTIVE" | "COMPLETE"
  progress: Progress
  refinedGroups: number
  totalGroups: number
  mistakes: number
  updatedAt: string
}

export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface Rules {
  tremorThreshold: number
  connectivity: 4 | 8
  minGroupSize: number
  maxGroupSize: number
  binning: {
    strategy: "DIGIT_SUM_MOD" | "MAX_DIGIT_MOD"
    order: Array<"WO" | "FC" | "DR" | "MA">
  }
}

export interface Tile {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: string
  bins: string
  version: number
}

export interface RefineResult {
  refinementId: number
  bin: "WO" | "FC" | "DR" | "MA"
  size: number
  file: {
    progress: Progress
    refinedGroups: number
    totalGroups: number
    mistakes: number
    status: "ACTIVE" | "COMPLETE"
  }
}

export interface Department {
  id: number
  code: string
  name: string
}

export interface Refiner {
  id: number
  fullName: string
  department: Department
  title: string
  extension: string
  bio: string
  profileUrl: string | null
  badge: { url: string; width: number; height: number } | null
  version: number
  updatedAt: string
}

export interface MediaTicket {
  ticketId: string
  expiresAt: string
  provider: "SUPABASE" | "CLOUDINARY"
  objectPath?: string
  bucket?: string
  uploadPublicId?: string
  expectedPublicId?: string
  constraints: {
    contentType?: string
    width?: number
    height?: number
    minLongSide?: number
    maxLongSide?: number
    maxBytes?: number
  }
}

export interface Media {
  mediaId: number
  url: string
  width: number
  height: number
  purpose: "BADGE" | "INCIDENT"
}

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

export interface Incident {
  id: number
  title: string
  description: string
  severity: Severity
  fileId: number | null
  file: { id: number; name: string } | null
  photos: Array<{ mediaId: number; url: string; width: number; height: number }>
  createdBy: { id: number; displayName: string }
  createdAt: string
}

export interface Check {
  name: string
  passed: boolean
  detail: string
}

export interface IntegrationStatus {
  deploy: {
    origin: string | null
    verifiedAt: string | null
    lastBuildSeen: string | null
    lastBuildSeenAt: string | null
    pendingChallenge: { origin: string; expiresAt: string } | null
  }
  storage: {
    provider: "SUPABASE" | "CLOUDINARY" | null
    verifiedAt: string | null
    checks: Check[]
    config: {
      projectUrl?: string
      bucket?: string
      cloudName?: string
      uploadPreset?: string
    } | null
  }
  clearance: { granted: boolean; grantedAt: string | null }
}

export interface RosterMember {
  name: string
  code: string
}

export interface Clearance {
  granted: boolean
  grantedAt: string | null
  checks: Check[]
  checkedAt: string | null
  workspace: { kind: "DEV" | "EVAL"; chaosLevel: 0 | 1 | 2 }
  roster: { members: RosterMember[]; complete: boolean; locked: boolean }
  round: {
    approved: boolean
    approvedAt: string | null
    approvedRound: number | null
    drawnMember: { round: number; name: string; code: string; startsAt: string } | null
    attempts: Array<{
      round: number
      member: { name: string; code: string }
      result: "PASSED" | "FAILED" | "ABSENT" | null
    }>
  }
}

export const BINS = ["WO", "FC", "DR", "MA"] as const
export type Bin = (typeof BINS)[number]

export const BIN_CHAR: Record<Bin, string> = { WO: "W", FC: "F", DR: "D", MA: "M" }

export function isBin(value: string): value is Bin {
  return value === "WO" || value === "FC" || value === "DR" || value === "MA"
}
