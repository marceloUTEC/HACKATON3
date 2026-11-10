import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../lib/auth"
import { useEvents } from "../lib/events"
import { buildHeader } from "../lib/session"

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm ${isActive ? "bg-pine text-white" : "text-ink hover:bg-mist"}`

export function Layout() {
  const { me, can, logout, status, notice } = useAuth()
  const events = useEvents()
  const navigate = useNavigate()
  const location = useLocation()
  const bare = location.pathname === "/login" || location.pathname === "/register"

  if (status === "out" && notice && !bare) {
    return <Navigate to="/login" replace state={{ notice }} />
  }

  if (bare || status !== "in" || !me) {
    return (
      <>
        <a className="sr-only" href="#contenido">Saltar al contenido</a>
        <div id="contenido"><Outlet /></div>
      </>
    )
  }

  return (
    <div className="min-h-screen">
      <a className="sr-only" href="#contenido">Saltar al contenido</a>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/files" className="font-serif text-xl text-pine">MDR</Link>
          <nav className="flex flex-wrap gap-1" aria-label="Principal">
            {can("files:read") ? <NavLink className={linkClass} to="/files">Archivos</NavLink> : null}
            {can("refiners:read") ? <NavLink className={linkClass} to="/refiners">Personal</NavLink> : null}
            {can("incidents:read") ? <NavLink className={linkClass} to="/incidents">Incidencias</NavLink> : null}
            <NavLink className={linkClass} to="/estado">Estado</NavLink>
          </nav>
          <p className="ml-auto text-sm">
            <span className="font-medium">{me.team.code}</span>
            <span className="text-ink/70"> · {me.displayName} · {me.role.name}</span>
          </p>
          <p className="text-sm" role="status">Eventos: {events.status}</p>
          <p className="text-xs text-ink/60">build {buildHeader()}</p>
          <button
            type="button"
            className="rounded border border-pine px-3 py-2 text-sm"
            onClick={() => {
              void logout().finally(() => navigate("/login", { replace: true }))
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <div id="contenido">
        <Outlet />
      </div>
    </div>
  )
}
