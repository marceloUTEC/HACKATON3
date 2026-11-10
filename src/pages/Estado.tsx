import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import { buildHeader } from "../lib/session"
import { Banner, Field, Spinner, inputClass, useTitle } from "../components/ui"
import type { Check, Clearance, IntegrationStatus } from "../types"

const EMPTY_ROSTER = [
  { name: "Leonardo Martinez", code: "202410148" },
  { name: "Marcelo Rosillo", code: "202410597" },
  { name: "Leonardo Martinez", code: "202410167" },
]

export function Estado() {
  useTitle("Estado")
  const { me, can, reloadMe } = useAuth()
  const location = useLocation()
  const justCreated = (location.state as { teamCode?: string } | null)?.teamCode
  const [health, setHealth] = useState("comprobando")
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null)
  const [clearance, setClearance] = useState<Clearance | null>(null)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [origin, setOrigin] = useState("")
  const [token, setToken] = useState<string | null>(null)
  const [roster, setRoster] = useState(EMPTY_ROSTER)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageProvider, setStorageProvider] = useState<"SUPABASE" | "CLOUDINARY">("CLOUDINARY")
  const [projectUrl, setProjectUrl] = useState(import.meta.env.VITE_SUPABASE_URL ?? "")
  const [publicKey, setPublicKey] = useState(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "")
  const [cloudName, setCloudName] = useState(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ?? "")
  const [preset, setPreset] = useState(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ?? "")

  async function load() {
    setHealth("comprobando")
    try {
      await api("/meta/health", { auth: false })
      setHealth("responde")
    } catch {
      setHealth("sin respuesta")
    }
    try {
      const [status, floor] = await Promise.all([
        api<IntegrationStatus>("/integrations/status"),
        api<Clearance>("/clearance"),
      ])
      setIntegrations(status.data)
      setClearance(floor.data)
      if (floor.data.roster.members.length === 3) setRoster(floor.data.roster.members)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo leer el estado.")
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
      <h1 className="font-serif text-3xl">Estado del piso</h1>
      {justCreated ? <Banner kind="ok">Cuadrilla creada. TEAM_CODE: {justCreated}. Anótalo para la entrega.</Banner> : null}
      {message ? <Banner kind="ok">{message}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <section className="rounded border border-line bg-white p-4">
        <h2 className="font-serif text-xl">Build y API</h2>
        <p>Build desplegado: <strong>{buildHeader()}</strong></p>
        <p>API: {health}</p>
        <p>Equipo: {me?.team.name} · <strong>{me?.team.code}</strong></p>
        <p>Piso de Pruebas: {clearance?.granted ? "abierto" : "cerrado"}</p>
        <p>Caos: {clearance?.workspace.chaosLevel ?? "—"} · Ronda aprobada: {clearance?.round.approved ? "sí" : "no"}</p>
        {clearance?.round.drawnMember ? <p>Sorteado: {clearance.round.drawnMember.name} ({clearance.round.drawnMember.code})</p> : null}
      </section>

      <section className="rounded border border-line bg-white p-4">
        <h2 className="font-serif text-xl">Dominio</h2>
        <p className="text-sm">Origen verificado: {integrations?.deploy.origin ?? "ninguno"}</p>
        <Field id="origin" label="Origen https de la app">
          <input id="origin" className={inputClass} value={origin} placeholder="https://tu-app.vercel.app" onChange={(event) => setOrigin(event.target.value.trim())} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded bg-pine px-3 py-2 text-white" onClick={() => {
            void api<{ token: string }>("/integrations/deploy/challenge", { method: "POST", body: { origin } }).then((result) => {
              setToken(result.data.token)
              setMessage("Publica el token, solo, en /.well-known/lumon-verification.txt y vuelve a desplegar.")
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se pidió el reto."))
          }}>Pedir token</button>
          <button type="button" className="rounded border border-pine px-3 py-2" onClick={() => {
            void api("/integrations/deploy/verify", { method: "POST" }).then(async () => {
              setMessage("Dominio verificado.")
              await load()
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se verificó el dominio."))
          }}>Verificar dominio</button>
        </div>
        {token ? <pre className="mt-3 overflow-x-auto bg-mist p-3 text-sm">{token}</pre> : null}
      </section>

      <section className="rounded border border-line bg-white p-4">
        <h2 className="font-serif text-xl">Storage</h2>
        <p className="text-sm">Proveedor verificado: {integrations?.storage.provider ?? "ninguno"} {integrations?.storage.verifiedAt ? `· ${integrations.storage.verifiedAt}` : ""}</p>
        <label className="mt-2 block text-sm" htmlFor="provider">Proveedor</label>
        <select id="provider" className={inputClass} value={storageProvider} onChange={(event) => setStorageProvider(event.target.value as "SUPABASE" | "CLOUDINARY")}>
          <option value="SUPABASE">Supabase</option>
          <option value="CLOUDINARY">Cloudinary</option>
        </select>
        {storageProvider === "CLOUDINARY" ? (
          <div className="mt-3 flex flex-col gap-2">
            <input className={inputClass} aria-label="Cloud name" value={cloudName} onChange={(event) => setCloudName(event.target.value)} placeholder="cloud name" />
            <input className={inputClass} aria-label="Upload preset" value={preset} onChange={(event) => setPreset(event.target.value)} placeholder="upload preset unsigned" />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm">Bucket público <strong>lumon-media</strong>, solo <strong>image/webp</strong>, máximo 300 KB. La clave anon inserta únicamente en la carpeta del TEAM_CODE y no puede actualizar ni borrar.</p>
            <input className={inputClass} aria-label="URL del proyecto" value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://xxxx.supabase.co" />
            <input className={inputClass} aria-label="Clave anon" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="clave anon, nunca service_role" />
          </div>
        )}
        <button type="button" className="mt-3 rounded bg-pine px-3 py-2 text-white" onClick={() => {
          const body = storageProvider === "CLOUDINARY"
            ? { provider: "CLOUDINARY", cloudName, uploadPreset: preset }
            : { provider: "SUPABASE", projectUrl, bucket: "lumon-media", publicKey }
          void api("/integrations/storage", { method: "PUT", body }).then(async () => {
            setMessage("Storage registrado. Revisa las comprobaciones.")
            await load()
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se registró el storage."))
        }}>Registrar storage</button>
        <ul className="mt-3 text-sm">
          {integrations?.storage.checks.map((check) => <li key={check.name}>{check.passed ? "Sí" : "No"} · {check.name}: {check.detail}</li>)}
        </ul>
      </section>

      {can("team:manage") ? (
        <section className="rounded border border-line bg-white p-4">
          <h2 className="font-serif text-xl">Integrantes</h2>
          <p className="text-sm">Kirkyboy. El tercer cupo repite a Leonardo Martinez con el código 202410167.</p>
          {roster.map((member, index) => (
            <div key={index} className="mt-2 grid grid-cols-2 gap-2">
              <input className={inputClass} aria-label={`Nombre ${index + 1}`} value={member.name} onChange={(event) => setRoster((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              <input className={inputClass} aria-label={`Código ${index + 1}`} value={member.code} onChange={(event) => setRoster((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} />
            </div>
          ))}
          <button type="button" className="mt-3 rounded bg-pine px-3 py-2 text-white" disabled={clearance?.roster.locked} onClick={() => {
            void api("/team/roster", { method: "PUT", body: { members: roster } }).then(async () => {
              setMessage("Roster inscrito.")
              await load()
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se inscribió el roster."))
          }}>Inscribir roster</button>
        </section>
      ) : null}

      <section className="rounded border border-line bg-white p-4">
        <h2 className="font-serif text-xl">Caos y revisión</h2>
        <div className="flex gap-2">
          {[0, 1, 2].map((level) => (
            <button key={level} type="button" className="rounded border px-3 py-2" onClick={() => {
              void api("/workspace/chaos", { method: "PUT", body: { level } }).then(() => setMessage(`Caos ${level}.`)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se cambió el caos."))
            }}>Caos {level}</button>
          ))}
        </div>
        <button type="button" className="mt-3 rounded bg-pine px-3 py-2 text-white" onClick={() => {
          void api<{ granted: boolean; checks: Check[] }>("/clearance/check", { method: "POST" }).then(async (result) => {
            setChecks(result.data.checks)
            setMessage(result.data.granted ? "Piso de Pruebas abierto." : "La revisión todavía no pasa.")
            await reloadMe()
            await load()
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No se pudo correr la revisión."))
        }}>Abrir el Piso de Pruebas</button>
        {!checks && !clearance ? <Spinner label="Cargando revisión…" /> : null}
        <ul className="mt-3 text-sm">
          {(checks ?? clearance?.checks ?? []).map((check) => (
            <li key={check.name}>{check.passed ? "Sí" : "No"} · {check.name}: {check.detail}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
