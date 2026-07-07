import type { ObjectSchema, Static } from "toolcraft-schema";
import type { Command, Group, HandlerContext } from "../index.js";
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

/**
 * The wired human-in-loop runtime. Core entrypoints only know this interface;
 * the implementation ships behind the `toolcraft/human-in-loop` export and is
 * created with `createHumanInLoop({ provider, ... })`.
 */
export interface HumanInLoopRuntime {
  invoke<T>(
    node: Command<any, any, any, T>,
    ctx: HandlerContext<any, any, any>,
    commandPath: string
  ): Promise<T | HumanInLoopPending>;
  mergeApprovalsGroup<TServices extends object>(root: Group<TServices>): Group<TServices>;
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
