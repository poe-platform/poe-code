import type { CommandContext, FileSystem } from "../contracts/index.js";
import type { Budget } from "../shell/runtime.js";

/** True when a Shell-owned frame contains only forwardable standard streams. */
export const shellDescriptorAdmissions = new WeakMap<object, boolean>();

/** Invocation-owned state supplied by the interpreter, never guessed by a host. */
export const workerRuntimeContexts = new WeakMap<CommandContext, {
  readonly budget: Budget;
  readonly umask: number;
  readonly ignoredSignals: readonly number[];
  readonly fs: FileSystem;
}>();
