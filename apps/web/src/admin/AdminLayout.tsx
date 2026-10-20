/**
 * Shell of the admin console: a dark sidebar (so it's never mistaken for the customer
 * app) with the console sections, and the signed-in admin with sign-out at the bottom.
 */
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Icon, type IconName } from "../components/icons";
import { Logo } from "../components/Layout";
import { useAdmin } from "./AdminAuth";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/admin", label: "Overview", icon: "home", end: true },
  { to: "/admin/companies", label: "Companies", icon: "building" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/regulations", label: "Regulations & sync", icon: "book" },
  { to: "/admin/health", label: "System health", icon: "pulse" },
  { to: "/admin/errors", label: "Errors", icon: "bell" },
  { to: "/admin/activity", label: "Activity & audit", icon: "clipboard" },
  { to: "/admin/account", label: "My admin account", icon: "lock" },
];

export function AdminLayout() {
  const { admin, signOut } = useAdmin();
  const [menu, setMenu] = useState(false);
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`;

  return (
    <div className="min-h-screen bg-slate-100 md:flex">
      <aside className="flex flex-col bg-slate-950 text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0">
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5 [&_span]:text-white">
            <Logo />
            <span className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider !text-slate-300">Admin</span>
          </div>
          <button className="rounded-lg p-2 text-slate-300 hover:bg-white/10 md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </div>
        <div className={`${menu ? "flex" : "hidden"} flex-1 flex-col md:flex`} onClick={() => setMenu(false)}>
          <nav className="space-y-0.5 px-3">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                <Icon name={n.icon} className="h-[18px] w-[18px]" /> {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto border-t border-white/10 p-4">
            <div className="truncate text-sm font-medium">{admin?.name}</div>
            <div className="truncate text-xs text-slate-400">{admin?.email}</div>
            <button onClick={signOut} className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white">
              <Icon name="logout" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl"><Outlet /></div>
      </main>
    </div>
  );
}
