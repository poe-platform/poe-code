import { canonicalizeBinding, createKeymap } from "../dashboard/keymap.js";
import type { KeypressEvent } from "../dashboard/terminal.js";
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

export interface ResolvedBindings {
  bindings: ReadonlyMap<string, BindingTarget>;
  keysByTarget: ReadonlyMap<string, readonly string[]>;
  resolve: (event: KeypressEvent) => BindingTarget | undefined;
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
  pageUp: ["Ctrl+u"],
  pageDown: ["Ctrl+d"],
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
  reorderUp: ["Ctrl+up", "K"],
  reorderDown: ["Ctrl+down", "J"]
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
const reservedActionIds = new Set<string>(["quit"]);

export function resolveBindings<R>(
  config: ExplorerConfig<R>,
  defaults: ExplorerBindingDefaults = {}
): ResolvedBindings {
  const commands = config.reorder === undefined
    ? baseBuiltinCommands
    : [...baseBuiltinCommands, ...reorderCommands];
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
  const resolveCommand = createKeymap<string>(undefined, {
    commands: commandIds,
    defaultBindings: defaultKeymapBindings
  });

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
