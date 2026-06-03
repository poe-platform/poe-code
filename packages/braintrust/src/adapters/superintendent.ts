import type * as BraintrustSdk from "braintrust";

import type { BraintrustClient } from "../client.js";
import { buildSuperintendentLog } from "../row-builder.js";

export type SuperintendentRole = "builder" | "inspector" | "superintendent" | "owner";

export type LoopCallbacks = {
  runRole?: <T>(
    role: SuperintendentRole,
    name: string | undefined,
    run: () => Promise<T>
  ) => Promise<T>;
};

type BraintrustSpan = {
  log(event: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    scores?: Record<string, number>;
  }): void;
};

export function createSuperintendentCallbacks(client: BraintrustClient): LoopCallbacks {
  return {
    runRole: (role, name, run) => traceRole(client, role, name, run)
  };
}

async function traceRole<T>(
  client: BraintrustClient,
  role: SuperintendentRole,
  name: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  let executionStarted = false;
  let executionError: unknown;
  let executionResult: T | undefined;

  try {
    const sdk = await client.getSdk();
    const traced = resolveTraced(sdk);
    const currentSpan = resolveCurrentSpan(sdk);
    return await traced(
      async () => {
        executionStarted = true;
        const span = currentSpan() as BraintrustSpan;
        try {
          executionResult = await run();
          (span as BraintrustSpan).log(buildSuperintendentLog(role, executionResult));
          return executionResult;
        } catch (error) {
          executionError = error;
          (span as BraintrustSpan).log({
            metadata: {
              role,
              ...(name === undefined ? {} : { name }),
              error: error instanceof Error ? error.message : String(error)
            },
            scores: { passed: 0 }
          });
          throw error;
        }
      },
      {
        name: name === undefined ? `role:${role}` : `role:${role}:${name}`,
        type: "task"
      }
    );
  } catch (error) {
    if (executionError !== undefined) {
      throw executionError;
    }
    client.recordError(error, `superintendent ${role}`);
    if (executionStarted) {
      return executionResult as T;
    }
    return run();
  }
}

function resolveTraced(sdk: typeof BraintrustSdk | undefined): typeof BraintrustSdk.traced {
  if (sdk === undefined || typeof sdk.traced !== "function") {
    throw new Error("Braintrust SDK traced unavailable");
  }
  return sdk.traced;
}

function resolveCurrentSpan(
  sdk: typeof BraintrustSdk | undefined
): typeof BraintrustSdk.currentSpan {
  if (sdk === undefined || typeof sdk.currentSpan !== "function") {
    throw new Error("Braintrust SDK current span unavailable");
  }
  return sdk.currentSpan;
}
