import { Link } from "react-router-dom"
import { useTitle } from "../components/ui"

export function NotFound() {
  useTitle("No encontrada")
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-3 px-6 py-16">
      <h1 className="font-serif text-3xl">Página no encontrada</h1>
      <p>Esa ruta no existe en el piso.</p>
      <Link className="text-pine underline" to="/files">Ir a los archivos</Link>
    </main>
  )
}
