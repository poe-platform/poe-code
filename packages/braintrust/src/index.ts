import type { AcpMiddleware } from "@poe-code/agent-spawn";

import { createClient } from "./client.js";
import {
  createExperimentCallbacks,
  type ExperimentCallbackFields,
} from "./adapters/experiment.js";
import {
  createPipelineCallbacks,
  type PipelineCallbackFields,
} from "./adapters/pipeline.js";
import { createSpawnMiddleware } from "./adapters/spawn.js";
import {
  createSuperintendentCallbacks,
  type LoopCallbacks,
} from "./adapters/superintendent.js";
import { makeTraceRun, type TraceSurface } from "./trace-run.js";

export interface BraintrustOptions {
  enabled?: boolean;
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}

export interface Integrations {
  spawnMiddleware?: AcpMiddleware;
  pipelineCallbacks?: PipelineCallbackFields;
  experimentCallbacks?: ExperimentCallbackFields;
  superintendentCallbacks?: LoopCallbacks;
  status(): {
    lastError: string | null;
    errorCount: number;
    project: string;
  };
  traceRun<T>(
    surface: TraceSurface,
    name: string,
    fn: () => Promise<T>,
  ): Promise<T>;
  shutdown(): Promise<void>;
}

export function bootstrap(
  options: BraintrustOptions | undefined,
): Integrations | null {
  if (options?.enabled !== true) {
    return null;
  }

  const normalizedOptions = normalizeBraintrustConfig(options);

  const client = createClient(normalizedOptions);

  return {
    spawnMiddleware: createSpawnMiddleware(client),
    pipelineCallbacks: createPipelineCallbacks(client),
    experimentCallbacks: createExperimentCallbacks(client, normalizedOptions.project),
    superintendentCallbacks: createSuperintendentCallbacks(client),
    status: () => client.status(),
    traceRun: makeTraceRun(client),
    shutdown() {
      return client.flush(5000);
    },
  };
}

function normalizeBraintrustConfig(
  options: BraintrustOptions,
): BraintrustOptions & {
  apiKey: string;
  project: string;
} {
  return {
    ...options,
    apiKey: requiredString(options.apiKey, "apiKey"),
    project: requiredString(options.project, "project"),
  };
}

function requiredString(value: unknown, field: "apiKey" | "project"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }

  throw new Error(`Braintrust integration is enabled but ${field} is missing`);
}

export { loadIntegrations } from "./load-integrations.js";
