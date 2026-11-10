import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

function resolveSha(command: string): string {
  if (command !== "build") return "dev"
  const candidates = [
    process.env.VITE_LUMON_BUILD,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
    process.env.COMMIT_REF,
  ]
  for (const candidate of candidates) {
    if (candidate && /^[0-9a-f]{7,40}$/i.test(candidate)) {
      return candidate.slice(0, 7).toLowerCase()
    }
  }
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim()
  } catch {
    return "dev"
  }
}

export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const connect = [
    "'self'",
    "https://lumon-api.vercel.app",
    "wss://lumon-api.vercel.app",
    "https://api.cloudinary.com",
    "https://res.cloudinary.com",
  ]
  if (supabaseUrl) {
    try {
      connect.push(new URL(supabaseUrl).origin)
    } catch {
      /* URL de storage inválida: no entra a connect-src */
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect.join(" ")}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ")
}

function headersPlugin(supabaseUrl: string | undefined): Plugin {
  return {
    name: "lumon-headers",
    apply: "build",
    closeBundle() {
      const csp = contentSecurityPolicy(supabaseUrl)
      const body = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/.well-known/lumon-verification.txt
  Content-Type: text/plain; charset=utf-8
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`
      writeFileSync(resolve("dist/_headers"), body)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const sha = resolveSha(command)
  return {
    plugins: [react(), headersPlugin(env.VITE_SUPABASE_URL)],
    define: {
      __LUMON_BUILD__: JSON.stringify(sha),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-router") || id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
              return "react"
            }
            return undefined
          },
        },
      },
    },
  }
})
