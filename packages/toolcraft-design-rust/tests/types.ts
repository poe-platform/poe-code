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
import * as cellText from "toolcraft-design-rust/explorer/render/text";
import type * as originalCellText from "toolcraft-design/explorer/render/text";
import * as terminalWidth from "toolcraft-design-rust/dashboard/terminal-width";
import type * as originalTerminalWidth from "toolcraft-design/dashboard/terminal-width";
const cellsSdk: typeof originalCellText = cellText;
const nativeCells: typeof cellText = null as unknown as typeof originalCellText;
const widthsSdk: typeof originalTerminalWidth = terminalWidth;
const nativeWidths: typeof terminalWidth = null as unknown as typeof originalTerminalWidth;
void [cellsSdk, nativeCells, widthsSdk, nativeWidths];
type Interaction = Pick<typeof originalDesign, "createCommandRegistry" | "createOverlayManager" | "createViewport" | "selectViewportTail">;
const interactionSdk: Interaction = design;
const nativeInteraction: Pick<typeof design, keyof Interaction> = null as unknown as Interaction;
void [interactionSdk, nativeInteraction];
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

import * as symbols from "toolcraft-design-rust/components/symbols";
import * as tokens from "toolcraft-design-rust/tokens/index";
import * as tokenColors from "toolcraft-design-rust/tokens/colors";
import * as tokenBrand from "toolcraft-design-rust/tokens/brand";
import * as tokenSpacing from "toolcraft-design-rust/tokens/spacing";
import * as tokenWidths from "toolcraft-design-rust/tokens/widths";
import * as tokenTypography from "toolcraft-design-rust/tokens/typography";
import type * as originalSymbols from "toolcraft-design/components/symbols";
import type * as originalTokens from "toolcraft-design/tokens/index";
import type * as originalTokenColors from "toolcraft-design/tokens/colors";
import type * as originalTokenBrand from "toolcraft-design/tokens/brand";
import type * as originalTokenSpacing from "toolcraft-design/tokens/spacing";
import type * as originalTokenWidths from "toolcraft-design/tokens/widths";
import type * as originalTokenTypography from "toolcraft-design/tokens/typography";
const symbolsOriginal: typeof originalSymbols = symbols;
const symbolsOwn: typeof symbols = null as unknown as typeof originalSymbols;
const tokensOriginal: typeof originalTokens = tokens;
const tokensOwn: typeof tokens = null as unknown as typeof originalTokens;
const tokenColorsOriginal: typeof originalTokenColors = tokenColors;
const tokenColorsOwn: typeof tokenColors = null as unknown as typeof originalTokenColors;
const tokenBrandOriginal: typeof originalTokenBrand = tokenBrand;
const tokenBrandOwn: typeof tokenBrand = null as unknown as typeof originalTokenBrand;
const tokenSpacingOriginal: typeof originalTokenSpacing = tokenSpacing;
const tokenSpacingOwn: typeof tokenSpacing = null as unknown as typeof originalTokenSpacing;
const tokenWidthsOriginal: typeof originalTokenWidths = tokenWidths;
const tokenWidthsOwn: typeof tokenWidths = null as unknown as typeof originalTokenWidths;
const tokenTypographyOriginal: typeof originalTokenTypography = tokenTypography;
const tokenTypographyOwn: typeof tokenTypography = null as unknown as typeof originalTokenTypography;
const rootTokensOriginal: Pick<typeof originalDesign,"tokens"|"symbols"|"spacing"|"widths"> = design;
const rootTokensOwn: Pick<typeof design,"tokens"|"symbols"|"spacing"|"widths"> = null as unknown as typeof originalDesign;
void [symbolsOriginal,symbolsOwn,tokensOriginal,tokensOwn,tokenColorsOriginal,tokenColorsOwn,tokenBrandOriginal,tokenBrandOwn,tokenSpacingOriginal,tokenSpacingOwn,tokenWidthsOriginal,tokenWidthsOwn,tokenTypographyOriginal,tokenTypographyOwn,rootTokensOriginal,rootTokensOwn];

import * as detailCard from "toolcraft-design-rust/components/detail-card";
import * as inspectorCard from "toolcraft-design-rust/components/inspector-card";
import type * as originalDetailCard from "toolcraft-design/components/detail-card";
import type * as originalInspectorCard from "toolcraft-design/components/inspector-card";
const detailOriginal: typeof originalDetailCard = detailCard;
const detailOwn: typeof detailCard = null as unknown as typeof originalDetailCard;
const inspectorOriginal: typeof originalInspectorCard = inspectorCard;
const inspectorOwn: typeof inspectorCard = null as unknown as typeof originalInspectorCard;
const rootCardsOriginal: Pick<typeof originalDesign,"renderDetailCard"|"renderInspectorCard"> = design;
const rootCardsOwn: Pick<typeof design,"renderDetailCard"|"renderInspectorCard"> = null as unknown as typeof originalDesign;
void [detailOriginal,detailOwn,inspectorOriginal,inspectorOwn,rootCardsOriginal,rootCardsOwn];

import * as notices from "toolcraft-design-rust/inline-notice";
import type * as originalNotices from "toolcraft-design/inline-notice";
const noticesOriginal: typeof originalNotices = notices;
const noticesOwn: typeof notices = null as unknown as typeof originalNotices;
const rootNoticesOriginal: typeof originalNotices = design;
const rootNoticesOwn: typeof notices = null as unknown as typeof originalDesign;
void [noticesOriginal, noticesOwn, rootNoticesOriginal, rootNoticesOwn];

import * as metrics from "toolcraft-design-rust/metric";
import type * as originalMetrics from "toolcraft-design/metric";
const metricsOriginal: typeof originalMetrics = metrics;
const metricsOwn: typeof metrics = null as unknown as typeof originalMetrics;
const rootMetricsOriginal: typeof originalMetrics = design;
const rootMetricsOwn: typeof metrics = null as unknown as typeof originalDesign;
void [metricsOriginal, metricsOwn, rootMetricsOriginal, rootMetricsOwn];

import * as progress from "toolcraft-design-rust/progress-group";
import type * as originalProgress from "toolcraft-design/progress-group";
const progressOriginal: typeof originalProgress = progress;
const progressOwn: typeof progress = null as unknown as typeof originalProgress;
const rootProgressOriginal: typeof originalProgress = design;
const rootProgressOwn: typeof progress = null as unknown as typeof originalDesign;
void [progressOriginal, progressOwn, rootProgressOriginal, rootProgressOwn];

import * as eventGroups from "toolcraft-design-rust/event-groups";
import type * as originalEventGroups from "toolcraft-design/event-groups";
const eventGroupsOriginal: typeof originalEventGroups = eventGroups;
const eventGroupsOwn: typeof eventGroups = null as unknown as typeof originalEventGroups;
const rootEventGroupsOriginal: typeof originalEventGroups = design;
const rootEventGroupsOwn: typeof eventGroups = null as unknown as typeof originalDesign;
const eventRowOriginal: originalEventGroups.EventGroupRow = null as unknown as eventGroups.EventGroupRow;
const eventRowOwn: eventGroups.EventGroupRow = null as unknown as originalEventGroups.EventGroupRow;
void [eventGroupsOriginal,eventGroupsOwn,rootEventGroupsOriginal,rootEventGroupsOwn,eventRowOriginal,eventRowOwn];

import * as taskTree from "toolcraft-design-rust/task-tree";
import type * as originalTaskTree from "toolcraft-design/task-tree";
const taskTreeOriginal: typeof originalTaskTree = taskTree;
const taskTreeOwn: typeof taskTree = null as unknown as typeof originalTaskTree;
const rootTaskTreeOriginal: typeof originalTaskTree = design;
const rootTaskTreeOwn: typeof taskTree = null as unknown as typeof originalDesign;
const taskNodeOriginal: originalTaskTree.TaskNode = null as unknown as taskTree.TaskNode;
const taskNodeOwn: taskTree.TaskNode = null as unknown as originalTaskTree.TaskNode;
void [taskTreeOriginal,taskTreeOwn,rootTaskTreeOriginal,rootTaskTreeOwn,taskNodeOriginal,taskNodeOwn];

import * as renderPerformance from "toolcraft-design-rust/render-performance";
import type * as originalRenderPerformance from "toolcraft-design/render-performance";
const renderPerformanceOriginal: typeof originalRenderPerformance = renderPerformance;
const renderPerformanceOwn: typeof renderPerformance = null as unknown as typeof originalRenderPerformance;
const rootRenderPerformanceOriginal: typeof originalRenderPerformance = design;
const rootRenderPerformanceOwn: typeof renderPerformance = null as unknown as typeof originalDesign;
const performanceSnapshotOriginal: originalRenderPerformance.RenderPerformanceSnapshot = null as unknown as renderPerformance.RenderPerformanceSnapshot;
const performanceSnapshotOwn: renderPerformance.RenderPerformanceSnapshot = null as unknown as originalRenderPerformance.RenderPerformanceSnapshot;
void [renderPerformanceOriginal,renderPerformanceOwn,rootRenderPerformanceOriginal,rootRenderPerformanceOwn,performanceSnapshotOriginal,performanceSnapshotOwn];

import * as staticRender from "toolcraft-design-rust/static/index";
import type * as originalStaticRender from "toolcraft-design/static/index";
const staticRenderOriginal: typeof originalStaticRender = staticRender;
const staticRenderOwn: typeof staticRender = null as unknown as typeof originalStaticRender;
void [staticRenderOriginal,staticRenderOwn];

import * as staticSpinner from "toolcraft-design-rust/static/spinner";
import type * as originalStaticSpinner from "toolcraft-design/static/spinner";
const staticSpinnerOriginal: typeof originalStaticSpinner = staticSpinner;
const staticSpinnerOwn: typeof staticSpinner = null as unknown as typeof originalStaticSpinner;
void [staticSpinnerOriginal,staticSpinnerOwn];

import * as staticMenu from "toolcraft-design-rust/static/menu";
import type * as originalStaticMenu from "toolcraft-design/static/menu";
const staticMenuOriginal: typeof originalStaticMenu = staticMenu;
const staticMenuOwn: typeof staticMenu = null as unknown as typeof originalStaticMenu;
void [staticMenuOriginal,staticMenuOwn];

import * as spinnerFrames from "toolcraft-design-rust/spinner-frames";
import type * as originalSpinnerFrames from "toolcraft-design/spinner-frames";
const spinnerFramesOriginal: typeof originalSpinnerFrames = spinnerFrames;
const spinnerFramesOwn: typeof spinnerFrames = null as unknown as typeof originalSpinnerFrames;
void [spinnerFramesOriginal,spinnerFramesOwn];

import * as spinnerFrame from "toolcraft-design-rust/render-spinner-frame";
import type * as originalSpinnerFrame from "toolcraft-design/render-spinner-frame";
const spinnerFrameOriginal: typeof originalSpinnerFrame = spinnerFrame;
const spinnerFrameOwn: typeof spinnerFrame = null as unknown as typeof originalSpinnerFrame;
void [spinnerFrameOriginal,spinnerFrameOwn];

import * as spinnerStopped from "toolcraft-design-rust/render-spinner-stopped";
import type * as originalSpinnerStopped from "toolcraft-design/render-spinner-stopped";
const spinnerStoppedOriginal: typeof originalSpinnerStopped = spinnerStopped;
const spinnerStoppedOwn: typeof spinnerStopped = null as unknown as typeof originalSpinnerStopped;
void [spinnerStoppedOriginal,spinnerStoppedOwn];

import * as menu from "toolcraft-design-rust/render-menu";
import type * as originalMenu from "toolcraft-design/render-menu";
const menuOriginal: typeof originalMenu = menu;
const menuOwn: typeof menu = null as unknown as typeof originalMenu;
void [menuOriginal,menuOwn];

const rootStaticOriginal: typeof originalStaticRender = design;
const rootStaticOwn: typeof staticRender = null as unknown as typeof originalDesign;
const staticNamespaceOriginal: typeof originalStaticRender = design.staticRender;
const staticNamespaceOwn: typeof staticRender = null as unknown as typeof originalDesign.staticRender;
void [rootStaticOriginal,rootStaticOwn,staticNamespaceOriginal,staticNamespaceOwn];

import * as escapeTerminal from "toolcraft-design-rust/escape-terminal-text";
import type * as originalEscapeTerminal from "toolcraft-design/escape-terminal-text";
const escapeTerminalOriginal: typeof originalEscapeTerminal = escapeTerminal;
const escapeTerminalOwn: typeof escapeTerminal = null as unknown as typeof originalEscapeTerminal;
void [escapeTerminalOriginal,escapeTerminalOwn];

const plaintextOriginal: typeof originalDesign.renderPlaintext = design.renderPlaintext;
const plaintextOwn: typeof design.renderPlaintext = null as unknown as typeof originalDesign.renderPlaintext;
const markdownNodeOriginal: originalDesign.MdNode = null as unknown as design.MdNode;
const markdownNodeOwn: design.MdNode = null as unknown as originalDesign.MdNode;
const plaintextOptionsOriginal: originalDesign.PlaintextRenderOptions = null as unknown as design.PlaintextRenderOptions;
const plaintextOptionsOwn: design.PlaintextRenderOptions = null as unknown as originalDesign.PlaintextRenderOptions;
void [plaintextOriginal,plaintextOwn,markdownNodeOriginal,markdownNodeOwn,plaintextOptionsOriginal,plaintextOptionsOwn];

const htmlOriginal: typeof originalDesign.renderHtml = design.renderHtml;
const htmlOwn: typeof design.renderHtml = null as unknown as typeof originalDesign.renderHtml;
const htmlOptionsOriginal: originalDesign.HtmlRenderOptions = null as unknown as design.HtmlRenderOptions;
const htmlOptionsOwn: design.HtmlRenderOptions = null as unknown as originalDesign.HtmlRenderOptions;
void [htmlOriginal,htmlOwn,htmlOptionsOriginal,htmlOptionsOwn];

const renderOriginal: typeof originalDesign.render = design.render;
const renderOwn: typeof design.render = null as unknown as typeof originalDesign.render;
const renderOptionsOriginal: originalDesign.RenderOptions = null as unknown as design.RenderOptions;
const renderOptionsOwn: design.RenderOptions = null as unknown as originalDesign.RenderOptions;
void [renderOriginal,renderOwn,renderOptionsOriginal,renderOptionsOwn];
