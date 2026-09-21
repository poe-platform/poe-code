import { createRequire } from "node:module";
import { HookRegistry } from "./hooks.js";
import { createFileAwarenessTracker } from "./file-awareness.js";
import { PromptRegistry } from "./prompts.js";
import { ToolRegistry } from "./tools.js";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
export class RunContext {
  messages = [];
  tools = new ToolRegistry();
  prompts = new PromptRegistry();
  hooks = new HookRegistry();
  session = new Map();
  mcpServers = [];
  activeSkills;
  fileAwareness;
  abortController = new AbortController();
  childRuns = new Set();
  #logger;
  #order = new native.NativeDisposal();
  #disposeHooks = new Map();
  #nextHandle = 0;
  #disposing;
  #disposed = false;
  constructor(options = {}) {
    const names = [];
    for (const value of options.activeSkills ?? []) names.push(value.trim());
    this.activeSkills = native.normalizePluginDependencies(names);
    this.#logger = options.logger ?? console;
    this.fileAwareness =
      options.fileAwareness ?? createFileAwarenessTracker(options.cwd ?? process.cwd());
  }
  get logger() {
    return this.#logger;
  }
  registerDisposeHook(hook) {
    const handle = this.#nextHandle++;
    this.#order.add(handle);
    this.#disposeHooks.set(handle, hook);
  }
  trackChildRun(childRun) {
    this.childRuns.add(childRun);
    void childRun.then(
      () => {
        this.childRuns.delete(childRun);
      },
      () => {
        this.childRuns.delete(childRun);
      }
    );
    return childRun;
  }
  getChildRunCount() {
    return this.childRuns.size;
  }
  async dispose() {
    if (this.#disposed) return;
    if (this.#disposing) return this.#disposing;
    this.#disposing = this.#disposeInternal();
    try {
      await this.#disposing;
      this.#disposed = true;
      this.#order.clear();
      this.#disposeHooks.clear();
      this.childRuns.clear();
    } finally {
      this.#disposing = undefined;
    }
  }
  async #disposeInternal() {
    if (!this.abortController.signal.aborted) this.abortController.abort();
    const errors = [],
      failed = [];
    for (const handle of this.#order.attempts()) {
      const hook = this.#disposeHooks.get(handle);
      if (!hook) continue;
      try {
        await hook();
      } catch (error) {
        errors.push(error);
        failed.push(handle);
        this.#logger.error("Dispose hook failed.", error);
      }
    }
    this.#order.retainFailed(failed);
    const retained = new Map();
    for (const handle of failed) retained.set(handle, this.#disposeHooks.get(handle));
    this.#disposeHooks = retained;
    if (errors.length) throw new AggregateError(errors, "RunContext disposal failed.");
  }
}
export function createRunContext(options) {
  return new RunContext(options);
}
