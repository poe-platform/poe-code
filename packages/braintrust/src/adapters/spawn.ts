import type { AcpMiddleware, AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";
import { acpToTrace, emitToBraintrust, type BraintrustSpanLike } from "@poe-code/acp-telemetry";

import type { BraintrustClient } from "../client.js";

type SpawnContextWithMetadata = SpawnContext & {
  metadata?: Record<string, unknown>;
};

export function createSpawnMiddleware(client: BraintrustClient): AcpMiddleware {
  return async (ctx, next) => {
    let aborted = false;
    try {
      await next();
    } catch (err) {
      const metadataCtx = ctx as SpawnContextWithMetadata;
      metadataCtx.metadata = {
        ...metadataCtx.metadata,
        aborted: true
      };
      aborted = true;
      throw err;
    } finally {
      const source = ctx.eventStream;
      if (!source || aborted) {
        await emitSpawnTraceFromCurrentSpan(client, ctx);
      } else {
        const parentSpan = await readCurrentSpan(client);
        if (parentSpan !== undefined) {
          ctx.eventStream = (async function* () {
            try {
              yield* source;
            } finally {
              emitSpawnTrace(client, ctx, parentSpan);
            }
          })();
        }
      }
    }
  };
}

async function emitSpawnTraceFromCurrentSpan(
  client: BraintrustClient,
  ctx: SpawnContext
): Promise<void> {
  const parentSpan = await readCurrentSpan(client);
  if (parentSpan !== undefined) {
    emitSpawnTrace(client, ctx, parentSpan);
  }
}

async function readCurrentSpan(client: BraintrustClient): Promise<BraintrustSpanLike | undefined> {
  try {
    const { currentSpan } = await import("braintrust");
    return currentSpan() as BraintrustSpanLike;
  } catch (err) {
    client.recordError(err, "log spawn session");
    return undefined;
  }
}

function emitSpawnTrace(
  client: BraintrustClient,
  ctx: SpawnContext,
  parentSpan: BraintrustSpanLike
): void {
  try {
    emitToBraintrust(acpToTrace(ctx), parentSpan);
  } catch (err) {
    client.recordError(err, "log spawn session");
  }
}
