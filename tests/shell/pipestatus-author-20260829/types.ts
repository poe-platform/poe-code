import type { State } from "./runtime.js";
import type { InvocationScope } from "./cleanup.js";
import { pipelineStatusTarget, publishPipelineStatus } from "./pipestatus.js";
import type { PipelineStatusTarget } from "./pipestatus.js";

export function checkTypes(state: State, signal: AbortSignal, scope: InvocationScope): Promise<void> {
  const target: PipelineStatusTarget = pipelineStatusTarget(state);
  void target;
  // @ts-expect-error completion values must be numeric
  void publishPipelineStatus(state, ["0"], signal, scope);
  // @ts-expect-error target kinds are a closed private classification
  const invalid: PipelineStatusTarget = "undefined-means-absent";
  void invalid;
  return publishPipelineStatus(state, [0, 1, 255], signal, scope);
}
