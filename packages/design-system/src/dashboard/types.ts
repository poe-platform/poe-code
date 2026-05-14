export type OutputItemKind = "info" | "success" | "error" | "tool" | "status";

export type OutputItem = {
  kind: OutputItemKind;
  text: string;
  ts: number;
};

export type DashboardStats = {
  status: "idle" | "running" | "paused" | "done" | "error";
  iterations: number;
  iterationsLabel?: string;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  currentAction?: string;
};

export type Command = "quit" | "forceQuit" | "edit" | "pause" | "retry" | "view-log";

export type DashboardState = {
  output: OutputItem[];
  stats: DashboardStats;
};

export type CellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
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
