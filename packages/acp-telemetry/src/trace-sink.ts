import type { AcpMiddleware } from "@poe-code/agent-spawn";

import { acpToTrace, type AcpTrace } from "./trace.js";

export type TraceSink = (trace: AcpTrace) => void | Promise<void>;

export function createTraceSinkMiddleware(sink: TraceSink): AcpMiddleware {
  return async (ctx, next) => {
    try {
      await next();
    } finally {
      await sink(acpToTrace(ctx));
    }
  };
}
