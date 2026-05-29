import type * as BraintrustSdk from "braintrust";

export interface BraintrustClient {
  getSdk(): Promise<typeof BraintrustSdk | undefined>;
  getRootLogger(): Promise<unknown>;
  getExperiment(name: string): Promise<unknown>;
  flush(timeoutMs: number): Promise<void>;
  recordError(err: unknown, ctx: string): void;
  status(): {
    lastError: string | null;
    errorCount: number;
    project: string;
  };
}

export function createClient(opts: {
  apiKey: string;
  apiUrl?: string;
  project: string;
}): BraintrustClient {
  let sdkPromise: Promise<typeof BraintrustSdk | undefined> | undefined;
  let rootLoggerPromise: Promise<unknown> | undefined;
  const experiments = new Map<string, Promise<unknown>>();
  let lastError: string | null = null;
  let errorCount = 0;

  const recordError = (err: unknown, ctx: string): void => {
    try {
      errorCount += 1;
      lastError = `${ctx}: ${formatError(err)}`;
    } catch {
      errorCount += 1;
      lastError = `${ctx}: unknown error`;
    }
  };

  const loadSdk = async (): Promise<typeof BraintrustSdk | undefined> => {
    sdkPromise ??= import("braintrust").catch((err: unknown) => {
      recordError(err, "load sdk");
      return undefined;
    });

    return sdkPromise;
  };

  const sdkOptions = () => ({
    projectName: opts.project,
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
  });

  const client: BraintrustClient = {
    getSdk: loadSdk,

    async getRootLogger(): Promise<unknown> {
      rootLoggerPromise ??= (async () => {
        try {
          const sdk = await loadSdk();
          return sdk?.initLogger(sdkOptions());
        } catch (err) {
          recordError(err, "init logger");
          return undefined;
        }
      })();
      const logger = await rootLoggerPromise;
      if (logger === undefined) {
        rootLoggerPromise = undefined;
      }
      return logger;
    },

    async getExperiment(name: string): Promise<unknown> {
      if (!experiments.has(name)) {
        experiments.set(name, (async () => {
          try {
            const sdk = await loadSdk();
            return sdk?.initExperiment({
              ...sdkOptions(),
              experimentName: name,
            });
          } catch (err) {
            recordError(err, `init experiment ${name}`);
            return undefined;
          }
        })());
      }

      const experiment = await experiments.get(name);
      if (experiment === undefined) {
        experiments.delete(name);
      }
      return experiment;
    },

    async flush(timeoutMs: number): Promise<void> {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error("Braintrust flush requires a finite timeout in milliseconds.");
      }
      const flushAll = (async () => {
        const sdk = await sdkPromise;
        if (sdk === undefined) {
          return;
        }

        const targets = [
          await rootLoggerPromise,
          ...await Promise.all(experiments.values()),
        ].filter((target) => target !== undefined);

        const flushTargets = Promise.all(
          targets.map((target) => sdk.flush(target)),
        ).then(() => undefined);
        await flushTargets;
      })().catch((err: unknown) => {
        recordError(err, "flush");
      });

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          flushAll,
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } catch (err) {
        recordError(err, "flush");
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    },

    recordError,

    status() {
      return {
        lastError,
        errorCount,
        project: opts.project,
      };
    },
  };

  return client;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === "string") {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
