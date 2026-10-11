import { useEffect, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { api } from "../lib/api";
import { PRODUCT_NAME } from "../lib/brand";
import { Monogram } from "../components/shell/Monogram";
import { schoolName } from "../components/shell/health";

interface Trust {
  school: string;
  deployment: "school" | "personal" | "demo";
  ai: "on_site" | "school" | "cloud";
  activity_days: number;
  session_days: number;
  version: string;
}

/** Public page (/privacy): how this install handles information, in plain language, for
 *  teachers, parents, heads and boards. Facts come from /api/trust, so it's true here.
 *  Prints as a one-pager. */
export function Privacy() {
  const [t, setT] = useState<Trust | null>(null);
  useEffect(() => {
    api.get<Trust>("/api/trust").then(setT).catch(() => setT(null));
  }, []);
  const school = schoolName(t?.school) || "your school";
  const years = t ? Math.round((t.activity_days / 365) * 10) / 10 : 1;
  const kept = years >= 1 ? `${years === 1 ? "one year" : `${years} years`}` : `${t?.activity_days} days`;

  return (
    <div className="h-full overflow-y-auto bg-bg print:h-auto print:overflow-visible">
      <main className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-12 sm:px-8 sm:pt-20 print:max-w-none print:p-0">
        <div className="flex items-center justify-between gap-4">
          <a href="/" className="inline-flex items-center gap-3">
            <Monogram name={schoolName(t?.school) || PRODUCT_NAME} size={28} />
            <span className="text-sm text-muted">{schoolName(t?.school) || PRODUCT_NAME}</span>
          </a>
          <button type="button" className="btn-ghost print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Print
          </button>
        </div>

        <h1 className="mt-10 text-2xl font-normal text-ink">How {PRODUCT_NAME} handles information</h1>
        <p className="mt-3 text-base text-muted">
          {PRODUCT_NAME} helps teachers find answers in school documents and draft meeting notes, feedback and emails. Here is
          exactly what happens to the information it uses.
        </p>

        {t?.deployment === "demo" && (
          <p className="mt-6 border border-warning/40 bg-panel px-4 py-3 text-sm text-ink">
            This is a demonstration with fictional students. Don't enter real student information here.
          </p>
        )}

        <div className="mt-10 space-y-9 print:mt-6 print:space-y-5">
          <Part title="Where information is kept">
            {t?.deployment === "personal" ? (
              <p>
                On this teacher's own Mac, which must be encrypted (FileVault). Documents, class lists, chats, drafts and
                recordings stay on it. They aren't copied to the school or to anyone else.
              </p>
            ) : (
              <p>
                On {school}'s own {PRODUCT_NAME} server. Documents, class lists, chats, drafts and recordings are stored there,
                not with an outside company.
              </p>
            )}
          </Part>

          <Part title="What the AI sees">
            {t?.ai === "on_site" && (
              <p>The AI runs on equipment at {school}. For each question it reads only the few passages needed to answer. Nothing leaves the school.</p>
            )}
            {t?.ai === "school" && (
              <p>
                The AI runs on {school}'s server. For each question this Mac sends only the few passages needed to answer, and the
                school's server doesn't keep them.
              </p>
            )}
            {t?.ai === "cloud" && (
              <p>
                The AI runs on a cloud computer chosen by {school}. For each question, only the few passages needed to answer are
                sent to it. They aren't stored there.
              </p>
            )}
            <p>Information is never used to train AI models, sold, or shown to advertisers.</p>
          </Part>

          <Part title="Who can see what">
            <ul>
              <li>Teachers see the students in their own classes.</li>
              <li>A file a teacher attaches to a question is private to that teacher.</li>
              <li>Meeting notes, feedback and emails stay private to the teacher who made them until they copy or send them.</li>
              <li>Administrators manage accounts, the shared library and class lists.</li>
            </ul>
          </Part>

          <Part title="Meeting recordings">
            <p>
              A meeting is recorded only after the teacher confirms everyone present has agreed. In the Mac app, the recording
              can include the other side of a video call. The audio is deleted as soon as the teacher approves the notes.
            </p>
            {t?.ai === "school" && (
              <p>
                The recording, transcript, notes and the teacher's own notes are kept only on this Mac. To turn the recording
                into a transcript and notes, the audio and transcript are sent to {school}'s server, which passes them to its AI
                and sends the result straight back. The school's server doesn't keep them: a recording is deleted as soon as it
                has been transcribed, or within a day if the upload is interrupted. If {school}'s AI runs on a cloud computer
                rather than on equipment at the school, the audio passes through that computer too. For real student meetings,
                schools should run their AI on their own equipment.
              </p>
            )}
          </Part>

          <Part title="What is kept, and for how long">
            <ul>
              <li>Documents and class lists: until an administrator removes them.</li>
              <li>Chats and drafts: until the teacher deletes them.</li>
              <li>
                A record of sign-ins and of whose student information was used, and by whom: kept for {kept} so the school can
                answer questions about access. It never contains what was asked.
              </li>
              <li>Signing in lasts {t?.session_days ?? 14} days on a device, then {PRODUCT_NAME} asks again.</li>
            </ul>
          </Part>

          <Part title="Questions">
            <p>Contact {school}'s {PRODUCT_NAME} administrator.</p>
          </Part>
        </div>

        {t && <p className="mt-12 text-xs text-faint">{PRODUCT_NAME} {t.version}</p>}
      </main>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="text-lg font-normal text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-base leading-7 text-muted [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:content-['–'] [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
