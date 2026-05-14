import type { KeypressEvent } from "./terminal.js";
import type { Command } from "./types.js";

const commands: Command[] = ["forceQuit", "quit", "edit", "pause", "retry", "view-log"];

const defaultBindings: Record<Command, string[]> = {
  forceQuit: ["Ctrl+C"],
  quit: ["q"],
  edit: ["e"],
  pause: ["p"],
  retry: ["r"],
  "view-log": ["l"]
};

type Binding = {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  name?: string;
  ch?: string;
  sequence?: string;
};

export function createKeymap(
  overrides?: Partial<Record<Command, string[]>>
): (event: KeypressEvent) => Command | undefined;

export function createKeymap<TCommand extends string>(
  overrides: Partial<Record<TCommand, string[]>> | undefined,
  options: {
    commands: readonly TCommand[];
    defaultBindings: Record<TCommand, readonly string[]>;
  }
): (event: KeypressEvent) => TCommand | undefined;

export function createKeymap<TCommand extends string>(
  overrides?: Partial<Record<TCommand, string[]>>,
  options?: {
    commands: readonly TCommand[];
    defaultBindings: Record<TCommand, readonly string[]>;
  }
): (event: KeypressEvent) => TCommand | undefined {
  const resolvedCommands = options?.commands ?? (commands as unknown as readonly TCommand[]);
  const resolvedDefaults = options?.defaultBindings ?? (
    defaultBindings as unknown as Record<TCommand, readonly string[]>
  );
  const bindings = new Map<TCommand, Binding[]>();
  const sequences = new Set<string>();
  let pendingSequence = "";

  for (const command of resolvedCommands) {
    const keys = overrides?.[command] ?? resolvedDefaults[command];
    const commandBindings = keys
      .map(parseBinding)
      .filter((binding): binding is Binding => binding !== undefined);

    for (const binding of commandBindings) {
      if (binding.sequence !== undefined) {
        sequences.add(binding.sequence);
      }
    }

    bindings.set(command, commandBindings);
  }

  return (event: KeypressEvent) => {
    for (const command of resolvedCommands) {
      const commandBindings = bindings.get(command);
      if (commandBindings?.some((binding) => matchesSingleKey(binding, event))) {
        pendingSequence = "";
        return command;
      }
    }

    const sequenceCommand = resolveSequence(event);
    if (sequenceCommand !== undefined) {
      return sequenceCommand;
    }

    return undefined;
  };

  function resolveSequence(event: KeypressEvent): TCommand | undefined {
    const token = eventToSequenceToken(event);
    if (token === undefined) {
      pendingSequence = "";
      return undefined;
    }

    pendingSequence = `${pendingSequence}${token}`;

    for (const command of resolvedCommands) {
      const commandBindings = bindings.get(command);
      if (commandBindings?.some((binding) => binding.sequence === pendingSequence)) {
        pendingSequence = "";
        return command;
      }
    }

    if (hasSequencePrefix(sequences, pendingSequence)) {
      return undefined;
    }

    pendingSequence = token;

    if (hasSequencePrefix(sequences, pendingSequence)) {
      return undefined;
    }

    pendingSequence = "";
    return undefined;
  }
}

export function canonicalizeBinding(binding: string): string | undefined {
  const parsed = parseBinding(binding);
  if (parsed === undefined) {
    return undefined;
  }

  const modifiers = [
    parsed.ctrl ? "ctrl" : undefined,
    parsed.meta ? "meta" : undefined,
    parsed.shift ? "shift" : undefined
  ].filter((modifier): modifier is string => modifier !== undefined);
  const key = parsed.name ?? parsed.ch;
  if (parsed.sequence !== undefined) {
    return parsed.sequence.toLowerCase();
  }

  return key === undefined ? undefined : [...modifiers, key.toLowerCase()].join("+");
}

function parseBinding(binding: string): Binding | undefined {
  const value = binding.trim();
  if (value.length === 0) {
    return undefined;
  }

  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  let ctrl = false;
  let meta = false;
  let shift = false;
  const key = parts.at(-1);

  if (key === undefined) {
    return undefined;
  }

  for (const modifier of parts.slice(0, -1)) {
    const normalized = modifier.toLowerCase();

    if (normalized === "ctrl" || normalized === "control") {
      ctrl = true;
      continue;
    }

    if (normalized === "meta" || normalized === "alt") {
      meta = true;
      continue;
    }

    if (normalized === "shift") {
      shift = true;
      continue;
    }
  }

  const normalizedKey = normalizeKeyName(key);

  if (parts.length === 1 && isShiftedCharacter(normalizedKey)) {
    shift = true;
  }

  if (normalizedKey.length === 1) {
    return {
      ch: normalizeBindingCharacter(normalizedKey, shift),
      ctrl,
      meta,
      shift
    };
  }

  if (
    !ctrl &&
    !meta &&
    !shift &&
    !isNamedKey(normalizedKey) &&
    isPrintableSequence(normalizedKey)
  ) {
    return {
      sequence: normalizedKey,
      ctrl,
      meta,
      shift
    };
  }

  return {
    name: normalizedKey.toLowerCase(),
    ctrl,
    meta,
    shift
  };
}

function matchesSingleKey(binding: Binding, event: KeypressEvent): boolean {
  if (binding.sequence !== undefined) {
    return false;
  }

  if (
    binding.ctrl !== event.ctrl ||
    binding.meta !== event.meta ||
    binding.shift !== event.shift
  ) {
    return false;
  }

  if (binding.ch !== undefined) {
    return event.ch === binding.ch || event.name === binding.ch.toLowerCase();
  }

  if (binding.name !== undefined) {
    return event.name === binding.name;
  }

  return false;
}

function eventToSequenceToken(event: KeypressEvent): string | undefined {
  if (event.ctrl || event.meta || event.ch === undefined) {
    return undefined;
  }

  return event.ch;
}

function hasSequencePrefix(sequences: Set<string>, prefix: string): boolean {
  for (const sequence of sequences) {
    if (sequence.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function isShiftedCharacter(value: string): boolean {
  return value.length === 1 && value.toLowerCase() !== value && value.toUpperCase() === value;
}

function normalizeBindingCharacter(value: string, shift: boolean): string {
  if (!shift || value.toLowerCase() === value.toUpperCase()) {
    return value;
  }

  return value.toUpperCase();
}

function normalizeKeyName(value: string): string {
  if (value.toLowerCase() === "space") {
    return " ";
  }

  if (value === "↑") {
    return "up";
  }

  if (value === "↓") {
    return "down";
  }

  if (value === "←") {
    return "left";
  }

  if (value === "→") {
    return "right";
  }

  return value;
}

function isNamedKey(value: string): boolean {
  return namedKeys.has(value.toLowerCase());
}

function isPrintableSequence(value: string): boolean {
  if (Array.from(value).length <= 1) {
    return false;
  }

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) {
      return false;
    }
  }

  return true;
}

const namedKeys = new Set([
  "backspace",
  "delete",
  "down",
  "end",
  "enter",
  "escape",
  "home",
  "left",
  "pagedown",
  "pageup",
  "return",
  "right",
  "tab",
  "up"
]);
