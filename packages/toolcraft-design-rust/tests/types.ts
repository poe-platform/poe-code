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

type AcpEvents = Pick<
  typeof originalDesign.acp,
  | "renderToolStart"
  | "renderToolComplete"
  | "renderReasoning"
  | "renderUsage"
  | "renderError"
  | "renderPermissionRejected"
>;
const acpEventsOriginal: AcpEvents = design.acp;
const acpEventsOwn: Pick<typeof design.acp, keyof AcpEvents> = null as unknown as AcpEvents;
void [acpEventsOriginal, acpEventsOwn];

type RootLineBuffers = Pick<
  typeof originalDesign,
  "createDashboardLineBuffer" | "createStreamingDashboardLineBuffer"
>;
const rootLineBuffersOriginal: RootLineBuffers = design;
const rootLineBuffersOwn: Pick<typeof design, keyof RootLineBuffers> =
  null as unknown as RootLineBuffers;
void [rootLineBuffersOriginal, rootLineBuffersOwn];

import * as table from "toolcraft-design-rust/components/table";
import * as flatTable from "toolcraft-design-rust/render-table";
import type * as originalTable from "toolcraft-design/components/table";
import type * as originalFlatTable from "toolcraft-design/render-table";
const tableOriginal: typeof originalTable = table;
const tableOwn: typeof table = null as unknown as typeof originalTable;
const flatTableOriginal: typeof originalFlatTable = flatTable;
const flatTableOwn: typeof flatTable = null as unknown as typeof originalFlatTable;
const rootTableOriginal: Pick<typeof originalDesign, "renderTable"> = design;
const rootTableOwn: Pick<typeof design, "renderTable"> = null as unknown as typeof originalDesign;
const tableOptionsOriginal: originalTable.RenderTableOptions = null as unknown as table.RenderTableOptions;
const tableOptionsOwn: table.RenderTableOptions = null as unknown as originalTable.RenderTableOptions;
void [tableOriginal, tableOwn, flatTableOriginal, flatTableOwn, rootTableOriginal, rootTableOwn, tableOptionsOriginal, tableOptionsOwn];

import * as diagnostics from "toolcraft-design-rust/components/command-errors";
import type * as originalDiagnostics from "toolcraft-design/components/command-errors";
const diagnosticsOriginal: typeof originalDiagnostics = diagnostics;
const diagnosticsOwn: typeof diagnostics = null as unknown as typeof originalDiagnostics;
const rootDiagnosticsOriginal: typeof originalDiagnostics = design;
const rootDiagnosticsOwn: typeof diagnostics = null as unknown as typeof originalDesign;
void [diagnosticsOriginal, diagnosticsOwn, rootDiagnosticsOriginal, rootDiagnosticsOwn];

import * as files from "toolcraft-design-rust/components/file-changes";
import type * as originalFiles from "toolcraft-design/components/file-changes";
const filesOriginal: typeof originalFiles = files;
const filesOwn: typeof files = null as unknown as typeof originalFiles;
const rootFilesOriginal: typeof originalFiles = design;
const rootFilesOwn: typeof files = null as unknown as typeof originalDesign;
const fileOptionsOriginal: originalFiles.RenderFileChangesOptions = null as unknown as files.RenderFileChangesOptions;
const fileOptionsOwn: files.RenderFileChangesOptions = null as unknown as originalFiles.RenderFileChangesOptions;
const fileOriginal: originalFiles.FileChange = null as unknown as files.FileChange;
const fileOwn: files.FileChange = null as unknown as originalFiles.FileChange;
void [filesOriginal,filesOwn,rootFilesOriginal,rootFilesOwn,fileOptionsOriginal,fileOptionsOwn,fileOriginal,fileOwn];

import * as help from "toolcraft-design-rust/components/help-formatter";
import * as plainHelp from "toolcraft-design-rust/components/help-formatter-plain";
import type * as originalHelp from "toolcraft-design/components/help-formatter";
import type * as originalPlainHelp from "toolcraft-design/components/help-formatter-plain";
const helpOriginal: typeof originalHelp = help;
const helpOwn: typeof help = null as unknown as typeof originalHelp;
const plainHelpOriginal: typeof originalPlainHelp = plainHelp;
const plainHelpOwn: typeof plainHelp = null as unknown as typeof originalPlainHelp;
const rootHelpOriginal: typeof originalHelp = design;
const rootHelpOwn: typeof help = null as unknown as typeof originalDesign;
const rootPlainOriginal: typeof originalPlainHelp = design.helpFormatterPlain;
const rootPlainOwn: typeof plainHelp = null as unknown as typeof originalDesign.helpFormatterPlain;
void [helpOriginal,helpOwn,plainHelpOriginal,plainHelpOwn,rootHelpOriginal,rootHelpOwn,rootPlainOriginal,rootPlainOwn];

import * as catalog from "toolcraft-design-rust/components/catalog";
import * as resources from "toolcraft-design-rust/components/resource-browser";
import type * as originalCatalog from "toolcraft-design/components/catalog";
import type * as originalResources from "toolcraft-design/components/resource-browser";
const catalogOriginal: typeof originalCatalog = catalog;
const catalogOwn: typeof catalog = null as unknown as typeof originalCatalog;
const resourcesOriginal: typeof originalResources = resources;
const resourcesOwn: typeof resources = null as unknown as typeof originalResources;
const rootCatalogOriginal: typeof originalCatalog = design;
const rootResourcesOriginal: typeof originalResources = design;
const rootCatalogOwn: typeof catalog = null as unknown as typeof originalDesign;
const rootResourcesOwn: typeof resources = null as unknown as typeof originalDesign;
void [catalogOriginal,catalogOwn,resourcesOriginal,resourcesOwn,rootCatalogOriginal,rootResourcesOriginal,rootCatalogOwn,rootResourcesOwn];
