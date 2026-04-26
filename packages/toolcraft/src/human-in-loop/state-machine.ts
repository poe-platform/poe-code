import type { StateMachineDef } from "@poe-code/task-list";

export type ApprovalState =
  | "pending"
  | "approved-running"
  | "approved-done"
  | "approved-failed"
  | "declined";

export type ApprovalEvent = "start" | "succeed" | "fail" | "decline";

export const approvalStateMachine: StateMachineDef<ApprovalState, ApprovalEvent> = {
  initial: "pending",
  states: ["pending", "approved-running", "approved-done", "approved-failed", "declined"],
  events: {
    start: { from: ["pending"], to: "approved-running" },
    succeed: { from: ["approved-running"], to: "approved-done" },
    fail: { from: ["approved-running"], to: "approved-failed" },
    decline: { from: ["pending"], to: "declined" },
  },
};
