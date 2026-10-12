import { Languages, Mail, User } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton, EditableText, useDraftOutput } from "../OutputEditor";
import { DocHeader } from "../DocHeader";
import { Chip } from "../ToolPage";
import type { Draft, Tone } from "../../../lib/tools";

const TONE_LABEL: Record<Tone, string> = { warm: "Warm", neutral: "Neutral", firm: "Firm" };

// The composer's own surface is the field, so its rows drop EditableText's hover/focus box.
const FLAT = "hover:!border-transparent focus:!border-transparent focus:!bg-transparent";

/*
 * A finished parent email, laid out like a mail composer (Apple Mail / Linear): a document
 * header with chips, then one quiet card with To, Subject and the body, all editable in place.
 * Edits save themselves; nothing is ever sent from here.
 */
export function EmailDoc({ draft }: { draft: Draft<"email"> }) {
  const { output, setOutput, saved } = useDraftOutput(draft);
  if (!output) return null;

  const name = draft.student?.name?.trim() ?? "";
  const first = name.split(/\s+/)[0];
  const tone = draft.input.tone as Tone | undefined;
  const language = output.language || draft.input.language;
  const mailto = `mailto:?subject=${encodeURIComponent(output.subject)}&body=${encodeURIComponent(output.body)}`;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
      <DocHeader
        back={{ to: "/tools/email", label: "Parent email" }}
        title={first ? `Email to ${first}'s family` : "Parent email"}
        saved={saved}
        chips={
          <>
            {name && (
              <Chip>
                <User className="h-3.5 w-3.5" aria-hidden />
                {name}
              </Chip>
            )}
            {tone && TONE_LABEL[tone] && <Chip>{TONE_LABEL[tone]}</Chip>}
            {language && (
              <Chip>
                <Languages className="h-3.5 w-3.5" aria-hidden />
                {language}
              </Chip>
            )}
          </>
        }
      />

      <div className="mt-10 animate-slide-up overflow-hidden rounded-2xl border border-line bg-panel shadow-sm transition-[border-color] duration-fast focus-within:border-line-strong">
        <Row label="To">
          <span className="block py-1 text-base leading-[26px] text-faint">{name ? `Family of ${name}` : "The student's family"}</span>
        </Row>
        <Row label="Subject">
          <EditableText
            single
            label="Subject"
            value={output.subject}
            onChange={(subject) => setOutput({ ...output, subject })}
            placeholder="Subject"
            className={`font-medium ${FLAT}`}
          />
        </Row>
        <div className="px-5 py-5 sm:px-6">
          <EditableText
            label="Body"
            value={output.body}
            onChange={(body) => setOutput({ ...output, body })}
            placeholder="Write your note"
            className={`min-h-[240px] leading-[28px] ${FLAT}`}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <a href={mailto} className="btn-primary">
          <Mail className="h-4 w-4" aria-hidden />
          Open in Mail
        </a>
        <CopyButton text={() => `Subject: ${output.subject}\n\n${output.body}`} size="md" />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 py-2 sm:px-6">
      <span className="w-16 shrink-0 py-1 text-sm leading-[26px] text-faint">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
