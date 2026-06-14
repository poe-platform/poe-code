import { HookRegistry } from "./hooks.js";
import { createFileAwarenessTracker, type FileAwarenessTracker } from "./file-awareness.js";
import type { McpServerConfig } from "./plugin-types.js";
import { PromptRegistry } from "./prompts.js";
import { ToolRegistry } from "./tools.js";
import type { ChatMessage } from "./types.js";

export type DisposeHook = () => void | Promise<void>;

export type RunContextLogger = {
  error(message: string, error?: unknown): void;
};

export type CreateRunContextOptions = {
  activeSkills?: string[];
  logger?: RunContextLogger;
  cwd?: string;
  fileAwareness?: FileAwarenessTracker;
};

function normalizeActiveSkills(activeSkills?: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of activeSkills ?? []) {
    const name = value.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push(name);
  }

  return normalized;
}

export class RunContext {
  readonly messages: ChatMessage[] = [];
  readonly tools = new ToolRegistry();
  readonly prompts = new PromptRegistry();
  readonly hooks = new HookRegistry();
  readonly session = new Map<string, unknown>();
  readonly mcpServers: McpServerConfig[] = [];
  readonly activeSkills: string[];
  readonly fileAwareness: FileAwarenessTracker;
  readonly abortController = new AbortController();
  readonly childRuns = new Set<Promise<unknown>>();

  readonly #logger: RunContextLogger;
  readonly #disposeHooks: DisposeHook[] = [];

  #disposing?: Promise<void>;
  #disposed = false;

  constructor(options: CreateRunContextOptions = {}) {
    this.activeSkills = normalizeActiveSkills(options.activeSkills);
    this.#logger = options.logger ?? console;
    this.fileAwareness =
      options.fileAwareness ?? createFileAwarenessTracker(options.cwd ?? process.cwd());
  }

  get logger(): RunContextLogger {
    return this.#logger;
  }

  registerDisposeHook(hook: DisposeHook): void {
    this.#disposeHooks.push(hook);
  }

  trackChildRun<T>(childRun: Promise<T>): Promise<T> {
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

  getChildRunCount(): number {
    return this.childRuns.size;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    if (this.#disposing) {
      return this.#disposing;
    }

    this.#disposing = this.#disposeInternal();

    try {
      await this.#disposing;
      this.#disposed = true;
      this.#disposeHooks.length = 0;
      this.childRuns.clear();
    } finally {
      this.#disposing = undefined;
    }
  }

  async #disposeInternal(): Promise<void> {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }

    const errors: unknown[] = [];
    const failedHooks: DisposeHook[] = [];

    for (let index = this.#disposeHooks.length - 1; index >= 0; index -= 1) {
      const hook = this.#disposeHooks[index];
      if (!hook) {
        continue;
      }

      try {
        await hook();
      } catch (error) {
        errors.push(error);
        failedHooks.unshift(hook);
        this.#logger.error("Dispose hook failed.", error);
      }
    }

    this.#disposeHooks.splice(0, this.#disposeHooks.length, ...failedHooks);

    if (errors.length > 0) {
      throw new AggregateError(errors, "RunContext disposal failed.");
    }
  }
}

export function createRunContext(options?: CreateRunContextOptions): RunContext {
  return new RunContext(options);
}
