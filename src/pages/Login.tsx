import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ApiError, fieldErrors } from "../lib/api"
import { useAuth } from "../lib/auth"
import { Banner, Field, inputClass, useTitle } from "../components/ui"

export function Login() {
  useTitle("Entrar")
  const { login, notice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string; notice?: string } | null)?.from || "/files"
  const arrived = (location.state as { notice?: string } | null)?.notice
  const [email, setEmail] = useState("luis.decardenas@utec.edu.pe")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6">
      <h1 className="font-serif text-4xl text-pine">Entrar al piso</h1>
      {arrived || notice ? <Banner kind="info">{arrived || notice}</Banner> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setPending(true)
          setFormError(null)
          setErrors({})
          void login(email.trim(), password).then(() => {
            navigate(from, { replace: true })
          }).catch((error: unknown) => {
            setErrors(fieldErrors(error))
            setFormError(error instanceof ApiError ? error.message : "No se pudo entrar.")
          }).finally(() => setPending(false))
        }}
      >
        <Field id="email" label="Correo" error={errors.email}>
          <input id="email" className={inputClass} type="email" autoComplete="username" required value={email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field id="password" label="Contraseña" error={errors.password}>
          <input id="password" className={inputClass} type="password" autoComplete="current-password" required value={password} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : undefined} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {formError ? <Banner kind="error">{formError}</Banner> : null}
        <button type="submit" className="rounded bg-pine px-4 py-2 text-white disabled:opacity-60" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <p className="text-sm">¿Primera cuadrilla? <Link className="text-pine underline" to="/register">Registrar</Link></p>
    </main>
  )
}
