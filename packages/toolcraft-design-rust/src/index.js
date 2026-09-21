import { createRequire } from "node:module";
import { createTemplateEngine } from "./engine.js";
export { TemplateParseError } from "./engine.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const { renderTemplate, getTemplatePartialNames, resolveTemplatePartials } =
  createTemplateEngine(native);

export function computeDashboardLayout(options) {
  const data = native.dashboardLayout(
    Math.floor(options.totalWidth),
    Math.floor(options.totalHeight),
    Math.floor(options.borderWidth ?? 1),
    Math.floor(options.footerHeight ?? 1),
    Math.floor(options.rightPaneWidth ?? 25)
  );
  const layout = {
    outerBorder: { x: 0, y: 0, width: data[1], height: data[2] },
    leftPane: { x: data[3], y: data[4], width: data[5], height: data[6] },
    rightPane: { x: data[7], y: data[8], width: data[9], height: data[10] },
    divider: { x: data[11], top: data[12], bottom: data[13] },
    footer: { x: data[14], y: data[15], width: data[16], height: data[17] },
    footerDivider: { y: data[18], left: data[19], right: data[20] }
  };
  if (data[0] !== 0)
    layout.summary = { x: data[21], y: data[22], width: data[23], height: data[24] };
  return layout;
}

const previewPolicy = native.outputPreviewPolicy();
export const MAX_OUTPUT_PREVIEW_CHARS = previewPolicy.maxChars;
export const OUTPUT_TRUNCATION_NOTICE = previewPolicy.notice;
function hasTerminalStrings(text) {
  return previewPolicy.controls.some((control) => text.includes(control));
}
export function createTerminalStringFilter() {
  let filter,
    active = false;
  return {
    push(text) {
      if (!active && !hasTerminalStrings(text)) return text;
      filter ??= new native.NativeTerminalStringFilter();
      const result = filter.push(text);
      active = result.active;
      return result.text;
    }
  };
}
export function limitOutputPreview(text) {
  if (text.length <= MAX_OUTPUT_PREVIEW_CHARS && !hasTerminalStrings(text)) return text;
  return native.outputPreviewLimit(text);
}
export function retainOutputTail(text, maxChars) {
  return native.outputPreviewRetainStart(text, text.length - maxChars);
}
export function createOutputPreviewBuffer() {
  const buffer = new native.NativeOutputPreviewBuffer();
  return { push: buffer.push.bind(buffer), text: buffer.text.bind(buffer) };
}

export * as dashboard from "./dashboard.js";
export {
  createLogger,
  logger,
  stripAnsi,
  resolveOutputFormat,
  withOutputFormat,
  resetOutputFormatCache,
  configureTheme,
  getThemeConfig,
  resetTheme
} from "./logging.js";
