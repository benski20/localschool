import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { isDesktop } from "./lib/shell";
import { api } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { StatusProvider } from "./lib/status";
import { useTheme } from "./lib/theme";
import type { DocumentRow, Student } from "./lib/types";
import { ToastProvider } from "./components/Toaster";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { DemoBanner } from "./components/DemoBanner";
import { PasswordDialog } from "./components/PasswordDialog";
import { Logo } from "./components/Logo";
import { TopBar } from "./components/shell/TopBar";
import { ShellContext, isTyping, type ShellState } from "./components/shell/ShellContext";
import { navFor, SHORTCUTS } from "./components/shell/nav";
import { Chat } from "./pages/Chat";
import { Library } from "./pages/Library";
import { Roster } from "./pages/Roster";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";
import { GetApp } from "./pages/GetApp";
import "./components/shell/shell.css";

export function App() {
  if (window.location.pathname === "/get") return <GetApp />;
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
      <div className="flex h-full items-center justify-center" aria-busy="true" aria-label="Loading">
        <div className="animate-pulse opacity-60 [animation-delay:200ms]">
          <Logo size={28} />
        </div>
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

const COLLAPSE_KEY = "ls-sidebar-collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function Shell() {
  const { user } = useAuth();
  const [theme, setTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [counts, setCounts] = useState<ShellState["counts"]>({ library: null, roster: null });

  useEffect(() => setNavOpen(false), [location.pathname]);

  // Sidebar counts: refreshed whenever the page changes (cheap; no GPU involved).
  useEffect(() => {
    api.get<{ documents: DocumentRow[] }>("/api/documents").then((r) => setCounts((c) => ({ ...c, library: r.documents.length }))).catch(() => undefined);
    api.get<{ students: Student[] }>("/api/roster").then((r) => setCounts((c) => ({ ...c, roster: r.students.length }))).catch(() => undefined);
  }, [location.pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* per-visit only */
      }
      return !v;
    });
  }, []);

  // Keyboard: ⌘K palette, [ sidebar, C new question, G then A/L/R/S to jump.
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const nav = navFor(user?.role);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key.toUpperCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const hit = nav.find((n) => n.key === k);
        if (hit) {
          e.preventDefault();
          navigate(hit.to);
        }
        return;
      }
      if (k === "G") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
      } else if (k === SHORTCUTS.newQuestion) {
        e.preventDefault();
        navigate("/chat");
      } else if (e.key === SHORTCUTS.toggleSidebar) {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleCollapsed, user?.role]);

  const ctx = useMemo<ShellState>(
    () => ({
      theme,
      setTheme,
      openPalette: () => {
        setNavOpen(false);
        setPaletteOpen(true);
      },
      openPassword: () => {
        setNavOpen(false);
        setPwOpen(true);
      },
      collapsed,
      toggleCollapsed,
      counts,
    }),
    [theme, setTheme, collapsed, toggleCollapsed, counts],
  );

  const section = location.pathname.split("/")[1] || "chat";

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-full bg-bg">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenNav={() => setNavOpen(true)} onNewQuestion={() => navigate("/chat")} />
          <DemoBanner />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div key={section} className="ls-route h-full">
              <Outlet />
            </div>
          </main>
        </div>

        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="ls-overlay fixed inset-0 z-40 bg-black/30 md:hidden" />
            <Dialog.Content
              className="ls-drawer fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] focus:outline-none md:hidden"
              aria-describedby={undefined}
            >
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <Sidebar variant="drawer" onClose={() => setNavOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      </div>
    </ShellContext.Provider>
  );
}
