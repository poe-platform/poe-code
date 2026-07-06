import type { ExplorerEvent } from "./events.js";
import type { ExplorerConfig } from "./state.js";

export type ExplorerBuiltinCommand =
  | "quit"
  | "filter"
  | "help"
  | "palette"
  | "cursorUp"
  | "cursorDown"
  | "top"
  | "bottom"
  | "pageUp"
  | "pageDown"
  | "focusNext"
  | "escape"
  | "confirm"
  | "toggleSelect"
  | "selectAll"
  | "clearSelection"
  | "detailScrollDown"
  | "detailScrollUp"
  | "extendSelectionUp"
  | "extendSelectionDown"
  | "reorderUp"
  | "reorderDown";

export type BindingTarget =
  | { type: "builtin"; id: ExplorerBuiltinCommand }
  | { type: "action"; id: string };

type ExplorerKeypressEvent = Extract<ExplorerEvent, { type: "key" }>["key"];

type Binding = {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  name?: string;
  ch?: string;
  sequence?: string;
};

export interface ResolvedBindings {
  bindings: ReadonlyMap<string, BindingTarget>;
  keysByTarget: ReadonlyMap<string, readonly string[]>;
  resolve: (event: ExplorerKeypressEvent) => BindingTarget | undefined;
}

export type ExplorerBindingDefaults = Partial<Record<ExplorerBuiltinCommand, string[]>>;

const builtinBindings: Record<ExplorerBuiltinCommand, string[]> = {
  quit: ["q", "Ctrl+c"],
  filter: ["/"],
  help: ["?"],
  palette: ["Ctrl+p", "Ctrl+k"],
  cursorUp: ["up", "k"],
  cursorDown: ["down", "j"],
  top: ["home", "gg"],
  bottom: ["end", "G"],
  pageUp: ["pageup", "Ctrl+u"],
  pageDown: ["pagedown", "Ctrl+d"],
  focusNext: ["tab"],
  escape: ["escape"],
  confirm: ["return", "enter"],
  toggleSelect: ["space"],
  selectAll: ["Ctrl+a"],
  clearSelection: ["Ctrl+/"],
  detailScrollDown: ["Ctrl+f"],
  detailScrollUp: ["Ctrl+b"],
  extendSelectionUp: ["Shift+up"],
  extendSelectionDown: ["Shift+down"],
  reorderUp: ["Shift+up", "K"],
  reorderDown: ["Shift+down", "J"]
};

const baseBuiltinCommands: ExplorerBuiltinCommand[] = [
  "quit",
  "filter",
  "help",
  "palette",
  "cursorUp",
  "cursorDown",
  "top",
  "bottom",
  "pageUp",
  "pageDown",
  "focusNext",
  "escape",
  "confirm",
  "toggleSelect",
  "selectAll",
  "clearSelection",
  "detailScrollDown",
  "detailScrollUp",
  "extendSelectionUp",
  "extendSelectionDown"
];

const reorderCommands: ExplorerBuiltinCommand[] = ["reorderUp", "reorderDown"];
const selectionCommands = new Set<ExplorerBuiltinCommand>([
  "toggleSelect",
  "selectAll",
  "clearSelection",
  "extendSelectionUp",
  "extendSelectionDown"
]);
const reservedActionIds = new Set<string>(["quit"]);

export function resolveBindings<R>(
  config: ExplorerConfig<R>,
  defaults: ExplorerBindingDefaults = {}
): ResolvedBindings {
  const baseCommands =
    config.reorder === undefined
      ? baseBuiltinCommands
      : [
          ...baseBuiltinCommands.filter((command) =>
            command !== "extendSelectionUp" && command !== "extendSelectionDown"
          ),
          ...reorderCommands
        ];
  const commands =
    config.multiSelect === false
      ? baseCommands.filter((command) => !selectionCommands.has(command))
      : baseCommands;
  const commandBindings = new Map<string, string[]>();
  const flatBindings = new Map<string, BindingTarget>();
  const targetKeys = new Map<string, string[]>();
  const targetsByCommand = new Map<string, BindingTarget>();
  const claimed = new Map<string, string>();
  const conflicts = new Map<string, string>();

  for (const command of commands) {
    const target: BindingTarget = { type: "builtin", id: command };
    const keys = command === "quit"
      ? builtinBindings.quit
      : defaults[command] ?? builtinBindings[command];
    addBindings({
      keys,
      owner: command,
      commandId: `builtin:${command}`,
      target,
      commandBindings,
      flatBindings,
      targetKeys,
      targetsByCommand,
      claimed,
      conflicts,
      warn: false
    });
  }

  for (const action of [...config.actions, ...(config.detail.actions ?? [])]) {
    if (reservedActionIds.has(action.id)) {
      continue;
    }

    const keys = toBindingArray(config.keybindOverrides?.[action.id] ?? action.key);
    addBindings({
      keys,
      owner: action.id,
      commandId: `action:${action.id}`,
      target: { type: "action", id: action.id },
      commandBindings,
      flatBindings,
      targetKeys,
      targetsByCommand,
      claimed,
      conflicts,
      warn: true
    });
  }

  if (process.env.NODE_ENV !== "production") {
    for (const warning of conflicts.values()) {
      process.stderr.write(`${warning}\n`);
    }
  }

  const commandIds = Array.from(commandBindings.keys());
  const defaultKeymapBindings = Object.fromEntries(
    Array.from(commandBindings.entries())
  ) as Record<string, readonly string[]>;
  const resolveCommand = createKeymap(commandIds, defaultKeymapBindings);

  return {
    bindings: flatBindings,
    keysByTarget: targetKeys,
    resolve: (event) => {
      const command = resolveCommand(event);
      return command === undefined ? undefined : targetsByCommand.get(command);
    }
  };
}

function addBindings(opts: {
  keys: readonly string[];
  owner: string;
  commandId: string;
  target: BindingTarget;
  commandBindings: Map<string, string[]>;
  flatBindings: Map<string, BindingTarget>;
  targetKeys: Map<string, string[]>;
  targetsByCommand: Map<string, BindingTarget>;
  claimed: Map<string, string>;
  conflicts: Map<string, string>;
  warn: boolean;
}): string[] {
  const accepted: string[] = [];

  for (const key of opts.keys) {
    const canonical = canonicalizeBinding(key);
    if (canonical === undefined) {
      continue;
    }

    const existing = opts.claimed.get(canonical);
    if (existing !== undefined) {
      if (existing !== opts.owner && opts.warn) {
        opts.conflicts.set(
          `${opts.owner}:${canonical}`,
          `Explorer key binding conflict: ${key} for ${opts.owner} is already bound to ${existing}`
        );
      }
      continue;
    }

    opts.claimed.set(canonical, opts.owner);
    opts.flatBindings.set(canonical, opts.target);
    accepted.push(key);
  }

  if (accepted.length > 0) {
    opts.commandBindings.set(opts.commandId, accepted);
    opts.targetKeys.set(targetKey(opts.target), accepted);
    opts.targetsByCommand.set(opts.commandId, opts.target);
  }

  return accepted;
}

function targetKey(target: BindingTarget): string {
  return `${target.type}:${target.id}`;
}

function toBindingArray(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function createKeymap<TCommand extends string>(
  commands: readonly TCommand[],
  defaultBindings: Record<TCommand, readonly string[]>
): (event: ExplorerKeypressEvent) => TCommand | undefined {
  const bindings = new Map<TCommand, Binding[]>();
  const sequences = new Set<string>();
  let pendingSequence = "";

  for (const command of commands) {
    const commandBindings = defaultBindings[command]
      .map(parseBinding)
      .filter((binding): binding is Binding => binding !== undefined);

    for (const binding of commandBindings) {
      if (binding.sequence !== undefined) {
        sequences.add(binding.sequence);
      }
    }

    bindings.set(command, commandBindings);
  }

  return (event) => {
    for (const command of commands) {
      const commandBindings = bindings.get(command);
      if (commandBindings?.some((binding) => matchesSingleKey(binding, event))) {
        pendingSequence = "";
        return command;
      }
    }

    const token = eventToSequenceToken(event);
    if (token === undefined) {
      pendingSequence = "";
      return undefined;
    }

    pendingSequence = `${pendingSequence}${token}`;

    for (const command of commands) {
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
  };
}

function canonicalizeBinding(binding: string): string | undefined {
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

function matchesSingleKey(binding: Binding, event: ExplorerKeypressEvent): boolean {
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
    if (binding.ch === " " && event.name === "space") {
      return true;
    }

    return event.ch === binding.ch || event.name === binding.ch.toLowerCase();
  }

  if (binding.name !== undefined) {
    return event.name === binding.name;
  }

  return false;
}

function eventToSequenceToken(event: ExplorerKeypressEvent): string | undefined {
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
