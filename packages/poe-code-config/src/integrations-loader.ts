import type { ConfigDocument as PoeCodeConfig, BraintrustIntegrationConfig } from "./types.js";
import type {
  ExperimentCallbackFields,
  LoopCallbacks,
  PipelineCallbackFields
} from "./merge-callbacks.js";

export type TraceSurface = "pipeline" | "experiment" | "superintendent" | "spawn";

export type AcpMiddleware = (
  ctx: unknown,
  next: () => Promise<void>
) => Promise<void>;

export interface Integrations {
  spawnMiddleware?: AcpMiddleware;
  pipelineCallbacks?: PipelineCallbackFields;
  experimentCallbacks?: ExperimentCallbackFields;
  superintendentCallbacks?: LoopCallbacks;
  traceRun<T>(
    surface: TraceSurface,
    name: string,
    fn: () => Promise<T>
  ): Promise<T>;
  shutdown(): Promise<void>;
}

type BraintrustModule = {
  bootstrap(options: BraintrustIntegrationConfig | undefined): Integrations | null;
};

export async function loadIntegrations(
  config: PoeCodeConfig
): Promise<Integrations | null> {
  if (!config.integrations?.braintrust?.enabled) return null;
  const mod = await import("@poe-code/braintrust") as BraintrustModule;
  return mod.bootstrap(config.integrations.braintrust);
}
