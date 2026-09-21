import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
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
let theme = { brand: "purple", label: "Poe" };
export function configureTheme(patch) {
  if (patch.brand !== undefined && !native.designBrandKnown(patch.brand))
    throw Error(`Unknown brand: ${patch.brand}`);
  theme = { brand: patch.brand ?? theme.brand, label: patch.label ?? theme.label };
}
export function getThemeConfig() {
  return { ...theme };
}
export function resetTheme() {
  theme = { brand: "purple", label: "Poe" };
}
function supportsColor() {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.NO_COLOR !== undefined || process.stdout.isTTY !== true) return false;
  return (
    typeof process.env.TERM === "string" &&
    process.env.TERM.length > 0 &&
    process.env.TERM !== "dumb"
  );
}
function isLightTheme() {
  const explicit = (process.env.POE_CODE_THEME ?? process.env.POE_THEME)?.toLowerCase();
  if (explicit === "light" || explicit === "dark") return explicit === "light";
  const apple = process.env.APPLE_INTERFACE_STYLE;
  if (typeof apple === "string") return apple.toLowerCase() !== "dark";
  const vscode = process.env.VSCODE_COLOR_THEME_KIND?.toLowerCase();
  if (vscode?.includes("light")) return true;
  if (vscode?.includes("dark")) return false;
  const background = Number.parseInt(process.env.COLORFGBG?.split(";").at(-1), 10);
  return Number.isFinite(background) && background >= 8;
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
  if (symbol === undefined) symbol = symbolFor(level, isLightTheme(), color);
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
  return symbolFor(level, isLightTheme(), supportsColor());
}
export const logger = createLogger();
