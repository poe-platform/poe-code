import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { supportsColor } from "./color-support.js";
import { resolveThemeName } from "./theme.js";
import { getThemeConfig } from "./theme-state.js";
export { configureTheme, getThemeConfig, resetTheme } from "./theme-state.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const formats = new AsyncLocalStorage();
let cachedFormat;
export function resolveOutputFormat(env = process.env) {
  const scoped = formats.getStore();
  if (scoped) return scoped;
  if (cachedFormat) return cachedFormat;
  const raw = env.OUTPUT_FORMAT?.toLowerCase();
  return (cachedFormat = ["terminal", "markdown", "json"].includes(raw) ? raw : "terminal");
}
export function withOutputFormat(format, operation) {
  return formats.run(format, operation);
}
export function resetOutputFormatCache() {
  cachedFormat = undefined;
}
export function stripAnsi(text) {
  if (typeof text === "string" && !text.includes("\x1b") && !text.includes("\u009b")) return text;
  return native.designStripAnsi(text);
}
const markdownPrefixes = Object.fromEntries(
  ["info", "success", "warn", "error", "message"].map((level) => [
    level,
    native.designLogRender(level, "", "markdown", "", "").slice(0, -1)
  ])
);
const symbolCache = new Map();
function symbolFor(level, light, color) {
  const theme = getThemeConfig();
  const key = `${level}:${theme.brand}:${light}:${color}`;
  if (!symbolCache.has(key))
    symbolCache.set(key, native.designLogSymbol(level, theme.brand, light, color));
  return symbolCache.get(key);
}
function write(level, text, symbol) {
  const format = resolveOutputFormat();
  if (
    typeof text === "string" &&
    text.length <= 512 &&
    format !== "terminal" &&
    !text.includes("\x1b") &&
    !text.includes("\u009b")
  ) {
    if (format === "json") process.stdout.write(JSON.stringify({ level, message: text }) + "\n");
    else
      process.stdout.write(
        markdownPrefixes[level] +
          text.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ") +
          "\n"
      );
    return;
  }
  const color = supportsColor();
  if (symbol === undefined) symbol = symbolFor(level, resolveThemeName() === "light", color);
  const secondary = symbolFor("message", false, color);
  process.stdout.write(native.designLogRender(level, text, format, String(symbol), secondary));
}
export function createLogger(emitter) {
  return {
    info(text) {
      if (emitter) emitter(text);
      else write("info", text);
    },
    success(text) {
      if (emitter) emitter(text);
      else write("success", text);
    },
    warn(text) {
      if (emitter) emitter(text);
      else write("warn", text);
    },
    error(text) {
      if (emitter) emitter(text);
      else write("error", text);
    },
    resolved(label, value) {
      if (emitter) emitter(`${label}: ${value}`);
      else write("message", `${label}\n   ${value}`, resolveSymbol("resolved"));
    },
    errorResolved(label, value) {
      if (emitter) emitter(`${label}: ${value}`);
      else write("message", `${label}\n   ${value}`, resolveSymbol("errorResolved"));
    },
    message(text, symbol) {
      if (emitter) emitter(text);
      else write("message", text, symbol ?? undefined);
    }
  };
}
function resolveSymbol(level) {
  const format = resolveOutputFormat();
  if (format === "json") return level === "resolved" ? "resolved" : "error";
  if (format === "markdown") return level === "resolved" ? ">" : "[!]";
  return symbolFor(level, resolveThemeName() === "light", supportsColor());
}
export const logger = createLogger();
