import type { ExplorerEvent } from "./explorer-events.js";
import type { ExplorerConfig } from "./explorer-types.js";

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

export declare function resolveBindings<R>(config: ExplorerConfig<R>, defaults?: ExplorerBindingDefaults): ResolvedBindings;
export declare function assertNoBareLetterBindings<R>(config: ExplorerConfig<R>): void;
export declare function assertAcceleratorsFree<R>(config: ExplorerConfig<R>): void;
export declare function keymapToHelp<R>(config: ExplorerConfig<R>): HelpSection[];
