import { Menu, Plus } from "lucide-react";
import { PRODUCT_NAME } from "../../lib/brand";
import { Logo } from "../Logo";

const iconBtn = "flex h-10 w-10 shrink-0 items-center justify-center text-muted transition-colors hover:bg-subtle hover:text-ink";

/** Phones only: menu, the mark, and a new question. */
export function MobileBar({ onOpenNav, onNewQuestion }: { onOpenNav: () => void; onNewQuestion: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-bg px-1.5 md:hidden">
      <button className={iconBtn} onClick={onOpenNav} aria-label="Open navigation">
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Logo size={18} />
        <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
      </span>
      <button className={iconBtn} onClick={onNewQuestion} aria-label="New question">
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
    </header>
  );
}
