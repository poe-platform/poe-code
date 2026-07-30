import type { KeypressEvent } from "../dashboard/terminal.js";
import type { Action, DetailItem, Row } from "./state.js";

export type Effect =
  | { type: "renderDetail"; rowId: string; token: number }
  | { type: "exit"; result: unknown; after?: () => Promise<void> }
  | { type: "suspend"; fn: () => Promise<unknown>; resumeWith: (value: unknown) => ExplorerEvent }
  | { type: "persistOrder"; movedId: string; orderedIds: string[] };

export type ExplorerEvent =
  | { type: "key"; key: KeypressEvent }
  | { type: "resize"; cols: number; rows: number }
  | { type: "rowsLoaded"; rows: Row[] }
  | { type: "detailLoading"; rowId: string; token: number }
  | { type: "detailLoaded"; rowId: string; token: number; items: DetailItem[] }
  | { type: "detailItemRendered"; rowId: string; token: number; itemIndex: number; content: string }
  | { type: "detailError"; rowId: string; token: number; error: Error }
  | { type: "actionResolved"; actionId: string }
  | { type: "toastExpired" }
  | { type: "suspendResumed"; value: unknown; emit: ExplorerEvent }
  | { type: "modalOpened"; title: string; content: string }
  | { type: "modalDismissed"; result: unknown };

export type ConfirmModal = {
  kind: "confirm";
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  action?: Action<unknown>;
  rows?: Row[];
  resolver: (ok: boolean) => void;
};
