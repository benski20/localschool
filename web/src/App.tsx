import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { isDesktop } from "./lib/shell";
import { AuthProvider, useAuth } from "./lib/auth";
import { StatusProvider } from "./lib/status";
import { useTheme } from "./lib/theme";
import { ToastProvider } from "./components/Toaster";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { PasswordDialog } from "./components/PasswordDialog";
import { Logo } from "./components/Logo";
import { MobileBar } from "./components/shell/MobileBar";
import { ShellContext, type ShellState } from "./components/shell/ShellContext";
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

function Shell() {
  const [theme, setTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => setNavOpen(false), [location.pathname, location.key]);

  // ⌘K opens the quick switcher (kept for people who know it; never advertised).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    }),
    [theme, setTheme],
  );

  const section = location.pathname.split("/")[1] || "chat";

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-full bg-bg">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar onOpenNav={() => setNavOpen(true)} onNewQuestion={() => navigate("/chat")} />
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
