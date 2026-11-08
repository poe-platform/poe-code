import type { RunContext } from "./run-context.js";
import type { AcpEvent, AcpHost } from "./types.js";
import type { AcpModel } from "./acp-model.js";
export type {
  AcpModel,
  AcpModelToolDefinition,
  AcpModelResponse,
  AcpModelRequestMessage
} from "./acp-model.js";
export type RunAcpCoreOptions = {
  prompt: string;
  runContext: RunContext;
  host: AcpHost;
  model: AcpModel;
  baseSystemPrompt?: string;
  maxIterations?: number;
  signal?: AbortSignal;
  onPromptSubmitted?(prompt: string): void | Promise<void>;
  disposeRun?(): void | Promise<void>;
};
export declare function runAcpCore(options: RunAcpCoreOptions): AsyncIterable<AcpEvent>;
