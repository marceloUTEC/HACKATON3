import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api } from "./api"
import { adoptTokens, getRefreshToken, hasFreshAccess, listenForOtherTabs, logoutSession, onSession, refreshSession, type SessionNotice } from "./session"
import type { Me, Permission, TokenPair, User } from "../types"

const NOTICES: Record<SessionNotice, string> = {
  REFRESH_REUSED: "La sesión se cerró porque el token de refresco se volvió a usar. Entra de nuevo.",
  SESSION_REVOKED: "La sesión fue revocada. Entra de nuevo.",
  TOKEN_INVALID: "La sesión ya no es válida. Entra de nuevo.",
  LOGOUT: "La sesión se cerró.",
}

interface AuthState {
  status: "booting" | "in" | "out"
  me: Me | null
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  register: (teamName: string, email: string, password: string) => Promise<string>
  logout: () => Promise<void>
  can: (permission: Permission) => boolean
  reloadMe: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("booting")
  const [me, setMe] = useState<Me | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    listenForOtherTabs()
    return onSession((event) => {
      if (event.type === "logout") {
        setMe(null)
        setStatus("out")
        setNotice(NOTICES.LOGOUT)
      } else if (event.type === "revoked") {
        setMe(null)
        setStatus("out")
        setNotice(NOTICES[event.code])
      }
    })
  }, [])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (!getRefreshToken()) {
        if (!cancel) setStatus("out")
        return
      }
      try {
        await refreshSession()
        const result = await api<Me>("/auth/me")
        if (cancel) return
        setMe(result.data)
        setStatus("in")
      } catch {
        if (!cancel) {
          setMe(null)
          setStatus("out")
        }
      }
    })()
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (status !== "in") return
    const timer = window.setInterval(() => {
      if (!hasFreshAccess(12_000)) void refreshSession().catch(() => undefined)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [status])

  async function enter(path: string, body: unknown): Promise<{ me: Me; teamCode?: string }> {
    const result = await api<TokenPair & { user: User; team?: { code: string; name: string } }>(path, {
      method: "POST",
      body,
      auth: false,
    })
    adoptTokens(result.data.accessToken, result.data.refreshToken, result.data.expiresIn)
    const profile = await api<Me>("/auth/me")
    setMe(profile.data)
    setNotice(null)
    setStatus("in")
    return { me: profile.data, teamCode: result.data.team?.code }
  }

  const value = useMemo<AuthState>(() => ({
    status,
    me,
    notice,
    can: (permission) => me?.permissions.includes(permission) ?? false,
    reloadMe: async () => {
      const profile = await api<Me>("/auth/me")
      setMe(profile.data)
    },
    login: async (email, password) => {
      await enter("/auth/login", { email, password })
    },
    register: async (teamName, email, password) => {
      const result = await enter("/auth/register", { teamName, email, password })
      return result.teamCode ?? result.me.team.code
    },
    logout: async () => {
      await logoutSession()
      setMe(null)
      setStatus("out")
      setNotice(NOTICES.LOGOUT)
    },
  }), [status, me, notice])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth fuera del proveedor")
  return value
}
