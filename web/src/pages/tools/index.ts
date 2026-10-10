/**
 * Tools routes and nav entry, for the integrator to mount inside the signed-in Shell:
 *
 *   {toolRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
 *   nav: [..., toolsNavItem]
 */
import { createElement, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { ToolsHome } from "./ToolsHome";
import { MeetingNotes } from "./MeetingNotes";
import { Feedback } from "./Feedback";
import { Adapt } from "./Adapt";
import { ParentEmail } from "./ParentEmail";

const PAGES = { meeting: MeetingNotes, feedback: Feedback, adapt: Adapt, email: ParentEmail } as const;

// Each tool renders the same component with or without a draft id, so the form keeps what the
// teacher typed when a draft opens below it (e.g. the rubric stays chosen for the next batch).
export const toolRoutes: { path: string; element: ReactElement }[] = [
  { path: "/tools", element: createElement(ToolsHome) },
  ...Object.entries(PAGES).flatMap(([tool, Page]) => [
    { path: `/tools/${tool}`, element: createElement(Page) },
    { path: `/tools/${tool}/:draftId`, element: createElement(Page) },
  ]),
  { path: "/tools/*", element: createElement(Navigate, { to: "/tools", replace: true }) },
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
