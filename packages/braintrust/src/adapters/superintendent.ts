import type { LoopCallbacks } from "@poe-code/superintendent";

import type { BraintrustClient } from "../client.js";
import { logSuperintendentRole } from "../row-builder.js";

type BraintrustSpan = {
  log(event: {
    metadata?: Record<string, unknown>;
    scores?: Record<string, number>;
  }): void;
  end(): void;
};

type BraintrustSpanParent = {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpan;
};

export function createSuperintendentCallbacks(
  client: BraintrustClient,
): LoopCallbacks {
  return {
    onBuilderComplete(result) {
      void logSuperintendentRole(client, "builder", result);
    },
    onBuilderFailed(error) {
      void logFailedRole(client, "builder", error);
    },
    onInspectorComplete(result) {
      void logSuperintendentRole(client, "inspector", result);
    },
    onInspectorFailed(name, error) {
      void logFailedRole(client, "inspector", error, name);
    },
    onSuperintendentComplete(result) {
      void logSuperintendentRole(client, "superintendent", result);
    },
    onOwnerComplete(result) {
      void logSuperintendentRole(client, "owner", result);
    },
  };
}

async function logFailedRole(
  client: BraintrustClient,
  role: "builder" | "inspector",
  error: Error,
  name?: string,
): Promise<void> {
  try {
    const { currentSpan } = await import("braintrust");
    const span = asSpanParent(currentSpan()).startSpan({
      name: name === undefined ? `role:${role}:failed` : `role:${role}:${name}:failed`,
      type: "task",
    });

    try {
      span.log({
        metadata: {
          role,
          ...(name === undefined ? {} : { name }),
          error: error.message,
        },
        scores: {
          passed: 0,
        },
      });
    } finally {
      span.end();
    }
  } catch (err) {
    client.recordError(err, `superintendent ${role} failed`);
  }
}

function asSpanParent(value: unknown): BraintrustSpanParent {
  const span = value as Partial<BraintrustSpanParent> | undefined;
  if (span === undefined || typeof span.startSpan !== "function") {
    throw new Error("Braintrust current span unavailable");
  }

  return span as BraintrustSpanParent;
}
