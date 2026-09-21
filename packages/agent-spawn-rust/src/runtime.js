import { registerExecutionEnvFactory } from "./harness/execution-env.js";
import { hostExecutionEnvFactory, dockerExecutionEnvFactory } from "./process/index.js";

registerExecutionEnvFactory(hostExecutionEnvFactory);
registerExecutionEnvFactory(dockerExecutionEnvFactory);

export {
  resolvePoeCommandExecution as resolveSpawnExecution,
  UnsupportedRuntimeCapabilityError
} from "./harness/poe-command-execution.js";
