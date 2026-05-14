import type { AcpMiddleware, AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";
import { acpToTrace, emitToBraintrust, type BraintrustSpanLike } from "@poe-code/acp-telemetry";

import type { BraintrustClient } from "../client.js";

type SpawnContextWithMetadata = SpawnContext & {
  metadata?: Record<string, unknown>;
};

export function createSpawnMiddleware(client: BraintrustClient): AcpMiddleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const metadataCtx = ctx as SpawnContextWithMetadata;
      metadataCtx.metadata = {
        ...metadataCtx.metadata,
        aborted: true
      };
      throw err;
    } finally {
      try {
        const { currentSpan } = await import("braintrust");
        emitToBraintrust(acpToTrace(ctx), currentSpan() as BraintrustSpanLike);
      } catch (err) {
        client.recordError(err, "log spawn session");
      }
    }
  };
}
