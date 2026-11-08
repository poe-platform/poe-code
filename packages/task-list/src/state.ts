import {
  findEvent,
  type EventDef,
  type StateMachineDef
} from "./state-machine.js";
import { InvalidTransitionError, type TaskState } from "./types.js";

export type TaskEvent = "plan" | "start" | "complete" | "archive";

export const defaultStateMachine = {
  initial: "draft",
  states: ["draft", "planned", "in-progress", "done", "archived"],
  events: {
    plan: { from: ["draft"], to: "planned" },
    start: { from: ["planned"], to: "in-progress" },
    complete: { from: ["in-progress"], to: "done" },
    archive: { from: "*", to: "archived" }
  }
} as const satisfies StateMachineDef<TaskState, TaskEvent>;

Object.freeze(defaultStateMachine.states);
for (const event of Object.values(defaultStateMachine.events)) {
  if (event.from !== "*") {
    Object.freeze(event.from);
  }
  Object.freeze(event);
}
Object.freeze(defaultStateMachine.events);
Object.freeze(defaultStateMachine);

function deriveLegacyTransitions(
  machine: typeof defaultStateMachine
): Readonly<Record<TaskState, ReadonlySet<TaskState>>> {
  const transitions = Object.fromEntries(
    machine.states.map((state) => [state, new Set<TaskState>()])
  ) as Record<TaskState, Set<TaskState>>;

  for (const fromState of machine.states) {
    for (const eventName of Object.keys(machine.events) as TaskEvent[]) {
      const event = findEvent(machine, fromState, eventName);

      if (event !== undefined) {
        transitions[fromState].add(event.to);
      }
    }
  }

  const terminalState = machine.events.archive.to;
  const activeStates = machine.states.filter((state) => state !== terminalState);

  for (let index = 1; index < activeStates.length; index += 1) {
    transitions[activeStates[index]].add(activeStates[index - 1]);
  }

  return transitions;
}

const defaultTransitions = deriveLegacyTransitions(defaultStateMachine);

export function resolveStateMachine(
  stateMachine?: StateMachineDef
): StateMachineDef {
  return stateMachine ?? defaultStateMachine;
}

export function assertEvent<TState extends string, TEvent extends string>(
  machine: StateMachineDef<TState, TEvent>,
  fromState: TState,
  eventName: TEvent
): EventDef<TState> {
  const event = findEvent(machine, fromState, eventName);

  if (event === undefined) {
    throw new InvalidTransitionError(
      `Cannot fire event "${eventName}" from task state "${fromState}".`
    );
  }

  return event;
}

function canTransition(
  machine: StateMachineDef,
  fromState: string,
  toState: string
): boolean {
  if (Object.is(machine, defaultStateMachine)) {
    return defaultTransitions[fromState as TaskState]?.has(toState as TaskState) ?? false;
  }

  for (const eventName of Object.keys(machine.events)) {
    if (findEvent(machine, fromState, eventName)?.to === toState) {
      return true;
    }
  }

  return false;
}

export function assertTransition(from: TaskState, to: TaskState): void;
export function assertTransition<TState extends string, TEvent extends string>(
  machine: StateMachineDef<TState, TEvent>,
  from: TState,
  to: TState
): void;
export function assertTransition<TState extends string, TEvent extends string>(
  machineOrFrom: StateMachineDef<TState, TEvent> | TaskState,
  fromOrTo: TState | TaskState,
  maybeTo?: TState
): void {
  const machine =
    maybeTo === undefined
      ? defaultStateMachine
      : (machineOrFrom as StateMachineDef<TState, TEvent>);
  const fromState = maybeTo === undefined ? (machineOrFrom as TaskState) : (fromOrTo as TState);
  const toState = maybeTo === undefined ? (fromOrTo as TaskState) : maybeTo;

  if (!canTransition(machine, fromState, toState)) {
    throw new InvalidTransitionError(
      `Cannot transition task from "${fromState}" to "${toState}".`
    );
  }
}
