/**
 * App shell for signed-in pages: a floating sidebar (a menu on phones) with the
 * "New chat" button, navigation, saved conversations and the user card, next to a
 * floating panel where the current page renders through <Outlet />.
 */
import { useId, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { DEMO } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Icon, type IconName } from "./icons";
import { ConversationList } from "./ConversationList";
import { Avatar, DemoBanner } from "./ui";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Overview", icon: "home", end: true },
  { to: "/ask", label: "Ask Remi", icon: "chat" },
  { to: "/regulations", label: "Regulations", icon: "book" },
  { to: "/impact", label: "Impact", icon: "pulse" },
  { to: "/policies", label: "Our policies", icon: "file" },
  { to: "/settings", label: "Settings", icon: "sliders" },
];

export function Logo() {
  // Each logo needs its own gradient id: with a shared id, a logo can end up using the gradient
  // of another logo that is hidden (e.g. the desktop one on phones), and browsers don't paint
  // gradients from hidden elements, so the violet square disappeared.
  const gradient = `logo-g-${useId().replace(/:/g, "")}`;
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight text-slate-900">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
        <circle cx="16" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="2.25" />
        <path d="M16 16 L25 10" stroke="white" strokeWidth="2.25" strokeLinecap="round" />
      </svg>
      RegRadar
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const [params] = useSearchParams();
  const openId = location.pathname === "/ask" ? params.get("c") : null;

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
      isActive ? "bg-brand-50 text-brand-900" : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"}`;

  return (
    <>
    {DEMO && <DemoBanner />}
    <div className="min-h-screen gap-4 p-3 md:flex md:p-5">
      <aside className="panel mb-3 flex flex-col md:sticky md:top-5 md:mb-0 md:h-[calc(100vh-2.5rem)] md:w-64 md:shrink-0">
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Logo />
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </div>

        <div className={`${menu ? "flex" : "hidden"} min-h-0 flex-1 flex-col md:flex`} onClick={() => setMenu(false)}>
          <div className="px-3">
            <button className="btn-primary w-full rounded-xl py-2.5" onClick={() => navigate("/ask", { state: { fresh: Date.now() } })}>
              <Icon name="plus" /> New chat
            </button>
          </div>

          <nav className="mt-4 space-y-0.5 px-3">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                <Icon name={n.icon} className="h-[18px] w-[18px]" /> {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="mx-4 my-4 border-t border-slate-100" />

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <ConversationList openId={openId} onClosed={() => navigate("/ask", { state: { fresh: Date.now() } })} />
          </div>

          <div className="m-3 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
            <Link to="/settings?tab=account" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl" title="Account settings">
              <Avatar name={user?.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{user?.name}</div>
                <div className="truncate text-xs text-slate-500">{user?.email ?? user?.orgName}</div>
              </div>
            </Link>
            <button onClick={logout} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Sign out" title="Sign out">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <main className="panel flex min-h-[calc(100vh-1.5rem)] flex-1 flex-col md:min-h-[calc(100vh-2.5rem)]">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 md:px-10 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
    </>
  );
}
