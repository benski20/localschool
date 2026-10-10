import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Logo } from "./components/Logo";
import { isDesktop } from "./lib/shell";
import { AuthProvider, useAuth } from "./lib/auth";
import { StatusProvider } from "./lib/status";
import { ToastProvider } from "./components/Toaster";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { DemoBanner } from "./components/DemoBanner";
import { Spinner } from "./components/ui";
import { Chat } from "./pages/Chat";
import { Library } from "./pages/Library";
import { Roster } from "./pages/Roster";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <div className="flex h-full flex-col">
          {isDesktop && <TitleBar />}
          <div className="min-h-0 flex-1">
            <Gate />
          </div>
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}

/** Mac app: a draggable strip under the window's traffic-light buttons. */
function TitleBar() {
  return <div data-tauri-drag-region className="h-[38px] shrink-0 select-none" aria-hidden />;
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner />
      </div>
    );
  if (!user) return <Login />;
  return (
    <StatusProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:id" element={<Chat />} />
          <Route path="/library" element={<Library />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/admin" element={user.role === "admin" ? <Admin /> : <Navigate to="/chat" replace />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </StatusProvider>
  );
}

function Shell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="flex h-full flex-col">
      <DemoBanner />
      {/* Narrow screens: top bar + slide-over navigation */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
        <button className="btn-ghost h-8 w-8 px-0" onClick={() => setNavOpen(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <Logo size={22} />
        <span className="text-sm font-semibold text-ink">Local School</span>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        {navOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-black/30 animate-fadein" onClick={() => setNavOpen(false)} aria-hidden />
            <div className="relative h-full shadow-pop animate-fadein">
              <Sidebar />
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
