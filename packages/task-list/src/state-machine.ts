import type { Task } from "./types.js";

export interface StateMachineDef<TState extends string = string, TEvent extends string = string> {
  readonly initial: TState;
  readonly states: readonly TState[];
  readonly events: Readonly<Record<TEvent, EventDef<TState>>>;
}

export interface EventDef<TState extends string = string> {
  readonly from: readonly TState[] | "*";
  readonly to: TState;
  readonly guard?: (task: Task) => true | string;
  readonly onEnter?: (task: Task) => void | Promise<void>;
  readonly onExit?: (task: Task) => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStateList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function canFireFromState<TState extends string>(event: EventDef<TState>, fromState: string): boolean {
  if (event.from === "*") {
    return event.to !== fromState;
  }

  return event.from.includes(fromState as TState);
}

export function validateMachine(machine: StateMachineDef): void {
  if (!isRecord(machine)) {
    throw new TypeError("State machine must be an object.");
  }

  if (!isStateList(machine.states)) {
    throw new TypeError("State machine states must be a string array.");
  }

  const states = new Set(machine.states);

  if (typeof machine.initial !== "string") {
    throw new TypeError("State machine initial must be a string.");
  }

  if (!states.has(machine.initial)) {
    throw new Error(`Initial state "${machine.initial}" is not declared.`);
  }

  if (!isRecord(machine.events)) {
    throw new TypeError("State machine events must be an object.");
  }

  for (const [eventName, event] of Object.entries(machine.events)) {
    if (!isRecord(event)) {
      throw new TypeError(`Event "${eventName}" must be an object.`);
    }

    if (event.from !== "*" && !isStateList(event.from)) {
      throw new TypeError(`Event "${eventName}" has an invalid "from" definition.`);
    }

    if (typeof event.to !== "string") {
      throw new TypeError(`Event "${eventName}" target state must be a string.`);
    }

    if (!states.has(event.to)) {
      throw new Error(`Event "${eventName}" references unknown target state "${event.to}".`);
    }

    if (event.from !== "*") {
      for (const fromState of event.from) {
        if (!states.has(fromState)) {
          throw new Error(`Event "${eventName}" references unknown source state "${fromState}".`);
        }
      }
    }
  }
}

export function eventsFromState<TState extends string, TEvent extends string>(
  machine: StateMachineDef<TState, TEvent>,
  fromState: TState
): readonly TEvent[] {
  const events: TEvent[] = [];

  for (const [eventName, event] of Object.entries(machine.events) as Array<[TEvent, EventDef<TState>]>) {
    if (canFireFromState(event, fromState)) {
      events.push(eventName);
    }
  }

  return events;
}

export function findEvent<TState extends string, TEvent extends string>(
  machine: StateMachineDef<TState, TEvent>,
  fromState: TState,
  eventName: TEvent
): EventDef<TState> | undefined {
  const event = machine.events[eventName];

  if (event === undefined) {
    return undefined;
  }

  return canFireFromState(event, fromState) ? event : undefined;
}
