import { claudeTraceReader } from "./claude.js";
import { codexTraceReader } from "./codex.js";
import { piTraceReader } from "./pi.js";
import { poeCodeTraceReader } from "./poe-code.js";
import type { TraceReader } from "../types.js";

export const traceReaders = [
  claudeTraceReader,
  codexTraceReader,
  piTraceReader,
  poeCodeTraceReader
] satisfies TraceReader[];

export { claudeTraceReader, codexTraceReader, piTraceReader, poeCodeTraceReader };
