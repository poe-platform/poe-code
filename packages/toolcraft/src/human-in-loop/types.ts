import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import type { TaskList } from "@poe-code/task-list";
import type { ObjectSchema, Static } from "toolcraft-schema";
import { UserError } from "../user-error.js";

export interface HumanInLoopConfig<TParamsSchema extends ObjectSchema<any>> {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  plan?: (ctx: {
    params: Static<TParamsSchema>;
    commandPath: string;
  }) => unknown | Promise<unknown>;
  declineInputPrompt?: string;
}

export interface HumanInLoopRuntimeOptions {
  provider?: HumanInLoopProvider;
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

export interface HumanInLoopPending {
  status: "pending-approval";
  approvalId: string;
  message: string;
  enqueuedAt: string;
  planHash?: string;
}

export class ApprovalDeclinedError extends UserError {
  readonly reason?: string;
  readonly approvalId?: string;
  readonly commandPath: string;

  constructor(options: {
    commandPath: string;
    reason?: string;
    approvalId?: string;
  }) {
    super(options.reason === undefined ? "Declined." : `Declined: ${options.reason}`);
    this.name = "ApprovalDeclinedError";
    this.reason = options.reason;
    this.approvalId = options.approvalId;
    this.commandPath = options.commandPath;
  }
}

export type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
