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

// Both assignment directions and namespace keys must match public Markdown subpaths.
type SameKeys<A,B> = [Exclude<keyof A,keyof B>,Exclude<keyof B,keyof A>] extends [never,never] ? true : false;
import * as markdown0 from "toolcraft-design-rust/terminal-markdown/index";
import type * as originalMarkdown0 from "toolcraft-design/terminal-markdown/index";
const markdownOriginal0: typeof originalMarkdown0 = markdown0;
const markdownOwn0: typeof markdown0 = null as unknown as typeof originalMarkdown0;
const markdownKeys0: SameKeys<typeof markdown0,typeof originalMarkdown0> = true;
void [markdownOriginal0,markdownOwn0,markdownKeys0];
import * as markdown1 from "toolcraft-design-rust/terminal-markdown/ast";
import type * as originalMarkdown1 from "toolcraft-design/terminal-markdown/ast";
const markdownOriginal1: typeof originalMarkdown1 = markdown1;
const markdownOwn1: typeof markdown1 = null as unknown as typeof originalMarkdown1;
const markdownKeys1: SameKeys<typeof markdown1,typeof originalMarkdown1> = true;
void [markdownOriginal1,markdownOwn1,markdownKeys1];
import * as markdown2 from "toolcraft-design-rust/terminal-markdown/parser";
import type * as originalMarkdown2 from "toolcraft-design/terminal-markdown/parser";
const markdownOriginal2: typeof originalMarkdown2 = markdown2;
const markdownOwn2: typeof markdown2 = null as unknown as typeof originalMarkdown2;
const markdownKeys2: SameKeys<typeof markdown2,typeof originalMarkdown2> = true;
void [markdownOriginal2,markdownOwn2,markdownKeys2];
import * as markdown3 from "toolcraft-design-rust/terminal-markdown/parser/block";
import type * as originalMarkdown3 from "toolcraft-design/terminal-markdown/parser/block";
const markdownOriginal3: typeof originalMarkdown3 = markdown3;
const markdownOwn3: typeof markdown3 = null as unknown as typeof originalMarkdown3;
const markdownKeys3: SameKeys<typeof markdown3,typeof originalMarkdown3> = true;
void [markdownOriginal3,markdownOwn3,markdownKeys3];
import * as markdown4 from "toolcraft-design-rust/terminal-markdown/parser/inline";
import type * as originalMarkdown4 from "toolcraft-design/terminal-markdown/parser/inline";
const markdownOriginal4: typeof originalMarkdown4 = markdown4;
const markdownOwn4: typeof markdown4 = null as unknown as typeof originalMarkdown4;
const markdownKeys4: SameKeys<typeof markdown4,typeof originalMarkdown4> = true;
void [markdownOriginal4,markdownOwn4,markdownKeys4];
import * as markdown5 from "toolcraft-design-rust/terminal-markdown/parser/frontmatter";
import type * as originalMarkdown5 from "toolcraft-design/terminal-markdown/parser/frontmatter";
const markdownOriginal5: typeof originalMarkdown5 = markdown5;
const markdownOwn5: typeof markdown5 = null as unknown as typeof originalMarkdown5;
const markdownKeys5: SameKeys<typeof markdown5,typeof originalMarkdown5> = true;
void [markdownOriginal5,markdownOwn5,markdownKeys5];
import * as markdown6 from "toolcraft-design-rust/terminal-markdown/parser/code-highlight";
import type * as originalMarkdown6 from "toolcraft-design/terminal-markdown/parser/code-highlight";
const markdownOriginal6: typeof originalMarkdown6 = markdown6;
const markdownOwn6: typeof markdown6 = null as unknown as typeof originalMarkdown6;
const markdownKeys6: SameKeys<typeof markdown6,typeof originalMarkdown6> = true;
void [markdownOriginal6,markdownOwn6,markdownKeys6];
import * as markdown7 from "toolcraft-design-rust/terminal-markdown/renderer";
import type * as originalMarkdown7 from "toolcraft-design/terminal-markdown/renderer";
const markdownOriginal7: typeof originalMarkdown7 = markdown7;
const markdownOwn7: typeof markdown7 = null as unknown as typeof originalMarkdown7;
const markdownKeys7: SameKeys<typeof markdown7,typeof originalMarkdown7> = true;
void [markdownOriginal7,markdownOwn7,markdownKeys7];
import * as markdown8 from "toolcraft-design-rust/terminal-markdown/html-renderer";
import type * as originalMarkdown8 from "toolcraft-design/terminal-markdown/html-renderer";
const markdownOriginal8: typeof originalMarkdown8 = markdown8;
const markdownOwn8: typeof markdown8 = null as unknown as typeof originalMarkdown8;
const markdownKeys8: SameKeys<typeof markdown8,typeof originalMarkdown8> = true;
void [markdownOriginal8,markdownOwn8,markdownKeys8];
import * as markdown9 from "toolcraft-design-rust/terminal-markdown/plaintext-renderer";
import type * as originalMarkdown9 from "toolcraft-design/terminal-markdown/plaintext-renderer";
const markdownOriginal9: typeof originalMarkdown9 = markdown9;
const markdownOwn9: typeof markdown9 = null as unknown as typeof originalMarkdown9;
const markdownKeys9: SameKeys<typeof markdown9,typeof originalMarkdown9> = true;
void [markdownOriginal9,markdownOwn9,markdownKeys9];
import * as markdown10 from "toolcraft-design-rust/render-markdown-plaintext";
import type * as originalMarkdown10 from "toolcraft-design/render-markdown-plaintext";
const markdownOriginal10: typeof originalMarkdown10 = markdown10;
const markdownOwn10: typeof markdown10 = null as unknown as typeof originalMarkdown10;
const markdownKeys10: SameKeys<typeof markdown10,typeof originalMarkdown10> = true;
void [markdownOriginal10,markdownOwn10,markdownKeys10];
type MarkdownRoot = Pick<typeof originalDesign,"parse"|"renderMarkdown"|"renderMarkdownHtml"|"renderMarkdownPlaintext">;
const markdownRootOriginal: MarkdownRoot = design;
const markdownRootOwn: Pick<typeof design,keyof MarkdownRoot> = null as unknown as MarkdownRoot;
void [markdownRootOriginal,markdownRootOwn];

import * as markdownDemo from "toolcraft-design-rust/terminal-markdown/demo-content";
import type * as originalMarkdownDemo from "toolcraft-design/terminal-markdown/demo-content";
const markdownDemoOriginal:typeof originalMarkdownDemo=markdownDemo;
const markdownDemoOwn:typeof markdownDemo=null as unknown as typeof originalMarkdownDemo;
const markdownDemoKeys:SameKeys<typeof markdownDemo,typeof originalMarkdownDemo>=true;
void [markdownDemoOriginal,markdownDemoOwn,markdownDemoKeys];

import * as screenStyle from "toolcraft-design-rust/screen/style";
import type * as originalScreenStyle from "toolcraft-design/screen/style";
const screenStyleOriginal:typeof originalScreenStyle=screenStyle;
const screenStyleOwn:typeof screenStyle=null as unknown as typeof originalScreenStyle;
const screenStyleKeys:SameKeys<typeof screenStyle,typeof originalScreenStyle>=true;
type RootScreenStyle=Pick<typeof originalDesign,"packStyle"|"styleToSgrDelta">;
const rootScreenStyleOriginal:RootScreenStyle=design;
const rootScreenStyleOwn:Pick<typeof design,keyof RootScreenStyle>=null as unknown as RootScreenStyle;
void [screenStyleOriginal,screenStyleOwn,screenStyleKeys,rootScreenStyleOriginal,rootScreenStyleOwn];
const packedStyleOriginal:originalDesign.PackedStyle=null as unknown as design.PackedStyle;
const packedStyleOwn:design.PackedStyle=null as unknown as originalDesign.PackedStyle;
void [packedStyleOriginal,packedStyleOwn];

import {Screen, type ScreenCell, type ScreenSize, type ScreenSurface} from "toolcraft-design-rust";
import * as screenSubpath from "toolcraft-design-rust/screen/screen";
import type * as originalScreen from "toolcraft-design/screen/screen";
type ScreenPublic<T> = Pick<T, keyof T>;
const publicScreen: ScreenPublic<originalScreen.Screen> = new Screen();
const reverseScreen: ScreenPublic<Screen> = null as unknown as originalScreen.Screen;
const screenConstructor: typeof Screen = screenSubpath.Screen;
const screenArgs: ConstructorParameters<typeof originalScreen.Screen> = [{cols:10,rows:2},{colors:false}];
const nativeScreenArgs: ConstructorParameters<typeof Screen> = screenArgs;
const screenSize: ScreenSize = {cols:10,rows:2};
const screenCell: ScreenCell = {ch:"x",width:1,style:0,fg:0,bg:0};
const screenSurface: ScreenSurface = new Screen(screenSize);
const originalScreenSurface: originalScreen.ScreenSurface = screenSurface;
screenSurface.put(0,0,"ready",{fg:"red",bold:true});
void [publicScreen,reverseScreen,screenConstructor,nativeScreenArgs,screenCell,originalScreenSurface];

import * as ansiCells from "toolcraft-design-rust/screen/ansi-text";
import type * as originalAnsiCells from "toolcraft-design/screen/ansi-text";
const ansiCellsForward:typeof originalAnsiCells=ansiCells;
const ansiCellsReverse:typeof ansiCells=null as unknown as typeof originalAnsiCells;
void [ansiCellsForward,ansiCellsReverse];

import * as frameOutput from "toolcraft-design-rust/terminal/output";
import type * as originalFrameOutput from "toolcraft-design/terminal/output";
const frameOutputForward:typeof originalFrameOutput=frameOutput;
const frameOutputReverse:typeof frameOutput=null as unknown as typeof originalFrameOutput;
void [frameOutputForward,frameOutputReverse];

import * as terminalInput from "toolcraft-design-rust/terminal/input";
import type * as originalTerminalInput from "toolcraft-design/terminal/input";
const terminalInputForward:typeof originalTerminalInput=terminalInput;
const terminalInputReverse:typeof terminalInput=null as unknown as typeof originalTerminalInput;
void [terminalInputForward,terminalInputReverse];

import * as terminalDriver from "toolcraft-design-rust/terminal/driver";
import type * as originalTerminalDriver from "toolcraft-design/terminal/driver";
const terminalDriverForward:typeof originalTerminalDriver=terminalDriver;
const terminalDriverReverse:typeof terminalDriver=null as unknown as typeof originalTerminalDriver;
const driverFromRoot:typeof terminalDriver.createTerminalDriver=design.createTerminalDriver;
const driverSize:design.TerminalSize={cols:80,rows:24};
const driverEvent:design.TerminalInputEvent={type:"paste",text:"text"};
const driverPublic:design.TerminalDriver=terminalDriver.createTerminalDriver();
void [terminalDriverForward,terminalDriverReverse,driverFromRoot,driverSize,driverEvent,driverPublic];

import * as noteModule from "toolcraft-design-rust/note";
import type * as originalNote from "toolcraft-design/note";
import * as notePrimitive from "toolcraft-design-rust/prompts/primitives/note";
const noteForward:typeof originalNote=noteModule;
const noteReverse:typeof noteModule=null as unknown as typeof originalNote;
const noteRoot:typeof notePrimitive.note=design.note;
void [noteForward,noteReverse,noteRoot];

import * as browserModule from "toolcraft-design-rust/components/browser";
import type * as originalBrowser from "toolcraft-design/components/browser";
import {openExternal as openExternalSubpath} from "toolcraft-design-rust/open-external";
const browserForward:typeof originalBrowser=browserModule;
const browserReverse:typeof browserModule=null as unknown as typeof originalBrowser;
const browserRoot:typeof browserModule.openExternal=design.openExternal;
const browserSubpath:typeof browserRoot=openExternalSubpath;
void [browserForward,browserReverse,browserRoot,browserSubpath];

import * as promptLog from "toolcraft-design-rust/prompts/primitives/log";
import type * as originalPromptLog from "toolcraft-design/prompts/primitives/log";
const promptLogForward:typeof originalPromptLog=promptLog;
const promptLogReverse:typeof promptLog=null as unknown as typeof originalPromptLog;
const introForward:typeof import("toolcraft-design/intro").intro=design.intro;
const introReverse:typeof design.intro=null as unknown as typeof import("toolcraft-design/intro").intro;
const plainForward:typeof import("toolcraft-design/intro-plain").introPlain=design.introPlain;
const outroForward:typeof import("toolcraft-design/outro").outro=design.outro;
const cancelForward:typeof import("toolcraft-design/cancel").cancel=design.cancel;
import {CANCEL,isCancel} from "toolcraft-design-rust/prompts/interactive/cancel-symbol";
const cancellation:unknown=CANCEL;
if(isCancel(cancellation)){const symbol:typeof CANCEL=cancellation;void symbol;}
void [promptLogForward,promptLogReverse,introForward,introReverse,plainForward,outroForward,cancelForward];

import * as liveSpinner from "toolcraft-design-rust/spinner";
import type * as originalLiveSpinner from "toolcraft-design/spinner";
const liveSpinnerForward:typeof originalLiveSpinner=liveSpinner;
const liveSpinnerReverse:typeof liveSpinner=null as unknown as typeof originalLiveSpinner;
const liveSpinnerOptions:design.SpinnerOptions=liveSpinner.spinner();
void [liveSpinnerForward,liveSpinnerReverse,liveSpinnerOptions];

const withSpinnerOriginal: typeof originalDesign.withSpinner = design.withSpinner;
const withSpinnerNative: typeof design.withSpinner = null as unknown as typeof originalDesign.withSpinner;
const spinnerResult: Promise<{answer: number}> = design.withSpinner({message: () => "Working", fn: async () => ({answer: 42}), stopMessage: result => String(result.answer), subtext: result => String(result.answer)});
void [withSpinnerOriginal, withSpinnerNative, spinnerResult];

import {promptTheme as directPromptTheme} from "toolcraft-design-rust/prompts/theme";
const promptThemeOriginal: typeof originalDesign.promptTheme = design.promptTheme;
const promptThemeNative: typeof design.promptTheme = null as unknown as typeof originalDesign.promptTheme;
void [promptThemeOriginal, promptThemeNative, directPromptTheme];

import * as promptGlyphs from "toolcraft-design-rust/prompts/interactive/glyphs";
import type * as originalPromptGlyphs from "toolcraft-design/prompts/interactive/glyphs";
import * as promptConfirm from "toolcraft-design-rust/prompts/interactive/confirm";
import type * as originalPromptConfirm from "toolcraft-design/prompts/interactive/confirm";
const glyphsOriginal: typeof originalPromptGlyphs = promptGlyphs;
const glyphsNative: typeof promptGlyphs = null as unknown as typeof originalPromptGlyphs;
const confirmOptionsOriginal: originalPromptConfirm.ConfirmOptions = null as unknown as promptConfirm.ConfirmOptions;
const confirmOptionsNative: promptConfirm.ConfirmOptions = confirmOptionsOriginal;
const confirmResult: Promise<boolean | typeof CANCEL> = promptConfirm.confirmPrompt(confirmOptionsNative);
// Runtime cancellation is shared through Symbol.for, but separate declarations
// retain distinct unique-symbol identities. Unifying these remains a swap gate.
// @ts-expect-error Separate cancellation declarations are nominally distinct.
const confirmOriginal: typeof originalPromptConfirm = promptConfirm;
// @ts-expect-error Separate cancellation declarations are nominally distinct.
const confirmNative: typeof promptConfirm = null as unknown as typeof originalPromptConfirm;
void [glyphsOriginal, glyphsNative, confirmOriginal, confirmNative, confirmResult];

import * as promptText from "toolcraft-design-rust/prompts/interactive/text";
import type * as originalPromptText from "toolcraft-design/prompts/interactive/text";
import * as promptPassword from "toolcraft-design-rust/prompts/interactive/password";
import type * as originalPromptPassword from "toolcraft-design/prompts/interactive/password";
const textOptionsOriginal: originalPromptText.TextOptions = null as unknown as promptText.TextOptions;
const textOptionsNative: promptText.TextOptions = textOptionsOriginal;
const passwordOptionsOriginal: originalPromptPassword.PasswordOptions = null as unknown as promptPassword.PasswordOptions;
const passwordOptionsNative: promptPassword.PasswordOptions = passwordOptionsOriginal;
const textResult: Promise<string | typeof CANCEL> = promptText.textPrompt(textOptionsNative);
const passwordResult: Promise<string | typeof CANCEL> = promptPassword.passwordPrompt(passwordOptionsNative);
// @ts-expect-error Separate cancellation declarations remain a nominal swap gate.
const textPromptOriginal: typeof originalPromptText = promptText;
// @ts-expect-error Separate cancellation declarations remain a nominal swap gate.
const passwordPromptOriginal: typeof originalPromptPassword = promptPassword;
void [textResult, passwordResult, textPromptOriginal, passwordPromptOriginal];

import * as promptPagination from "toolcraft-design-rust/prompts/interactive/pagination";
import type * as originalPromptPagination from "toolcraft-design/prompts/interactive/pagination";
const paginationOriginal: typeof originalPromptPagination = promptPagination;
const paginationNative: typeof promptPagination = null as unknown as typeof originalPromptPagination;
void [paginationOriginal, paginationNative];

import * as promptSelect from "toolcraft-design-rust/prompts/interactive/select";
import type * as originalPromptSelect from "toolcraft-design/prompts/interactive/select";
const findOriginal: typeof originalPromptSelect.findNonDisabled = promptSelect.findNonDisabled;
const findNative: typeof promptSelect.findNonDisabled = null as unknown as typeof originalPromptSelect.findNonDisabled;
const selectOptionsOriginal: originalPromptSelect.SelectOptions<{key: string}> = null as unknown as promptSelect.SelectOptions<{key: string}>;
const selectOptionsNative: promptSelect.SelectOptions<{key: string}> = selectOptionsOriginal;
const selectResult: Promise<{key: string} | typeof CANCEL> = promptSelect.selectPrompt(selectOptionsNative);
// @ts-expect-error Separate cancellation declarations remain a nominal swap gate.
const selectPromptOriginal: typeof originalPromptSelect.selectPrompt = promptSelect.selectPrompt;
void [findOriginal, findNative, selectResult, selectPromptOriginal];

import * as promptMultiselect from "toolcraft-design-rust/prompts/interactive/multiselect";
import type * as originalPromptMultiselect from "toolcraft-design/prompts/interactive/multiselect";
const multiselectOptionsOriginal: originalPromptMultiselect.MultiselectOptions<{key: string}> = null as unknown as promptMultiselect.MultiselectOptions<{key: string}>;
const multiselectOptionsNative: promptMultiselect.MultiselectOptions<{key: string}> = multiselectOptionsOriginal;
const multiselectResult: Promise<{key: string}[] | typeof CANCEL> = promptMultiselect.multiselectPrompt(multiselectOptionsNative);
// @ts-expect-error Separate cancellation declarations remain a nominal swap gate.
const multiselectPromptOriginal: typeof originalPromptMultiselect.multiselectPrompt = promptMultiselect.multiselectPrompt;
void [multiselectResult, multiselectPromptOriginal];

import * as publicPrompts from "toolcraft-design-rust/prompts/index";
import type * as originalPublicPrompts from "toolcraft-design/prompts/index";
import {confirm as directConfirm} from "toolcraft-design-rust/confirm";
import {confirmOrCancel as directConfirmOrCancel} from "toolcraft-design-rust/confirm-or-cancel";
import {select as directSelect} from "toolcraft-design-rust/select";
import {multiselect as directMultiselect} from "toolcraft-design-rust/multiselect";
import {promptText as directPromptText} from "toolcraft-design-rust/prompt-text";
import {password as directPassword} from "toolcraft-design-rust/password";
const publicNamespaceOriginal: Record<keyof typeof originalPublicPrompts, unknown> = publicPrompts;
const publicNamespaceNative: Record<keyof typeof publicPrompts, unknown> = null as unknown as typeof originalPublicPrompts;
const promptErrorOriginal: typeof originalPublicPrompts.PromptCancelledError = design.PromptCancelledError;
const promptErrorNative: typeof design.PromptCancelledError = null as unknown as typeof originalPublicPrompts.PromptCancelledError;
const confirmOrCancelOriginal: typeof originalPublicPrompts.confirmOrCancel = design.confirmOrCancel;
const confirmOrCancelNative: typeof design.confirmOrCancel = null as unknown as typeof originalPublicPrompts.confirmOrCancel;
const publicTextOptionsOriginal: originalPublicPrompts.TextOptions = null as unknown as design.TextOptions;
const publicTextOptionsNative: design.TextOptions = publicTextOptionsOriginal;
const publicPasswordOptionsOriginal: originalPublicPrompts.PasswordOptions = null as unknown as design.PasswordOptions;
const publicPasswordOptionsNative: design.PasswordOptions = publicPasswordOptionsOriginal;
const publicConfirmOptionsOriginal: originalPublicPrompts.ConfirmOptions = null as unknown as design.ConfirmOptions;
const publicConfirmOptionsNative: design.ConfirmOptions = publicConfirmOptionsOriginal;
const publicSelect: typeof publicPrompts.select = design.select;
const publicMultiselect: typeof publicPrompts.multiselect = design.multiselect;
const publicText: typeof publicPrompts.text = design.promptText;
const publicPassword: typeof publicPrompts.password = design.password;
const publicConfirm: typeof publicPrompts.confirm = design.confirm;
const publicNamespace: typeof publicPrompts = design.prompts;
const selectedObject: Promise<{key: string} | typeof CANCEL> = directSelect({message: "Pick", options: [{label: "One", value: {key: "one"}}]});
const selectedObjects: Promise<{key: string}[] | typeof CANCEL> = directMultiselect({message: "Pick", options: [{label: "One", value: {key: "one"}}]});
const textInput: Promise<string | typeof CANCEL> = directPromptText(publicTextOptionsNative);
const passwordInput: Promise<string | typeof CANCEL> = directPassword(publicPasswordOptionsNative);
const confirmationInput: Promise<boolean | typeof CANCEL> = directConfirm(publicConfirmOptionsNative);
const confirmation: Promise<boolean> = directConfirmOrCancel(publicConfirmOptionsNative);
// @ts-expect-error Public password options omit the internal mask option.
directPassword({message: "Secret", mask: "*"});
void [publicNamespaceOriginal, publicNamespaceNative, promptErrorOriginal, promptErrorNative, confirmOrCancelOriginal, confirmOrCancelNative, publicSelect, publicMultiselect, publicText, publicPassword, publicConfirm, publicNamespace, selectedObject, selectedObjects, textInput, passwordInput, confirmationInput, confirmation];

import {Prompt as NativePrompt,type PromptOptions as NativePromptOptions,type PromptState as NativePromptState} from "toolcraft-design-rust/prompts/interactive/core";
import type {PromptState as OriginalPromptState} from "toolcraft-design/prompts/interactive/core";
import * as nativePromptKeys from "toolcraft-design-rust/prompts/interactive/keys";
import type * as originalPromptKeys from "toolcraft-design/prompts/interactive/keys";
import * as nativePromptWrap from "toolcraft-design-rust/prompts/interactive/wrap";
import type * as originalPromptWrap from "toolcraft-design/prompts/interactive/wrap";
const keySdk: typeof originalPromptKeys = nativePromptKeys;
const keyNative: typeof nativePromptKeys = null as unknown as typeof originalPromptKeys;
const wrapSdk: typeof originalPromptWrap = nativePromptWrap;
const wrapNative: typeof nativePromptWrap = null as unknown as typeof originalPromptWrap;
const promptStateOriginal: OriginalPromptState<string> = null as unknown as NativePromptState<string>;
const promptStateNative: NativePromptState<string> = promptStateOriginal;
class PromptClient extends NativePrompt<string> {
  protected override promptNonTty() { return this.readNonTtyLine(); }
  replace(value: string) { this.setValue(value); this.setUserInput(value); this.setError(""); this.render(); }
  finish() { this.clearUserInput(); this.close(); }
}
const promptOptions: NativePromptOptions<string> = {input:process.stdin,output:process.stdout,initialValue:"",render:p=>p.userInput,validate:value=>value?undefined:"Required"};
const promptClient = new PromptClient(promptOptions);
promptClient.once("submit", (value: string) => { void value; });
void [keySdk,keyNative,wrapSdk,wrapNative,promptStateNative,promptClient];

import * as dashboardKeymap from "toolcraft-design-rust/dashboard/keymap";
import type * as originalDashboardKeymap from "toolcraft-design/dashboard/keymap";
const keymapOriginal: typeof originalDashboardKeymap = dashboardKeymap;
const keymapNative: typeof dashboardKeymap = null as unknown as typeof originalDashboardKeymap;
const genericKeymap = dashboardKeymap.createKeymap(undefined, {
  commands: ["go", "stop"] as const,
  defaultBindings: {go: ["gg"], stop: ["q"]}
});
const genericCommand: "go" | "stop" | undefined = genericKeymap({ch: "g", ctrl: false, meta: false, shift: false});
void [keymapOriginal, keymapNative, genericCommand];

import * as dashboardMode from "toolcraft-design-rust/should-use-interactive-dashboard";
import type * as originalDashboardMode from "toolcraft-design/should-use-interactive-dashboard";
const dashboardModeOriginal: typeof originalDashboardMode = dashboardMode;
const dashboardModeNative: typeof dashboardMode = null as unknown as typeof originalDashboardMode;
const ttyMode: boolean = dashboardMode.shouldUseInteractiveDashboard(true, {stdin: {}, stdout: {isTTY: true}});
void [dashboardModeOriginal, dashboardModeNative, ttyMode];

import * as dashboardStore from "toolcraft-design-rust/dashboard/store";
import type * as originalDashboardStore from "toolcraft-design/dashboard/store";
import type * as dashboardTypes from "toolcraft-design-rust/dashboard/types";
import type * as originalDashboardTypes from "toolcraft-design/dashboard/types";
const storeOriginal: typeof originalDashboardStore = dashboardStore;
const storeNative: typeof dashboardStore = null as unknown as typeof originalDashboardStore;
const stateOriginal: originalDashboardTypes.DashboardState = dashboardStore.createStore().getState();
const stateNative: dashboardTypes.DashboardState = stateOriginal;
void [storeOriginal,storeNative,stateNative];

import * as composerLayout from "toolcraft-design-rust/dashboard/composer-layout";
import type * as originalComposerLayout from "toolcraft-design/dashboard/composer-layout";
const layoutOriginal: typeof originalComposerLayout = composerLayout;
const layoutNative: typeof composerLayout = null as unknown as typeof originalComposerLayout;
void [layoutOriginal,layoutNative];

import * as dashboardElapsed from "toolcraft-design-rust/dashboard/elapsed";
import type * as originalDashboardElapsed from "toolcraft-design/dashboard/elapsed";
const elapsedOriginal: typeof originalDashboardElapsed = dashboardElapsed;
const elapsedNative: typeof dashboardElapsed = null as unknown as typeof originalDashboardElapsed;
void [elapsedOriginal,elapsedNative];

import * as dashboardAnsi from "toolcraft-design-rust/dashboard/ansi";
import type * as originalDashboardAnsi from "toolcraft-design/dashboard/ansi";
const ansiOriginal: typeof originalDashboardAnsi = dashboardAnsi;
const ansiNative: typeof dashboardAnsi = null as unknown as typeof originalDashboardAnsi;
void [ansiOriginal,ansiNative];

import * as composer from "toolcraft-design-rust/dashboard/composer";
import type * as originalComposer from "toolcraft-design/dashboard/composer";
const composerOriginal: typeof originalComposer = composer;
const composerNative: typeof composer = null as unknown as typeof originalComposer;
const edited = composer.editComposer(composer.createComposerState("message", "plan"), {name: "return", ctrl: false, meta: false, shift: false});
const submission: originalComposer.DashboardSubmission | undefined = edited.submit;
void [composerOriginal,composerNative,submission];

import * as dashboardBuffer from "toolcraft-design-rust/dashboard/buffer";
import type * as originalDashboardBuffer from "toolcraft-design/dashboard/buffer";
type BufferPublic<T> = {[K in keyof T]: T[K]};
const bufferOriginal: BufferPublic<originalDashboardBuffer.ScreenBuffer> = new dashboardBuffer.ScreenBuffer(2, 1);
const bufferNative: BufferPublic<dashboardBuffer.ScreenBuffer> = null as unknown as originalDashboardBuffer.ScreenBuffer;
const bufferKeys: SameKeys<typeof dashboardBuffer, typeof originalDashboardBuffer> = true;
const bufferAnsiOriginal: typeof originalDashboardBuffer.cellToAnsi = dashboardBuffer.cellToAnsi;
const bufferAnsiNative: typeof dashboardBuffer.cellToAnsi = null as unknown as typeof originalDashboardBuffer.cellToAnsi;
const bufferChangesOriginal: ReturnType<typeof originalDashboardBuffer.diff> = dashboardBuffer.diff(new dashboardBuffer.ScreenBuffer(0, 0), new dashboardBuffer.ScreenBuffer(1, 1));
const bufferChangesNative: ReturnType<typeof dashboardBuffer.diff> = null as unknown as ReturnType<typeof originalDashboardBuffer.diff>;
// @ts-expect-error Separate private declarations remain a nominal replacement gate.
const bufferNominalOriginal: originalDashboardBuffer.ScreenBuffer = new dashboardBuffer.ScreenBuffer(0, 0);
// @ts-expect-error Separate private declarations remain a nominal replacement gate.
const bufferNominalNative: dashboardBuffer.ScreenBuffer = null as unknown as originalDashboardBuffer.ScreenBuffer;
void [bufferOriginal,bufferNative,bufferKeys,bufferAnsiOriginal,bufferAnsiNative,bufferChangesOriginal,bufferChangesNative,bufferNominalOriginal,bufferNominalNative];

import * as dashboardTerminal from "toolcraft-design-rust/dashboard/terminal";
import type * as originalDashboardTerminal from "toolcraft-design/dashboard/terminal";
const dashboardTerminalOriginal: typeof originalDashboardTerminal = dashboardTerminal;
const dashboardTerminalNative: typeof dashboardTerminal = null as unknown as typeof originalDashboardTerminal;
const dashboardTerminalKeys: SameKeys<typeof dashboardTerminal, typeof originalDashboardTerminal> = true;
void [dashboardTerminalOriginal,dashboardTerminalNative,dashboardTerminalKeys];

import * as dashboardBorder from "toolcraft-design-rust/dashboard/components/border";
import type * as originalDashboardBorder from "toolcraft-design/dashboard/components/border";
import * as dashboardLayout from "toolcraft-design-rust/dashboard/layout";
import type * as originalDashboardLayout from "toolcraft-design/dashboard/layout";
const borderOptionsOriginal: originalDashboardBorder.BorderOptions = null as unknown as dashboardBorder.BorderOptions;
const borderOptionsNative: dashboardBorder.BorderOptions = null as unknown as originalDashboardBorder.BorderOptions;
const borderKeys: SameKeys<typeof dashboardBorder,typeof originalDashboardBorder> = true;
type NativeBorderPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,layout: Parameters<typeof dashboardBorder.renderBorder>[1],opts: dashboardBorder.BorderOptions) => ReturnType<typeof dashboardBorder.renderBorder>;
type OriginalBorderPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,layout: Parameters<typeof originalDashboardBorder.renderBorder>[1],opts: originalDashboardBorder.BorderOptions) => ReturnType<typeof originalDashboardBorder.renderBorder>;
const borderPublicOriginal: OriginalBorderPublic = null as unknown as NativeBorderPublic;
const borderPublicNative: NativeBorderPublic = null as unknown as OriginalBorderPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const borderNominalOriginal: typeof originalDashboardBorder.renderBorder = dashboardBorder.renderBorder;
const layoutSubpathOriginal: typeof originalDashboardLayout = dashboardLayout;
const layoutSubpathNative: typeof dashboardLayout = null as unknown as typeof originalDashboardLayout;
void [borderOptionsOriginal,borderOptionsNative,borderKeys,borderPublicOriginal,borderPublicNative,borderNominalOriginal,layoutSubpathOriginal,layoutSubpathNative];

import * as dashboardFooter from "toolcraft-design-rust/dashboard/components/footer";
import type * as originalDashboardFooter from "toolcraft-design/dashboard/components/footer";
const footerDefaultsOriginal: typeof originalDashboardFooter.defaultHints = dashboardFooter.defaultHints;
const footerDefaultsNative: typeof dashboardFooter.defaultHints = null as unknown as typeof originalDashboardFooter.defaultHints;
const footerKeys: SameKeys<typeof dashboardFooter,typeof originalDashboardFooter> = true;
type NativeFooterPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,rect: Parameters<typeof dashboardFooter.renderFooter>[1],hints: dashboardFooter.FooterHint[],session?: Parameters<typeof dashboardFooter.renderFooter>[3]) => ReturnType<typeof dashboardFooter.renderFooter>;
type OriginalFooterPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,rect: Parameters<typeof originalDashboardFooter.renderFooter>[1],hints: originalDashboardFooter.FooterHint[],session?: Parameters<typeof originalDashboardFooter.renderFooter>[3]) => ReturnType<typeof originalDashboardFooter.renderFooter>;
const footerPublicOriginal: OriginalFooterPublic = null as unknown as NativeFooterPublic;
const footerPublicNative: NativeFooterPublic = null as unknown as OriginalFooterPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const footerNominalOriginal: typeof originalDashboardFooter.renderFooter = dashboardFooter.renderFooter;
void [footerDefaultsOriginal,footerDefaultsNative,footerKeys,footerPublicOriginal,footerPublicNative,footerNominalOriginal];

import * as dashboardOutput from "toolcraft-design-rust/dashboard/components/output-pane";
import type * as originalDashboardOutput from "toolcraft-design/dashboard/components/output-pane";
const outputLinesOriginal: typeof originalDashboardOutput.computeVisualLines = dashboardOutput.computeVisualLines;
const outputLinesNative: typeof dashboardOutput.computeVisualLines = null as unknown as typeof originalDashboardOutput.computeVisualLines;
const outputKeys: SameKeys<typeof dashboardOutput,typeof originalDashboardOutput> = true;
type NativeOutputPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,rect: Parameters<typeof dashboardOutput.renderOutputPane>[1],items: Parameters<typeof dashboardOutput.renderOutputPane>[2],offset?: number,options?: Parameters<typeof dashboardOutput.renderOutputPane>[4]) => number;
type OriginalOutputPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,rect: Parameters<typeof originalDashboardOutput.renderOutputPane>[1],items: Parameters<typeof originalDashboardOutput.renderOutputPane>[2],offset?: number,options?: Parameters<typeof originalDashboardOutput.renderOutputPane>[4]) => number;
const outputPublicOriginal: OriginalOutputPublic = null as unknown as NativeOutputPublic;
const outputPublicNative: NativeOutputPublic = null as unknown as OriginalOutputPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const outputNominalOriginal: typeof originalDashboardOutput.renderOutputPane = dashboardOutput.renderOutputPane;
void [outputLinesOriginal,outputLinesNative,outputKeys,outputPublicOriginal,outputPublicNative,outputNominalOriginal];

import * as dashboardContext from "toolcraft-design-rust/dashboard/components/context-pane";
import type * as originalDashboardContext from "toolcraft-design/dashboard/components/context-pane";
const contextKeys: SameKeys<typeof dashboardContext,typeof originalDashboardContext> = true;
type NativeContextPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,rect: Parameters<typeof dashboardContext.renderContextPane>[1],context: string[]) => ReturnType<typeof dashboardContext.renderContextPane>;
type OriginalContextPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,rect: Parameters<typeof originalDashboardContext.renderContextPane>[1],context: string[]) => ReturnType<typeof originalDashboardContext.renderContextPane>;
const contextPublicOriginal: OriginalContextPublic = null as unknown as NativeContextPublic;
const contextPublicNative: NativeContextPublic = null as unknown as OriginalContextPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const contextNominalOriginal: typeof originalDashboardContext.renderContextPane = dashboardContext.renderContextPane;
void [contextKeys,contextPublicOriginal,contextPublicNative,contextNominalOriginal];

import * as dashboardStats from "toolcraft-design-rust/dashboard/components/stats-pane";
import type * as originalDashboardStats from "toolcraft-design/dashboard/components/stats-pane";
const statsKeys: SameKeys<typeof dashboardStats,typeof originalDashboardStats> = true;
const statsLinesOriginal: typeof originalDashboardStats.statsToLines = dashboardStats.statsToLines;
const statsLinesNative: typeof dashboardStats.statsToLines = null as unknown as typeof originalDashboardStats.statsToLines;
const statsNumberOriginal: typeof originalDashboardStats.formatNumber = dashboardStats.formatNumber;
const statsNumberNative: typeof dashboardStats.formatNumber = null as unknown as typeof originalDashboardStats.formatNumber;
type NativeStatsPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,rect: Parameters<typeof dashboardStats.renderStatsPane>[1],stats: Parameters<typeof dashboardStats.renderStatsPane>[2]) => void;
type OriginalStatsPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,rect: Parameters<typeof originalDashboardStats.renderStatsPane>[1],stats: Parameters<typeof originalDashboardStats.renderStatsPane>[2]) => void;
const statsPublicOriginal: OriginalStatsPublic = null as unknown as NativeStatsPublic;
const statsPublicNative: NativeStatsPublic = null as unknown as OriginalStatsPublic;
type NativeCompactStatsPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,rect: Parameters<typeof dashboardStats.renderCompactStatsPane>[1],stats: Parameters<typeof dashboardStats.renderCompactStatsPane>[2]) => ReturnType<typeof dashboardStats.renderCompactStatsPane>;
type OriginalCompactStatsPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,rect: Parameters<typeof originalDashboardStats.renderCompactStatsPane>[1],stats: Parameters<typeof originalDashboardStats.renderCompactStatsPane>[2]) => ReturnType<typeof originalDashboardStats.renderCompactStatsPane>;
const statsCompactOriginal: OriginalCompactStatsPublic = null as unknown as NativeCompactStatsPublic;
const statsCompactNative: NativeCompactStatsPublic = null as unknown as OriginalCompactStatsPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const statsNominalOriginal: typeof originalDashboardStats.renderStatsPane = dashboardStats.renderStatsPane;
void [statsKeys,statsLinesOriginal,statsLinesNative,statsNumberOriginal,statsNumberNative,statsPublicOriginal,statsPublicNative,statsCompactOriginal,statsCompactNative,statsNominalOriginal];

import * as dashboardRunView from "toolcraft-design-rust/dashboard/components/run-view";
import type * as originalDashboardRunView from "toolcraft-design/dashboard/components/run-view";
const runViewKeys: SameKeys<typeof dashboardRunView,typeof originalDashboardRunView> = true;
const runViewOptionsOriginal: originalDashboardRunView.RunViewOptions = null as unknown as dashboardRunView.RunViewOptions;
const runViewOptionsNative: dashboardRunView.RunViewOptions = null as unknown as originalDashboardRunView.RunViewOptions;
type NativeRunViewPublic = (buffer: BufferPublic<dashboardBuffer.ScreenBuffer>,options: dashboardRunView.RunViewOptions) => ReturnType<typeof dashboardRunView.renderRunView>;
type OriginalRunViewPublic = (buffer: BufferPublic<originalDashboardBuffer.ScreenBuffer>,options: originalDashboardRunView.RunViewOptions) => ReturnType<typeof originalDashboardRunView.renderRunView>;
const runViewPublicOriginal: OriginalRunViewPublic = null as unknown as NativeRunViewPublic;
const runViewPublicNative: NativeRunViewPublic = null as unknown as OriginalRunViewPublic;
// @ts-expect-error The buffer parameter retains the separate private-class identity gate.
const runViewNominalOriginal: typeof originalDashboardRunView.renderRunView = dashboardRunView.renderRunView;
void [runViewKeys,runViewOptionsOriginal,runViewOptionsNative,runViewPublicOriginal,runViewPublicNative,runViewNominalOriginal];

import * as dashboardSnapshot from "toolcraft-design-rust/dashboard/snapshot";
import type * as originalDashboardSnapshot from "toolcraft-design/dashboard/snapshot";
const snapshotOriginal: typeof originalDashboardSnapshot = dashboardSnapshot;
const snapshotNative: typeof dashboardSnapshot = null as unknown as typeof originalDashboardSnapshot;
const snapshotKeys: SameKeys<typeof dashboardSnapshot,typeof originalDashboardSnapshot> = true;
const snapshotOptionsOriginal: originalDashboardSnapshot.SnapshotOptions = null as unknown as import("toolcraft-design-rust").dashboard.SnapshotOptions;
const snapshotOptionsNative: import("toolcraft-design-rust").dashboard.SnapshotOptions = null as unknown as originalDashboardSnapshot.SnapshotOptions;
void [snapshotOriginal,snapshotNative,snapshotKeys,snapshotOptionsOriginal,snapshotOptionsNative];

import * as dashboardRuntime from "toolcraft-design-rust/dashboard/dashboard";
import type * as originalDashboardRuntime from "toolcraft-design/dashboard/dashboard";
import * as dashboardNamespace from "toolcraft-design-rust/dashboard/index";
import type * as originalDashboardNamespace from "toolcraft-design/dashboard/index";
const dashboardRuntimeOriginal: typeof originalDashboardRuntime = dashboardRuntime;
const dashboardRuntimeNative: typeof dashboardRuntime = null as unknown as typeof originalDashboardRuntime;
const dashboardRuntimeKeys: SameKeys<typeof dashboardRuntime,typeof originalDashboardRuntime> = true;
const dashboardNamespaceOriginal: typeof originalDashboardNamespace = dashboardNamespace;
const dashboardNamespaceNative: typeof dashboardNamespace = null as unknown as typeof originalDashboardNamespace;
const dashboardNamespaceKeys: SameKeys<typeof dashboardNamespace,typeof originalDashboardNamespace> = true;
const dashboardRootOriginal: typeof originalDashboardNamespace = null as unknown as typeof import("toolcraft-design-rust").dashboard;
const dashboardRootNative: typeof import("toolcraft-design-rust").dashboard = null as unknown as typeof originalDashboardNamespace;
void [dashboardRuntimeOriginal,dashboardRuntimeNative,dashboardRuntimeKeys,dashboardNamespaceOriginal,dashboardNamespaceNative,dashboardNamespaceKeys,dashboardRootOriginal,dashboardRootNative];

import * as explorerKeymap from "toolcraft-design-rust/explorer/keymap";
import type * as originalExplorerKeymap from "toolcraft-design/explorer/keymap";
const explorerKeymapOriginal: typeof originalExplorerKeymap = explorerKeymap;
const explorerKeymapNative: typeof explorerKeymap = null as unknown as typeof originalExplorerKeymap;
const explorerKeymapKeys: SameKeys<typeof explorerKeymap,typeof originalExplorerKeymap> = true;
void [explorerKeymapOriginal,explorerKeymapNative,explorerKeymapKeys];

import * as explorerState from "toolcraft-design-rust/explorer/state";
import type * as originalExplorerState from "toolcraft-design/explorer/state";
const explorerStateOriginal: typeof originalExplorerState = explorerState;
const explorerStateNative: typeof explorerState = null as unknown as typeof originalExplorerState;
const explorerStateKeys: SameKeys<typeof explorerState,typeof originalExplorerState> = true;
void [explorerStateOriginal,explorerStateNative,explorerStateKeys];

import * as explorerLayout from "toolcraft-design-rust/explorer/layout";
import type * as originalExplorerLayout from "toolcraft-design/explorer/layout";
const explorerLayoutOriginal: typeof originalExplorerLayout = explorerLayout;
const explorerLayoutNative: typeof explorerLayout = null as unknown as typeof originalExplorerLayout;
const explorerLayoutKeys: SameKeys<typeof explorerLayout,typeof originalExplorerLayout> = true;
void [explorerLayoutOriginal,explorerLayoutNative,explorerLayoutKeys];

import * as explorerActions from "toolcraft-design-rust/explorer/actions";
import type * as originalExplorerActions from "toolcraft-design/explorer/actions";
const explorerActionsOriginal: typeof originalExplorerActions = explorerActions;
const explorerActionsNative: typeof explorerActions = null as unknown as typeof originalExplorerActions;
const explorerActionsKeys: SameKeys<typeof explorerActions,typeof originalExplorerActions> = true;
void [explorerActionsOriginal,explorerActionsNative,explorerActionsKeys];

import * as explorerFilter from "toolcraft-design-rust/explorer/filter";
import type * as originalExplorerFilter from "toolcraft-design/explorer/filter";
const explorerFilterOriginal: typeof originalExplorerFilter = explorerFilter;
const explorerFilterNative: typeof explorerFilter = null as unknown as typeof originalExplorerFilter;
const explorerFilterKeys: SameKeys<typeof explorerFilter,typeof originalExplorerFilter> = true;
const filterMatchOriginal: originalExplorerFilter.FilterMatch = null as unknown as explorerFilter.FilterMatch;
const filterMatchNative: explorerFilter.FilterMatch = null as unknown as originalExplorerFilter.FilterMatch;
const filterOptionsOriginal: originalExplorerFilter.FilterRowsOptions = null as unknown as explorerFilter.FilterRowsOptions;
const filterOptionsNative: explorerFilter.FilterRowsOptions = null as unknown as originalExplorerFilter.FilterRowsOptions;
void [explorerFilterOriginal,explorerFilterNative,explorerFilterKeys,filterMatchOriginal,filterMatchNative,filterOptionsOriginal,filterOptionsNative];

import * as explorerJobs from "toolcraft-design-rust/explorer/jobs";
import type * as originalExplorerJobs from "toolcraft-design/explorer/jobs";
const explorerJobsOriginal: typeof originalExplorerJobs = explorerJobs;
const explorerJobsNative: typeof explorerJobs = null as unknown as typeof originalExplorerJobs;
const explorerJobsKeys: SameKeys<typeof explorerJobs,typeof originalExplorerJobs> = true;
void [explorerJobsOriginal,explorerJobsNative,explorerJobsKeys];

import * as explorerDetailContent from "toolcraft-design-rust/explorer/detail-content";
import type * as originalExplorerDetailContent from "toolcraft-design/explorer/detail-content";
const explorerDetailContentOriginal: typeof originalExplorerDetailContent = explorerDetailContent;
const explorerDetailContentNative: typeof explorerDetailContent = null as unknown as typeof originalExplorerDetailContent;
const explorerDetailContentKeys: SameKeys<typeof explorerDetailContent,typeof originalExplorerDetailContent> = true;
const preparedContentOriginal: originalExplorerDetailContent.PreparedDetailContent = null as unknown as explorerDetailContent.PreparedDetailContent;
const preparedContentNative: explorerDetailContent.PreparedDetailContent = null as unknown as originalExplorerDetailContent.PreparedDetailContent;
void [explorerDetailContentOriginal,explorerDetailContentNative,explorerDetailContentKeys,preparedContentOriginal,preparedContentNative];
