/**
 * Web app entry point: wires up authentication, routing and the page list.
 * Pages under <Protected> redirect to /login when the user isn't signed in.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { DEMO } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";

// The shareable demo runs inside a sandboxed frame, where hash routing is the safe choice.
const Router = DEMO ? HashRouter : BrowserRouter;
import { AdminRoot, RequireAdmin } from "./admin/AdminAuth";
import { AdminLayout } from "./admin/AdminLayout";
import AdminLogin from "./admin/AdminLogin";
import AdminAccount from "./admin/pages/Account";
import AdminActivity from "./admin/pages/Activity";
import { AdminCompanies, AdminCompany } from "./admin/pages/Companies";
import AdminErrors from "./admin/pages/Errors";
import AdminHealth from "./admin/pages/Health";
import AdminOverview from "./admin/pages/Overview";
import AdminRegulations from "./admin/pages/Regulations";
import AdminUsers from "./admin/pages/Users";
import AcceptInvite from "./pages/AcceptInvite";
import Ask from "./pages/Ask";
import Impact from "./pages/Impact";
import Login from "./pages/Login";
import { ForgotPassword, ResetPassword } from "./pages/PasswordReset";
import Overview from "./pages/Overview";
import Policies from "./pages/Policies";
import { RegulationDetail, Regulations } from "./pages/Regulations";
import Settings from "./pages/Settings";
import Signup from "./pages/Signup";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errorReporting";

installGlobalErrorHandlers();

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8"><Spinner /></div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          {/* Platform admin console: separate accounts, sign-in and layout. */}
          <Route path="/admin" element={<AdminRoot />}>
            <Route path="login" element={<AdminLogin />} />
            <Route element={<RequireAdmin />}>
              <Route element={<AdminLayout />}>
                <Route index element={<AdminOverview />} />
                <Route path="companies" element={<AdminCompanies />} />
                <Route path="companies/:id" element={<AdminCompany />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="regulations" element={<AdminRegulations />} />
                <Route path="health" element={<AdminHealth />} />
                <Route path="errors" element={<AdminErrors />} />
                <Route path="activity" element={<AdminActivity />} />
                <Route path="account" element={<AdminAccount />} />
              </Route>
            </Route>
          </Route>
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Overview />} />
            <Route path="ask" element={<Ask />} />
            <Route path="regulations" element={<Regulations />} />
            <Route path="regulations/:id" element={<RegulationDetail />} />
            <Route path="impact" element={<Impact />} />
            <Route path="policies" element={<Policies />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
