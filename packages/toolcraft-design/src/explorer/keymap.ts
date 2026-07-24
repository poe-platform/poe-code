import type { ExplorerEvent } from "./events.js";
import type { ExplorerConfig } from "./state.js";

export type ExplorerBuiltinCommand =
  | "quit" | "filter" | "help" | "palette" | "cursorUp" | "cursorDown" | "top" | "bottom"
  | "pageUp" | "pageDown" | "focusNext" | "escape" | "confirm"
  | "halfPageUp" | "halfPageDown"
  | "toggleSelect" | "selectAll" | "clearSelection" | "detailScrollDown" | "detailScrollUp" | "extendSelectionUp"
  | "extendSelectionDown" | "reorderUp" | "reorderDown";

export type BindingTarget = { type: "builtin"; id: ExplorerBuiltinCommand } | { type: "action"; id: string };
type Key = Extract<ExplorerEvent, { type: "key" }>["key"];

export interface ResolvedBindings {
  bindings: ReadonlyMap<string, BindingTarget>;
  keysByTarget: ReadonlyMap<string, readonly string[]>;
  resolve: (event: Key) => BindingTarget | undefined;
}

export type ExplorerBindingDefaults = Partial<Record<ExplorerBuiltinCommand, string[]>>;
export interface HelpSection { title: string; entries: Array<{ key: string; label: string }> }

const BUILTINS: Record<ExplorerBuiltinCommand, string[]> = {
  quit: ["Ctrl+c"],
  filter: [],
  help: [],
  palette: ["Ctrl+p"],
  cursorUp: ["up"],
  cursorDown: ["down"],
  top: ["home"],
  bottom: ["end"],
  pageUp: ["pageup"],
  pageDown: ["pagedown"],
  halfPageUp: ["Ctrl+u"],
  halfPageDown: ["Ctrl+d"],
  focusNext: ["tab"],
  escape: ["escape"],
  confirm: ["return", "enter"],
  toggleSelect: ["space"],
  selectAll: ["Ctrl+a"],
  clearSelection: ["Ctrl+/"],
  detailScrollDown: [],
  detailScrollUp: [],
  extendSelectionUp: ["Shift+up"],
  extendSelectionDown: ["Shift+down"],
  reorderUp: ["Shift+up"],
  reorderDown: ["Shift+down"]
};
const CORE_ACCELERATORS = new Set(["c", "u", "d", "p"]);

export function resolveBindings<R>(config: ExplorerConfig<R>, defaults: ExplorerBindingDefaults = {}): ResolvedBindings {
  assertNoBareLetterBindings(config);
  assertAcceleratorsFree(config);
  const bindings = new Map<string, BindingTarget>();
  const keysByTarget = new Map<string, string[]>();
  const commands = (Object.keys(BUILTINS) as ExplorerBuiltinCommand[]).filter(command => {
    if (config.multiSelect === false && ["toggleSelect", "selectAll", "clearSelection", "extendSelectionUp", "extendSelectionDown"].includes(command)) return false;
    if (config.reorder === undefined && (command === "reorderUp" || command === "reorderDown")) return false;
    if (config.reorder !== undefined && (command === "extendSelectionUp" || command === "extendSelectionDown")) return false;
    return true;
  });

  for (const command of commands) {
    const keys = command === "quit" ? BUILTINS.quit : (defaults[command] ?? BUILTINS[command]);
    add(keys, { type: "builtin", id: command }, bindings, keysByTarget);
  }
  for (const action of allActions(config)) {
    if (action.accelerator !== undefined) add([`Ctrl+${action.accelerator}`], { type: "action", id: action.id }, bindings, keysByTarget);
  }

  return {
    bindings,
    keysByTarget,
    resolve: event => bindings.get(eventKey(event))
  };
}

export function assertNoBareLetterBindings<R>(config: ExplorerConfig<R>): void {
  for (const action of allActions(config)) {
    const legacy = action.key === undefined ? [] : (Array.isArray(action.key) ? action.key : [action.key]);
    if (legacy.length > 0) throw new Error(`Explorer action ${action.id} uses a bare key; use accelerator instead`);
  }
  if (config.keybindOverrides !== undefined && Object.keys(config.keybindOverrides).length > 0) {
    throw new Error("Explorer keybind overrides are not supported because printable keys belong to filtering");
  }
}

export function assertAcceleratorsFree<R>(config: ExplorerConfig<R>): void {
  const claimed = new Map<string, string>();
  for (const action of allActions(config)) {
    if (action.accelerator === undefined) continue;
    const accelerator = action.accelerator.toLowerCase();
    if (accelerator.length !== 1 || accelerator < "a" || accelerator > "z") throw new Error(`Explorer action ${action.id} accelerator must be one letter`);
    if (CORE_ACCELERATORS.has(accelerator)) throw new Error(`Explorer action ${action.id} accelerator Ctrl+${accelerator.toUpperCase()} collides with a core key`);
    const owner = claimed.get(accelerator);
    if (owner !== undefined) throw new Error(`Explorer actions ${owner} and ${action.id} share Ctrl+${accelerator.toUpperCase()}`);
    claimed.set(accelerator, action.id);
  }
}

export function keymapToHelp<R>(config: ExplorerConfig<R>): HelpSection[] {
  return [
    { title: "Navigation", entries: [
      { key: "↑/↓", label: "move" }, { key: "PgUp/PgDn", label: "page" },
      { key: "Home/End", label: "first/last" }, { key: "Tab", label: "focus" }
    ] },
    { title: "Actions", entries: [
      { key: "Enter", label: "actions" }, { key: "Ctrl+P", label: "palette" },
      ...allActions(config).filter(action => action.accelerator !== undefined).map(action => ({ key: `Ctrl+${action.accelerator!.toUpperCase()}`, label: typeof action.label === "string" ? action.label : action.id }))
    ] },
    { title: "General", entries: [{ key: "Esc", label: "clear/quit" }, { key: "Ctrl+C", label: "quit" }] }
  ];
}

function allActions<R>(config: ExplorerConfig<R>) {
  const actions = [...config.actions, ...(config.detail?.actions ?? [])];
  return [...new Map(actions.map(action => [action.id, action])).values()];
}
function add(keys: string[], target: BindingTarget, bindings: Map<string, BindingTarget>, keysByTarget: Map<string, string[]>): void {
  const accepted: string[] = [];
  for (const key of keys) {
    const normalized = canonical(key);
    if (!bindings.has(normalized)) { bindings.set(normalized, target); accepted.push(key); }
  }
  if (accepted.length > 0) keysByTarget.set(`${target.type}:${target.id}`, accepted);
}
function canonical(value: string): string { return value.trim().toLowerCase().replace("control+", "ctrl+"); }
function eventKey(event: Key): string {
  const name = event.name ?? event.ch ?? "";
  const modifiers = [event.ctrl ? "ctrl" : "", event.meta ? "meta" : "", event.shift ? "shift" : ""].filter(Boolean);
  const normalized = name === "return" ? "return" : name.toLowerCase();
  return [...modifiers, normalized].join("+");
}
