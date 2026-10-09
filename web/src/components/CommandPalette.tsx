import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { BookOpen, MessageSquare, Plus, Settings2, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ConversationSummary } from "../lib/types";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<ConversationSummary[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) api.get<{ conversations: ConversationSummary[] }>("/api/conversations").then((r) => setRecent(r.conversations)).catch(() => undefined);
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const item = "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-muted data-[selected=true]:bg-subtle data-[selected=true]:text-ink";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] animate-fadein" />
        <Dialog.Content className="fixed left-1/2 top-[18vh] z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-xl bg-panel shadow-pop animate-fadein">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Jump to a page or a recent conversation.</Dialog.Description>
          <Command label="Command palette" loop>
            <Command.Input
              autoFocus
              placeholder="Jump to…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-md text-ink placeholder:text-faint focus:outline-none"
            />
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-faint">No results.</Command.Empty>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                <Command.Item className={item} onSelect={() => go("/chat")}>
                  <Plus className="h-4 w-4" /> New question
                </Command.Item>
                <Command.Item className={item} onSelect={() => go("/library")}>
                  <BookOpen className="h-4 w-4" /> Library
                </Command.Item>
                <Command.Item className={item} onSelect={() => go("/roster")}>
                  <Users className="h-4 w-4" /> Roster
                </Command.Item>
                {user?.role === "admin" && (
                  <Command.Item className={item} onSelect={() => go("/admin")}>
                    <Settings2 className="h-4 w-4" /> Admin · runtime & models
                  </Command.Item>
                )}
              </Command.Group>
              {recent.length > 0 && (
                <Command.Group heading="Recent questions" className="mt-1 [&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                  {recent.slice(0, 8).map((c) => (
                    <Command.Item key={c.id} value={`${c.title} ${c.id}`} className={item} onSelect={() => go(`/chat/${c.id}`)}>
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
