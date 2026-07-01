import { claudeTraceReader } from "./claude.js";
import { codexTraceReader } from "./codex.js";
import { poeCodeTraceReader } from "./poe-code.js";
import type { TraceReader } from "../types.js";

export const traceReaders = [
  claudeTraceReader,
  codexTraceReader,
  poeCodeTraceReader
] satisfies TraceReader[];

export { claudeTraceReader, codexTraceReader, poeCodeTraceReader };
