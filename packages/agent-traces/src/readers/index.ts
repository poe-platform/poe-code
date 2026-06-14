import { claudeTraceReader } from "./claude.js";
import { codexTraceReader } from "./codex.js";
import type { TraceReader } from "../types.js";

export const traceReaders = [claudeTraceReader, codexTraceReader] satisfies TraceReader[];

export { claudeTraceReader, codexTraceReader };
