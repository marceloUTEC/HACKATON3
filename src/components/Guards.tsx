import { Navigate, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { useAuth } from "../lib/auth"
import type { Permission } from "../types"
import { Forbidden } from "../pages/Forbidden"

export function Require({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { status, can } = useAuth()
  const location = useLocation()
  if (status === "booting") {
    return <p className="p-8 text-sm" role="status">Verificando sesión…</p>
  }
  if (status !== "in") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  if (permission && !can(permission)) return <Forbidden />
  return children
}

export function Guest({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  if (status === "booting") return <p className="p-8 text-sm" role="status">Verificando sesión…</p>
  if (status === "in") return <Navigate to={from || "/files"} replace />
  return children
}
