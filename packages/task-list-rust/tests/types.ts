import * as original from "@poe-code/task-list";
import * as own from "../dist/index.js";
const events: typeof original.eventsFromState = own.eventsFromState;
const reverseEvents: typeof own.eventsFromState = original.eventsFromState;
const find: typeof original.findEvent = own.findEvent;
const reverseFind: typeof own.findEvent = original.findEvent;
const validate: typeof original.validateMachine = own.validateMachine;
const transition: typeof original.assertTransition = own.assertTransition;
const reverseTransition: typeof own.assertTransition = original.assertTransition;
const machine: typeof original.defaultStateMachine = own.defaultStateMachine;
const task: original.Task = {} as own.Task;
const list: own.TaskList = {} as original.TaskList;
void [
  events,
  reverseEvents,
  find,
  reverseFind,
  validate,
  transition,
  reverseTransition,
  machine,
  task,
  list
];
const open: typeof original.openTaskList = own.openTaskList;
const reverseOpen: typeof own.openTaskList = original.openTaskList;
const verify: typeof original.verifyGhProject = own.verifyGhProject;
const reverseVerify: typeof own.verifyGhProject = original.verifyGhProject;
const sync: typeof original.syncGhProject = own.syncGhProject;
const reverseSync: typeof own.syncGhProject = original.syncGhProject;
const auth: typeof original.resolveAuth = own.resolveAuth;
const reverseAuth: typeof own.resolveAuth = original.resolveAuth;
const deps: original.GhIssuesBackendDeps = {} as own.GhIssuesBackendDeps;
const reverseDeps: own.GhIssuesBackendDeps = {} as original.GhIssuesBackendDeps;
const error: original.GhProjectSyncError = {} as own.GhProjectSyncError;
void [
  open,
  reverseOpen,
  verify,
  reverseVerify,
  sync,
  reverseSync,
  auth,
  reverseAuth,
  deps,
  reverseDeps,
  error
];
const move: typeof original.moveTasks = own.moveTasks;
const reverseMove: typeof own.moveTasks = original.moveTasks;
void [move, reverseMove];
const fullForward: typeof original = own;
const fullReverse: typeof own = original;
void [fullForward, fullReverse];
