export type TemplateEscape = "html" | "none";
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

export declare const MAX_OUTPUT_PREVIEW_CHARS: number;
export declare const OUTPUT_TRUNCATION_NOTICE: string;
export declare function createTerminalStringFilter(): { push(text: string): string };
export declare function limitOutputPreview(text: string): string;
export declare function retainOutputTail(text: string, maxChars: number): string;
export declare function createOutputPreviewBuffer(): { push(text: string): void; text(): string };

export declare namespace dashboard {
  function limitOutputPreview(text: string): string;
  function createOutputPreviewBuffer(): { push(text: string): void; text(): string };
}
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
