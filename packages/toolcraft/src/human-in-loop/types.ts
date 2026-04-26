import type { ObjectSchema, Static } from "toolcraft-schema";
import { UserError } from "../user-error.js";

type HumanInLoopProvider = {
  readonly id: string;
  requestApproval(request: {
    message: string;
    declineInputPrompt?: string;
  }): Promise<{ outcome: "approved" } | { outcome: "declined"; reason?: string }>;
};

type HumanInLoopTaskList = {
  list(name: string): {
    all(filter?: { state?: string; includeArchived?: boolean }): Promise<unknown[]>;
    get(id: string): Promise<unknown>;
    create(input: {
      id: string;
      name: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }): Promise<unknown>;
    fire(id: string, event: string, opts?: { metadataPatch?: Record<string, unknown> }): Promise<unknown>;
    canFire(id: string, event: string): Promise<boolean>;
    events(id: string): Promise<readonly string[]>;
  };
  lists(): Promise<string[]>;
  allTasks(filter?: { state?: string; includeArchived?: boolean }): Promise<unknown[]>;
  get(qualifiedId: string): Promise<unknown>;
};

export interface HumanInLoopConfig<TParamsSchema extends ObjectSchema<any>> {
  mode: "sync" | "async";
  message: (ctx: { params: Static<TParamsSchema>; commandPath: string }) => string;
  declineInputPrompt?: string;
}

export interface HumanInLoopRuntimeOptions {
  provider?: HumanInLoopProvider;
  taskList?:
    | HumanInLoopTaskList
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
