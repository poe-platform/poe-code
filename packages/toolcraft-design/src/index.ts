// Tokens
export * as tokens from "./tokens/index.js";
export { brand, dark, light } from "./tokens/colors.js";
export { brands } from "./tokens/brand.js";
export type { Brand } from "./tokens/brand.js";
export type { ThemeName, ThemePalette } from "./tokens/colors.js";
export { spacing } from "./tokens/spacing.js";
export { typography } from "./tokens/typography.js";
export { widths } from "./tokens/widths.js";

// Components
export { text } from "./components/text.js";
export { color } from "./components/color.js";
export type { Color } from "./components/color.js";
export { symbols } from "./components/symbols.js";
export { createLogger, logger } from "./components/logger.js";
export type { LoggerOutput } from "./components/logger.js";
export {
  helpFormatter,
  formatColumns,
  formatCommand,
  formatUsage,
  formatOption,
  formatCommandList,
  formatOptionList
} from "./components/help-formatter.js";
export * as helpFormatterPlain from "./components/help-formatter-plain.js";
export type { CommandInfo, OptionInfo, FormatColumnsOptions } from "./components/help-formatter.js";
export { formatCommandNotFound } from "./components/command-errors.js";
export { formatCommandNotFoundPanel } from "./components/command-errors.js";
export { renderTable } from "./components/table.js";
export type { TableColumn, RenderTableOptions } from "./components/table.js";
export { renderCatalog } from "./components/catalog.js";
export type {
  CatalogGroup,
  CatalogItem,
  CatalogMetric,
  CatalogTone,
  RenderCatalogOptions
} from "./components/catalog.js";
export { renderDetailCard } from "./components/detail-card.js";
export type {
  DetailCardRow,
  DetailCardSection,
  RenderDetailCardOptions
} from "./components/detail-card.js";
export {
  getTemplatePartialNames,
  renderTemplate,
  resolveTemplatePartials
} from "./components/template.js";
export type { RenderTemplateOptions, TemplateEscape } from "./components/template.js";
export { openExternal } from "./components/browser.js";

// ACP rendering
export * as acp from "./acp/index.js";

// Dashboard
export * as dashboard from "./dashboard/index.js";
export { createDashboard, shouldUseInteractiveDashboard } from "./dashboard/index.js";
export type { Dashboard, DashboardOptions } from "./dashboard/index.js";

// Explorer
export * as explorer from "./explorer/index.js";
export { runExplorer, singleDetail } from "./explorer/index.js";
export type {
  Row,
  DetailItem,
  Detail,
  DetailCtx,
  Action,
  ActionContext,
  ExplorerConfig,
  ReorderContext,
  Tone
} from "./explorer/index.js";

// Prompts
export * as prompts from "./prompts/index.js";
export {
  intro,
  introPlain,
  outro,
  note,
  select,
  multiselect,
  text as promptText,
  confirm,
  confirmOrCancel,
  password,
  spinner,
  withSpinner,
  isCancel,
  cancel,
  log,
  PromptCancelledError
} from "./prompts/index.js";
export type {
  SelectOptions,
  MultiselectOptions,
  TextOptions,
  ConfirmOptions,
  PasswordOptions,
  SpinnerOptions,
  WithSpinnerOptions
} from "./prompts/index.js";
export { promptTheme } from "./prompts/theme.js";

// Static rendering
export * as staticRender from "./static/index.js";
export {
  SPINNER_FRAMES,
  renderSpinnerFrame,
  renderSpinnerStopped,
  renderMenu
} from "./static/index.js";
export type {
  SpinnerFrameOptions,
  SpinnerStoppedOptions,
  MenuOption,
  RenderMenuOptions
} from "./static/index.js";

// Terminal markdown
export { parse, render, renderMarkdown } from "./terminal-markdown/index.js";
export type { MdNode, RenderOptions } from "./terminal-markdown/index.js";

// Internal utilities (for advanced use)
export { getTheme, resolveThemeName, resetThemeCache } from "./internal/theme-detect.js";
export type { ThemeEnv } from "./internal/theme-detect.js";
export { configureTheme, getThemeConfig, resetTheme } from "./internal/theme-state.js";
export { stripAnsi } from "./internal/strip-ansi.js";
export {
  resolveOutputFormat,
  resetOutputFormatCache,
  withOutputFormat
} from "./internal/output-format.js";
export type { OutputFormat } from "./internal/output-format.js";
