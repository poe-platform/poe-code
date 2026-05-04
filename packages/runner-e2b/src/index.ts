import type { ExecutionEnvFactory } from "@poe-code/agent-harness-tools";
import { e2bExecutionEnvFactory as factory } from "./factory.js";

export const e2bExecutionEnvFactory: ExecutionEnvFactory = factory;
export { e2bAuthScope, resolveE2bApiKey } from "./auth-scope.js";
