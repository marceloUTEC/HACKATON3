import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, RouterProvider, useRouteError } from "react-router-dom"
import { AuthProvider } from "./lib/auth"
import { EventsProvider } from "./lib/events"
import { HealthGate } from "./components/HealthGate"
import { Layout } from "./components/Layout"
import { Guest, Require } from "./components/Guards"
import { Contingency } from "./components/Contingency"
import { Login } from "./pages/Login"
import { Register } from "./pages/Register"
import { NotFound } from "./pages/NotFound"

const Files = lazy(() => import("./pages/Files").then((module) => ({ default: module.Files })))
const Refine = lazy(() => import("./pages/Refine").then((module) => ({ default: module.Refine })))
const Refiners = lazy(() => import("./pages/Refiners").then((module) => ({ default: module.Refiners })))
const RefinerEdit = lazy(() => import("./pages/RefinerEdit").then((module) => ({ default: module.RefinerEdit })))
const Badge = lazy(() => import("./pages/Badge").then((module) => ({ default: module.Badge })))
const Incidents = lazy(() => import("./pages/Incidents").then((module) => ({ default: module.Incidents })))
const IncidentNew = lazy(() => import("./pages/IncidentNew").then((module) => ({ default: module.IncidentNew })))
const Estado = lazy(() => import("./pages/Estado").then((module) => ({ default: module.Estado })))

function RouteError() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : "Error de render."
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-3 px-6 py-16">
      <h1 className="font-serif text-3xl">Esta pantalla falló</h1>
      <p role="alert">{message}</p>
      <a className="text-pine underline" href="/files">Volver</a>
    </main>
  )
}

function Pending() {
  return <p className="p-6 text-sm" role="status">Cargando…</p>
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/files" replace /> },
      { path: "login", element: <Guest><Login /></Guest> },
      { path: "register", element: <Guest><Register /></Guest> },
      { path: "files", element: <Require permission="files:read"><Suspense fallback={<Pending />}><Files /></Suspense></Require> },
      { path: "files/:id/refine", element: <Require permission="files:read"><Suspense fallback={<Pending />}><Refine /></Suspense></Require> },
      { path: "refiners", element: <Require permission="refiners:read"><Suspense fallback={<Pending />}><Refiners /></Suspense></Require> },
      { path: "refiners/:id/edit", element: <Require permission="refiners:write"><Suspense fallback={<Pending />}><RefinerEdit /></Suspense></Require> },
      { path: "refiners/:id/badge", element: <Require permission="media:upload"><Suspense fallback={<Pending />}><Badge /></Suspense></Require> },
      { path: "incidents", element: <Require permission="incidents:read"><Suspense fallback={<Pending />}><Incidents /></Suspense></Require> },
      { path: "incidents/new", element: <Require permission="incidents:create"><Suspense fallback={<Pending />}><IncidentNew /></Suspense></Require> },
      { path: "estado", element: <Require><Suspense fallback={<Pending />}><Estado /></Suspense></Require> },
      { path: "*", element: <NotFound /> },
    ],
  },
])

export function App() {
  return (
    <HealthGate>
      <AuthProvider>
        <EventsProvider>
          <RouterProvider router={router} />
          <Contingency />
        </EventsProvider>
      </AuthProvider>
    </HealthGate>
  )
}
