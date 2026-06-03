import type { StateMachineDef } from "@poe-code/task-list";

export type MaestroTaskState =
  | "queued"
  | "agent-running"
  | "human-review"
  | "done"
  | "failed"
  | "archived";

export type MaestroTaskEvent = "start" | "complete" | "handoff" | "accept" | "fail" | "archive";

export const maestroTaskStateMachine: StateMachineDef<MaestroTaskState, MaestroTaskEvent> = Object.freeze({
  initial: "queued",
  states: Object.freeze(["queued", "agent-running", "human-review", "done", "failed", "archived"] satisfies MaestroTaskState[]),
  events: Object.freeze({
    start: Object.freeze({ from: Object.freeze(["queued"] satisfies MaestroTaskState[]), to: "agent-running" }),
    complete: Object.freeze({ from: Object.freeze(["agent-running"] satisfies MaestroTaskState[]), to: "done" }),
    handoff: Object.freeze({ from: Object.freeze(["agent-running"] satisfies MaestroTaskState[]), to: "human-review" }),
    accept: Object.freeze({ from: Object.freeze(["human-review"] satisfies MaestroTaskState[]), to: "done" }),
    fail: Object.freeze({ from: Object.freeze(["agent-running", "human-review"] satisfies MaestroTaskState[]), to: "failed" }),
    archive: Object.freeze({ from: Object.freeze(["done", "failed"] satisfies MaestroTaskState[]), to: "archived" }),
  }),
});
