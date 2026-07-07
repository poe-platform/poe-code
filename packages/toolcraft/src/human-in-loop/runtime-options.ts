import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import type { TaskList } from "@poe-code/task-list";
import type { HumanInLoopRuntime } from "./types.js";

/** The concrete runtime built by `createHumanInLoop` — carries its options for the approvals built-ins. */
export interface HumanInLoopRuntimeInstance extends HumanInLoopRuntime {
  readonly runtimeOptions: HumanInLoopRuntimeOptions;
}

export interface HumanInLoopRuntimeOptions {
  provider: HumanInLoopProvider;
  taskList?:
    | TaskList
    | {
        dir: string;
        format: "markdown-dir" | "yaml-file";
      };
  listName?: string;
  binPath?: {
    execPath: string;
    entryArgs: readonly string[];
  };
}
