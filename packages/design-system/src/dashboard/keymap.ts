import type { KeypressEvent } from "./terminal.js";
import type { Command } from "./types.js";

const commands: Command[] = [
  "forceQuit",
  "quit",
  "edit",
  "pause",
  "retry",
  "scrollUp",
  "scrollDown",
  "pageUp",
  "pageDown",
  "scrollToTop",
  "scrollToBottom"
];

const defaultBindings: Record<Command, string[]> = {
  forceQuit: ["Ctrl+C"],
  quit: ["q"],
  edit: ["e"],
  pause: ["p"],
  retry: ["r"],
  scrollUp: ["up", "k"],
  scrollDown: ["down", "j"],
  pageUp: ["pageup"],
  pageDown: ["pagedown"],
  scrollToTop: ["home", "g"],
  scrollToBottom: ["end", "G", "f", "F"]
};

type Binding = {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  name?: string;
  ch?: string;
};

export function createKeymap(
  overrides?: Partial<Record<Command, string[]>>
): (event: KeypressEvent) => Command | undefined {
  const bindings = new Map<Command, Binding[]>();

  for (const command of commands) {
    const keys = overrides?.[command] ?? defaultBindings[command];
    bindings.set(
      command,
      keys
        .map(parseBinding)
        .filter((binding): binding is Binding => binding !== undefined)
    );
  }

  return (event: KeypressEvent) => {
    for (const command of commands) {
      const commandBindings = bindings.get(command);
      if (commandBindings?.some((binding) => matches(binding, event))) {
        return command;
      }
    }

    return undefined;
  };
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

  if (parts.length === 1 && isShiftedCharacter(key)) {
    shift = true;
  }

  if (key.length === 1) {
    return {
      ch: normalizeBindingCharacter(key, shift),
      ctrl,
      meta,
      shift
    };
  }

  return {
    name: key.toLowerCase(),
    ctrl,
    meta,
    shift
  };
}

function matches(binding: Binding, event: KeypressEvent): boolean {
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

function isShiftedCharacter(value: string): boolean {
  return value.length === 1 && value.toLowerCase() !== value && value.toUpperCase() === value;
}

function normalizeBindingCharacter(value: string, shift: boolean): string {
  if (!shift || value.toLowerCase() === value.toUpperCase()) {
    return value;
  }

  return value.toUpperCase();
}
