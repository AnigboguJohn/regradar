/** The signed-in platform admin, separate from the company user context in lib/auth. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Spinner } from "../components/ui";
import { adminApi, adminPost, adminToken } from "./adminApi";

export interface Admin { id: string; email: string; name: string; last_login_at?: string }

interface AdminState {
  admin: Admin | null;
  loading: boolean;
  signIn: (token: string, admin: Admin) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AdminState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!adminToken.get()) return setLoading(false);
    adminApi<{ admin: Admin }>("/me").then((r) => setAdmin(r.admin)).catch(() => adminToken.set(null)).finally(() => setLoading(false));
  }, []);

  const value: AdminState = {
    admin, loading,
    signIn: (token, a) => { adminToken.set(token); setAdmin(a); },
    // Signing out ends the session on the server too, so a copied token stops working.
    signOut: async () => { await adminPost("/auth/logout", {}).catch(() => undefined); adminToken.set(null); setAdmin(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin outside AdminAuthProvider");
  return v;
}

/** Everything under /admin: its own auth context, separate from company users. */
export function AdminRoot() {
  return <AdminAuthProvider><Outlet /></AdminAuthProvider>;
}

/** Pages under this need a signed-in platform admin. */
export function RequireAdmin() {
  const { admin, loading } = useAdmin();
  if (loading) return <div className="p-8"><Spinner /></div>;
  return admin ? <Outlet /> : <Navigate to="/admin/login" replace />;
}
