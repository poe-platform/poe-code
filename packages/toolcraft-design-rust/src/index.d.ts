export type TemplateEscape = "html" | "none";
export {renderHtml} from "./html.js";
export type {HtmlRenderOptions} from "./html.js";
export {render} from "./markdown-render.js";
export type {RenderOptions} from "./markdown-render.js";
export {color} from "./color.js";
export { symbols } from "./symbols.js";
export { spacing } from "./spacing.js";
export { widths } from "./widths.js";
export * as tokens from "./tokens.js";
export type {Color} from "./color.js";
export {brands,brand,dark,light,getTheme,resolveThemeName,resetThemeCache} from "./theme.js";
export type {Brand,ThemeName,ThemePalette,ThemeEnv} from "./theme.js";
export {text,typography} from "./text.js";
export * as acp from "./acp.js";
export { renderTable, loggerTableWidth } from "./table.js";
export type { TableColumn, RenderTableOptions } from "./table.js";
export interface RenderTemplateOptions {
  escape?: TemplateEscape;
  partials?: Record<string, string>;
  validate?: boolean;
  yield?: string;
}
export declare class TemplateParseError extends Error {
  readonly description: string;
  readonly line: number;
  readonly column: number;
  constructor(description: string, position: { line: number; column: number });
}
export declare function getTemplatePartialNames(template: string): string[];
export declare function resolveTemplatePartials(
  template: string,
  partials: Record<string, string>
): string;
export declare function renderTemplate(
  template: string,
  view: Record<string, unknown>,
  options?: RenderTemplateOptions
): string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutOptions {
  totalWidth: number;
  totalHeight: number;
  rightPaneWidth?: number;
  footerHeight?: number;
  borderWidth?: number;
}
export interface DashboardLayout {
  summary?: Rect;
  outerBorder: Rect;
  leftPane: Rect;
  rightPane: Rect;
  divider: { x: number; top: number; bottom: number };
  footer: Rect;
  footerDivider: { y: number; left: number; right: number };
}
export declare function computeDashboardLayout(options: LayoutOptions): DashboardLayout;

export * from "./output-preview.js";

export * as dashboard from "./dashboard.js";

export type OutputFormat = "terminal" | "markdown" | "json";
export interface LoggerOutput {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  resolved(label: string, value: string): void;
  errorResolved(label: string, value: string): void;
  message(message: string, symbol?: string): void;
}
export declare function createLogger(emitter?: (message: string) => void): LoggerOutput;
export declare const logger: LoggerOutput;
export declare function stripAnsi(value: string): string;
export declare function resolveOutputFormat(env?: { OUTPUT_FORMAT?: string }): OutputFormat;
export declare function withOutputFormat<T>(format: OutputFormat, operation: () => T): T;
export declare function resetOutputFormatCache(): void;
export declare function configureTheme(patch: { brand?: string; label?: string }): void;
export declare function getThemeConfig(): { brand: string; label: string };
export declare function resetTheme(): void;

export { createDashboardLineBuffer, createStreamingDashboardLineBuffer } from "./line-buffer.js";
export { formatCommandNotFound, formatCommandNotFoundPanel } from "./command-errors.js";
export { renderFileChanges } from "./file-changes.js";
export * from "./catalog.js";
export * from "./detail-card.js";
export * from "./inspector-card.js";
export * from "./resource-browser.js";
export * from "./help-formatter.js";
export * as helpFormatterPlain from "./help-formatter-plain.js";
export * from "./command-registry.js";
export * from "./overlay-manager.js";
export * from "./viewport.js";
export type { FileChange, FileChangeKind, FileChangeDisplayMode, FileChangeOutputFormat, RenderFileChangesOptions } from "./file-changes.js";
export * from "./inline-notice.js";
export * from "./metric.js";
export * from "./progress-group.js";
export * from "./event-groups.js";
export * from "./task-tree.js";
export * from "./render-performance.js";
export * as staticRender from "./static.js";
export {SPINNER_FRAMES,renderSpinnerFrame,renderSpinnerStopped,renderMenu} from "./static.js";
export type {SpinnerFrameOptions,SpinnerStoppedOptions,MenuOption,RenderMenuOptions} from "./static.js";
export {renderPlaintext} from "./plaintext.js";
export type {PlaintextRenderOptions} from "./plaintext.js";
export type {MdNode,CodeToken,CodeTokenKind} from "./md-ast.js";
export {parse,renderMarkdown,renderMarkdownHtml,renderMarkdownPlaintext} from "./markdown.js";

export {packStyle,styleToSgrDelta} from "./screen-style.js";
export type {PackedStyle} from "./screen-style.js";

export {Screen, type Cell as ScreenCell, type ScreenSize, type ScreenSurface} from "./screen.js";

export {createTerminalDriver,type TerminalDriver,type TerminalInputEvent,type Size as TerminalSize} from "./terminal-driver.js";
export {note} from "./note.js";
export {openExternal} from "./browser.js";
export {intro,introPlain,outro,cancel,log} from "./prompt-output.js";
export {isCancel} from "./cancel-symbol.js";
export {spinner,type SpinnerOptions} from "./spinner.js";

export {withSpinner,type WithSpinnerOptions} from "./with-spinner.js";
export {promptTheme} from "./prompt-theme.js";
export * as prompts from "./prompts.js";
export {select, multiselect, text as promptText, confirm, confirmOrCancel, password, PromptCancelledError} from "./prompts.js";
export type {SelectOptions, MultiselectOptions, TextOptions, ConfirmOptions, PasswordOptions} from "./prompts.js";

export {shouldUseInteractiveDashboard} from "./dashboard-mode.js";
export {createDashboard,type Dashboard,type DashboardOptions} from "./dashboard-runtime.js";

export * as explorer from "./explorer.js";
export {runExplorer,singleDetail,normalizeExplorerConfig} from "./explorer.js";
export type {Row,DetailItem,Detail,DetailCtx,Action,ActionContext,ConfirmPromptOptions,ExplorerConfig,PaneConfig,ListPaneConfig,DetailPaneConfig,PaneRuntimeState,ReorderContext,Tone} from "./explorer.js";
