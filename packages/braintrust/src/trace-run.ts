import type * as BraintrustSdk from "braintrust";

import type { BraintrustClient } from "./client.js";

export type TraceSurface =
  | "pipeline"
  | "superintendent"
  | "experiment"
  | "spawn";

export function makeTraceRun(client: BraintrustClient): <T>(
  surface: TraceSurface,
  name: string,
  fn: () => Promise<T>,
) => Promise<T> {
  return async <T>(
    surface: TraceSurface,
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const spanName = `${surface}:${name}`;
    let callbackCompleted = false;
    let callbackFailed = false;
    let callbackError: unknown;
    let callbackValue: T | undefined;

    try {
      const rootLogger = await client.getRootLogger();
      if (rootLogger === undefined) {
        throw new Error("Braintrust logger unavailable");
      }

      const sdk = await client.getSdk();
      const traced = resolveTraced(sdk);

      const tracedValue = await traced(
        async () => {
          try {
            callbackValue = await fn();
          } catch (err) {
            callbackFailed = true;
            callbackError = err;
            throw err;
          }
          callbackCompleted = true;
          return callbackValue;
        },
        {
          name: spanName,
          type: "task",
          event: {
            tags: [`surface:${surface}`],
          },
        },
      );

      return tracedValue;
    } catch (err) {
      if (callbackFailed) {
        throw callbackError;
      }

      client.recordError(err, `trace ${spanName}`);
      if (callbackCompleted) {
        return callbackValue as T;
      }

      return fn();
    }
  };
}

function resolveTraced(
  sdk: typeof BraintrustSdk | undefined,
): typeof BraintrustSdk.traced {
  if (sdk === undefined) {
    throw new Error("Braintrust SDK unavailable");
  }

  if (typeof sdk.traced !== "function") {
    throw new Error("Braintrust SDK traced unavailable");
  }

  return sdk.traced;
}
