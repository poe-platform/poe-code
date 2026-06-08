import { AsyncLocalStorage } from "node:async_hooks";

export type OutputFormat = "terminal" | "markdown" | "json";

const VALID_FORMATS = new Set<OutputFormat>(["terminal", "markdown", "json"]);
const formatStorage = new AsyncLocalStorage<OutputFormat>();

let cached: OutputFormat | undefined;

export function resolveOutputFormat(
  env: { OUTPUT_FORMAT?: string } = process.env as { OUTPUT_FORMAT?: string }
): OutputFormat {
  const scoped = formatStorage.getStore();
  if (scoped) {
    return scoped;
  }
  if (cached) {
    return cached;
  }
  const raw = env.OUTPUT_FORMAT?.toLowerCase();
  cached = VALID_FORMATS.has(raw as OutputFormat) ? (raw as OutputFormat) : "terminal";
  return cached;
}

export function withOutputFormat<T>(format: OutputFormat, fn: () => T): T {
  return formatStorage.run(format, fn);
}

export function resetOutputFormatCache(): void {
  cached = undefined;
}
