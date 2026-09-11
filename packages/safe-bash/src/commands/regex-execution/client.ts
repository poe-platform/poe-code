import { Worker } from "node:worker_threads";
import { RegexExecutor as PortableRegexExecutor } from "./portable.js";
import type { RegexExecutionOptions } from "./protocol.js";
import type { BoundedRegexProvider } from "./provider.js";

export { AvailableRecords, RegexSession, withRegexSession } from "./portable.js";
export { RegexExecutionError, type RegexExecutionOptions } from "./protocol.js";

export function createNodeRegexProvider(): BoundedRegexProvider {
  return {
    createWorker(policy) {
      return new Worker(new URL(import.meta.url.endsWith(".ts") ? "../../../dist/commands/regex-execution/worker.js" : "./worker.js", import.meta.url), {
        execArgv: [], resourceLimits: {
          maxOldGenerationSizeMb: policy.workerOldGenerationMb,
          stackSizeMb: policy.workerStackMb,
        },
      });
    },
  };
}

export class RegexExecutor extends PortableRegexExecutor {
  constructor(options: RegexExecutionOptions = {}) {
    super(createNodeRegexProvider(), options);
  }
}
