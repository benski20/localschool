import type { ReactNode } from "react";
import clsx from "clsx";

export const SUGGESTIONS = [
  "Which of my students have extended time?",
  "Late work policy for students with an IEP",
  "Who are my English learners?",
  "How do I book a separate testing room?",
];

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Small tracked label, used sparingly. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11px] font-medium uppercase tracking-[0.08em] text-faint", className)}>{children}</div>;
}

/**
 * The first screen: a greeting, the school, one large box, a few starting points.
 * `leaving` collapses the suggestions and fades the greeting as the first question goes out.
 */
export function Welcome({
  name,
  school,
  leaving,
  onPick,
  composer,
}: {
  name: string;
  school: string;
  leaving: boolean;
  onPick: (q: string) => void;
  composer: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col px-4 md:px-10">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center pb-[12vh] pt-10 md:pb-[16vh]">
        <header className={clsx("chat-welcome-head mb-8 md:mb-10", leaving && "chat-leave")}>
          {school && <div className="mb-2 text-sm text-muted">{school}</div>}
          <h1 className="font-serif text-[34px] leading-[42px] tracking-[-0.01em] text-ink md:text-[40px] md:leading-[48px]">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
        </header>

        <div className="chat-fade">{composer}</div>

        <div className={clsx("chat-collapse", leaving && "chat-collapse-closed")} aria-hidden={leaving || undefined}>
          <div className="min-h-0">
            <div className="chat-stagger flex flex-wrap gap-2 pt-5">
              {SUGGESTIONS.map((q, i) => (
                <button
                  key={q}
                  type="button"
                  tabIndex={leaving ? -1 : 0}
                  onClick={() => onPick(q)}
                  className={clsx(
                    "max-w-full rounded-full bg-ink/[0.045] px-3.5 py-1.5 text-left text-[13.5px] leading-[20px] text-muted transition-colors hover:bg-ink/[0.08] hover:text-ink",
                    i === 3 && "max-sm:hidden",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
