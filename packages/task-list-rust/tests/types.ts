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
