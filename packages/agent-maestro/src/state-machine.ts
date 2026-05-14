import type { StateMachineDef } from "@poe-code/task-list";

export type MaestroTaskState =
  | "queued"
  | "agent-running"
  | "human-review"
  | "done"
  | "failed"
  | "archived";

export type MaestroTaskEvent = "start" | "complete" | "handoff" | "accept" | "fail" | "archive";

export const maestroTaskStateMachine: StateMachineDef<MaestroTaskState, MaestroTaskEvent> = {
  initial: "queued",
  states: ["queued", "agent-running", "human-review", "done", "failed", "archived"],
  events: {
    start: { from: ["queued"], to: "agent-running" },
    complete: { from: ["agent-running"], to: "done" },
    handoff: { from: ["agent-running"], to: "human-review" },
    accept: { from: ["human-review"], to: "done" },
    fail: { from: ["agent-running", "human-review"], to: "failed" },
    archive: { from: ["done", "failed"], to: "archived" },
  },
};
