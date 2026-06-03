import type { StateMachineDef } from "@poe-code/task-list";

export type ApprovalState =
  | "pending"
  | "prompting"
  | "approved-running"
  | "approved-done"
  | "approved-failed"
  | "declined";

export type ApprovalEvent = "claim" | "start" | "succeed" | "fail" | "decline";

const approvalStateMachineDefinition: StateMachineDef<ApprovalState, ApprovalEvent> = {
  initial: "pending",
  states: ["pending", "prompting", "approved-running", "approved-done", "approved-failed", "declined"],
  events: {
    claim: { from: ["pending"], to: "prompting" },
    start: { from: ["prompting"], to: "approved-running" },
    succeed: { from: ["approved-running"], to: "approved-done" },
    fail: { from: ["prompting", "approved-running"], to: "approved-failed" },
    decline: { from: ["pending", "prompting"], to: "declined" },
  },
};

Object.freeze(approvalStateMachineDefinition.states);
for (const event of Object.values(approvalStateMachineDefinition.events)) {
  Object.freeze(event.from);
  Object.freeze(event);
}
Object.freeze(approvalStateMachineDefinition.events);

export const approvalStateMachine = Object.freeze(approvalStateMachineDefinition);
