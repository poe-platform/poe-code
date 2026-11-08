export { moveTasks } from "./move.js";
export { openTaskList } from "./open.js";
export { assertEvent, assertTransition, defaultStateMachine, type TaskEvent } from "./state.js";
export {
  eventsFromState,
  findEvent,
  validateMachine,
  type EventDef,
  type StateMachineDef
} from "./state-machine.js";
export * from "./types.js";
export { resolveAuth } from "./backends/gh-issues-client.js";
export type {
  GhClient,
  GhClientOptions,
  ResolveAuthOptions,
  ResolveEndpointOptions
} from "./backends/gh-issues-client.js";
export type { GhIssuesBackendDeps } from "./backends/gh-issues.js";
export {
  GhProjectSyncError,
  syncGhProject,
  verifyGhProject,
  type SyncGhProjectOptions,
  type SyncGhProjectReport,
  type VerifyGhProjectOptions,
  type VerifyGhProjectReport
} from "./backends/gh-issues-sync.js";
