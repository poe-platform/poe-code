import type { AcpMiddleware } from "@poe-code/agent-spawn";
import type {
  BraintrustIntegrationConfig,
  ConfigDocument as PoeCodeConfig,
} from "@poe-code/poe-code-config";
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

export async function bootstrap(
  config: PoeCodeConfig,
): Promise<Integrations | null> {
  const braintrust = config.integrations?.braintrust;
  if (braintrust?.enabled !== true) {
    return null;
  }

  validateBraintrustConfig(braintrust);

  try {
    await import("braintrust");
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "Braintrust integration is enabled but the 'braintrust' package is not installed. Run: npm i braintrust",
      );
    }

    throw err;
  }

  const client = createClient(braintrust);

  return {
    spawnMiddleware: createSpawnMiddleware(client),
    pipelineCallbacks: createPipelineCallbacks(client),
    experimentCallbacks: createExperimentCallbacks(client, braintrust.project),
    superintendentCallbacks: createSuperintendentCallbacks(client),
    status: () => client.status(),
    traceRun: makeTraceRun(client),
    shutdown() {
      return client.flush(5000);
    },
  };
}

function validateBraintrustConfig(
  braintrust: BraintrustIntegrationConfig,
): asserts braintrust is BraintrustIntegrationConfig & {
  apiKey: string;
  project: string;
} {
  requiredString(braintrust.apiKey, "apiKey");
  requiredString(braintrust.project, "project");
}

function requiredString(value: unknown, field: "apiKey" | "project"): void {
  if (typeof value === "string" && value.trim() !== "") {
    return;
  }

  throw new Error(`Braintrust integration is enabled but ${field} is missing`);
}

function isModuleNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  if ("code" in err && err.code === "ERR_MODULE_NOT_FOUND") {
    return true;
  }

  if ("cause" in err) {
    return isModuleNotFound(err.cause);
  }

  return false;
}
