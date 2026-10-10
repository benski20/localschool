/**
 * Tools routes and nav entry, for the integrator to mount inside the signed-in Shell:
 *
 *   {toolRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
 *   nav: [..., toolsNavItem]
 */
import { createElement, type ReactElement } from "react";
import { Navigate, useParams } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { ToolsHome } from "./ToolsHome";
import { MeetingNotes } from "./MeetingNotes";
import { Feedback } from "./Feedback";
import { Adapt } from "./Adapt";
import { ParentEmail } from "./ParentEmail";

const PAGES = { meeting: MeetingNotes, feedback: Feedback, adapt: Adapt, email: ParentEmail } as const;

/** /tools/:tool/:draftId — the tool's own screen with that draft open. */
function ToolDraft() {
  const { tool } = useParams();
  const Page = PAGES[tool as keyof typeof PAGES];
  return Page ? createElement(Page) : createElement(Navigate, { to: "/tools", replace: true });
}

export const toolRoutes: { path: string; element: ReactElement }[] = [
  { path: "/tools", element: createElement(ToolsHome) },
  { path: "/tools/meeting", element: createElement(MeetingNotes) },
  { path: "/tools/feedback", element: createElement(Feedback) },
  { path: "/tools/adapt", element: createElement(Adapt) },
  { path: "/tools/email", element: createElement(ParentEmail) },
  { path: "/tools/:tool/:draftId", element: createElement(ToolDraft) },
];

/** Same shape as NavItem in components/shell/nav.ts. */
export const toolsNavItem = {
  to: "/tools",
  label: "Tools",
  hint: "Meeting notes, feedback, readings and parent emails",
  icon: LayoutGrid,
  key: "T",
};

export { ToolsHome, MeetingNotes, Feedback, Adapt, ParentEmail };
