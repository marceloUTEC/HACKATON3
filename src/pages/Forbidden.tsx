import { Link } from "react-router-dom"
import { useTitle } from "../components/ui"

export function Forbidden() {
  useTitle("Sin permiso")
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-3 px-6 py-16">
      <h1 className="font-serif text-3xl">Sin permiso</h1>
      <p>Tu rol en esta cuadrilla no puede abrir esta pantalla.</p>
      <Link className="text-pine underline" to="/files">Volver a los archivos</Link>
    </main>
  )
}
