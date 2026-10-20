/**
 * React context holding the signed-in user. On page load it asks the API
 * (/me) whether the saved token is still valid; login and logout update both
 * the stored token and the user shown in the UI. Registering does not sign in:
 * the sign-up page sends the new user to the sign-in page. Settings calls
 * updateUser after a profile edit (with the fresh token the API returns).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, post, tokenStore, type ApiError, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, captcha?: string | null, remember?: boolean) => Promise<void>;
  register: (b: { orgName: string; name: string; email: string; password: string; confirmPassword: string; captcha?: string | null }) => Promise<void>;
  logout: () => void;
  updateUser: (user: User, token?: string) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) return setLoading(false);
    let live = true;
    // Check the saved session. Only a real "not valid" answer from the server (401) ends it; a
    // network hiccup (mobile data, leaving the page mid-request) is retried and never signs anyone out.
    (async () => {
      for (let attempt = 0; attempt < 3 && live; attempt++) {
        try {
          const r = await api<{ user: User }>("/me");
          if (live) setUser(r.user);
          break;
        } catch (e) {
          if ((e as ApiError).status === 401 || (e as ApiError).status === 403) { tokenStore.set(null); break; }
          await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        }
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  const accept = (r: { token: string; user: User }, remember: boolean) => { tokenStore.set(r.token, remember); setUser(r.user); };

  const value: AuthState = {
    user, loading,
    login: async (email, password, captcha, remember = false) =>
      accept(await post("/auth/login", { email, password, captcha: captcha ?? undefined, remember }), remember),
    register: async (b) => { await post("/auth/register", { ...b, captcha: b.captcha ?? undefined }); },
    logout: () => { tokenStore.set(null); setUser(null); },
    updateUser: (u, token) => { if (token) tokenStore.set(token); setUser(u); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
