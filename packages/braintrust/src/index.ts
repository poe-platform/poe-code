import type { AcpMiddleware } from "@poe-code/agent-spawn";
import type { LoopCallbacks } from "@poe-code/superintendent";

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
import { createSuperintendentCallbacks } from "./adapters/superintendent.js";
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

  validateBraintrustConfig(options);

  const client = createClient(options);

  return {
    spawnMiddleware: createSpawnMiddleware(client),
    pipelineCallbacks: createPipelineCallbacks(client),
    experimentCallbacks: createExperimentCallbacks(client, options.project),
    superintendentCallbacks: createSuperintendentCallbacks(client),
    status: () => client.status(),
    traceRun: makeTraceRun(client),
    shutdown() {
      return client.flush(5000);
    },
  };
}

function validateBraintrustConfig(
  options: BraintrustOptions,
): asserts options is BraintrustOptions & {
  apiKey: string;
  project: string;
} {
  requiredString(options.apiKey, "apiKey");
  requiredString(options.project, "project");
}

function requiredString(value: unknown, field: "apiKey" | "project"): void {
  if (typeof value === "string" && value.trim() !== "") {
    return;
  }

  throw new Error(`Braintrust integration is enabled but ${field} is missing`);
}
