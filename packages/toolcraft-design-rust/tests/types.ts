import {
  renderTemplate,
  getTemplatePartialNames,
  resolveTemplatePartials,
  TemplateParseError,
  type RenderTemplateOptions
} from "../dist/index.js";
const options: RenderTemplateOptions = {
  escape: "none",
  partials: { header: "{{name}}" },
  validate: true,
  yield: "Child"
};
const text: string = renderTemplate("{{> header}} {{yield}}", { name: "K" }, options);
const names: string[] = getTemplatePartialNames(text);
const expanded: string = resolveTemplatePartials(
  text,
  Object.fromEntries(names.map((name) => [name, "value"]))
);
const error: Error = new TemplateParseError(expanded, { line: 1, column: 1 });
void error;

import { computeDashboardLayout, type LayoutOptions, type DashboardLayout } from "../dist/index.js";
const layoutOptions: LayoutOptions = { totalWidth: 80, totalHeight: 24 };
const layout: DashboardLayout = computeDashboardLayout(layoutOptions);
void layout;

import * as design from "../dist/index.js";
import type * as originalDesign from "toolcraft-design";
type OriginalPreview = Pick<
  typeof originalDesign.dashboard,
  "limitOutputPreview" | "createOutputPreviewBuffer"
>;
const previewSdk: OriginalPreview = design.dashboard;
const ownPreview: Pick<typeof design.dashboard, keyof OriginalPreview> =
  null as unknown as OriginalPreview;
void [previewSdk, ownPreview];

type Logging = Pick<
  typeof originalDesign,
  | "createLogger"
  | "logger"
  | "stripAnsi"
  | "resolveOutputFormat"
  | "withOutputFormat"
  | "resetOutputFormatCache"
  | "configureTheme"
  | "getThemeConfig"
  | "resetTheme"
>;
const loggingOriginal: Logging = design;
const loggingOwn: Pick<typeof design, keyof Logging> = null as unknown as Logging;
void [loggingOriginal, loggingOwn];
type Visual = Pick<
  typeof originalDesign,
  | "color"
  | "text"
  | "typography"
  | "brands"
  | "brand"
  | "dark"
  | "light"
  | "getTheme"
  | "resolveThemeName"
  | "resetThemeCache"
>;
const visualOriginal: Visual = design;
const visualOwn: Pick<typeof design, keyof Visual> = null as unknown as Visual;
void [visualOriginal, visualOwn];
type Plans = Pick<
  typeof originalDesign.acp,
  "formatAgentPlan" | "renderAgentPlan" | "getAcpWriter" | "withAcpWriter"
>;
const plansOriginal: Plans = design.acp;
const plansOwn: Pick<typeof design.acp, keyof Plans> = null as unknown as Plans;
void [plansOriginal, plansOwn];

const ownLines: typeof originalDesign.dashboard.createDashboardLineBuffer =
  design.dashboard.createDashboardLineBuffer;
const originalLines: typeof design.dashboard.createDashboardLineBuffer =
  null as unknown as typeof originalDesign.dashboard.createDashboardLineBuffer;
const ownStreamingLines: typeof originalDesign.dashboard.createStreamingDashboardLineBuffer =
  design.dashboard.createStreamingDashboardLineBuffer;
const originalStreamingLines: typeof design.dashboard.createStreamingDashboardLineBuffer =
  null as unknown as typeof originalDesign.dashboard.createStreamingDashboardLineBuffer;
void [ownLines, originalLines, ownStreamingLines, originalStreamingLines];
