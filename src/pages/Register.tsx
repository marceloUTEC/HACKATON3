import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ApiError, fieldErrors } from "../lib/api"
import { useAuth } from "../lib/auth"
import { Banner, Field, inputClass, useTitle } from "../components/ui"

export function Register() {
  useTitle("Registrar cuadrilla")
  const { register } = useAuth()
  const navigate = useNavigate()
  const [teamName, setTeamName] = useState("Kirkyboy")
  const [email, setEmail] = useState("luis.decardenas@utec.edu.pe")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6">
      <h1 className="font-serif text-4xl text-pine">Registrar cuadrilla</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setPending(true)
          setErrors({})
          setFormError(null)
          void register(teamName.trim(), email.trim(), password).then((code) => {
            navigate("/estado", { replace: true, state: { teamCode: code } })
          }).catch((error: unknown) => {
            setErrors(fieldErrors(error))
            setFormError(error instanceof ApiError ? error.message : "No se pudo registrar.")
          }).finally(() => setPending(false))
        }}
      >
        <Field id="team" label="Nombre de la cuadrilla" error={errors.teamName}>
          <input id="team" className={inputClass} required minLength={3} maxLength={40} value={teamName} aria-invalid={Boolean(errors.teamName)} aria-describedby={errors.teamName ? "team-error" : undefined} onChange={(event) => setTeamName(event.target.value)} />
        </Field>
        <Field id="email" label="Correo" error={errors.email}>
          <input id="email" className={inputClass} type="email" autoComplete="email" required value={email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field id="password" label="Contraseña" error={errors.password}>
          <input id="password" className={inputClass} type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : undefined} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {formError ? <Banner kind="error">{formError}</Banner> : null}
        <button type="submit" className="rounded bg-pine px-4 py-2 text-white disabled:opacity-60" disabled={pending}>
          {pending ? "Creando…" : "Crear y entrar"}
        </button>
      </form>
      <p className="text-sm">¿Ya tienen cuenta? <Link className="text-pine underline" to="/login">Entrar</Link></p>
    </main>
  )
}
