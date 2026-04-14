export type OutputItemKind = "info" | "success" | "error" | "tool" | "status";

export type OutputItem = {
  kind: OutputItemKind;
  text: string;
  ts: number;
};

export type DashboardStats = {
  status: "idle" | "running" | "paused" | "done" | "error";
  iterations: number;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  currentAction?: string;
};

export type Command =
  | "quit"
  | "edit"
  | "pause"
  | "retry"
  | "scrollUp"
  | "scrollDown"
  | "pageUp"
  | "pageDown"
  | "scrollToTop"
  | "scrollToBottom";

export type DialogState =
  | { kind: "none" }
  | { kind: "edit"; initialValue: string };

export type DashboardState = {
  output: OutputItem[];
  outputScroll: number;
  autoFollow: boolean;
  stats: DashboardStats;
  paused: boolean;
  activeDialog: DialogState;
};

export type CellStyle = {
  fg?: string; // hex or chalk color name
  bg?: string;
  bold?: boolean;
  dim?: boolean;
};

export type Cell = {
  ch: string;
  style: CellStyle;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
