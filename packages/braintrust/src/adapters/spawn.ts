import type { AcpMiddleware, AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";

import type { BraintrustClient } from "../client.js";
import { logSpawnSession } from "../span-builder.js";

type SpawnContextWithMetadata = SpawnContext & {
  metadata?: Record<string, unknown>;
};

export function createSpawnMiddleware(
  client: BraintrustClient,
): AcpMiddleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const metadataCtx = ctx as SpawnContextWithMetadata;
      metadataCtx.metadata = {
        ...metadataCtx.metadata,
        aborted: true,
      };
      throw err;
    } finally {
      await logSpawnSession(client, ctx);
    }
  };
}
