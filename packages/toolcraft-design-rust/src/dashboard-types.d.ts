export type OutputItemKind = "info" | "success" | "error" | "tool" | "status";

export type OutputItem = {
  /** Reusing an id replaces its retained preview in place, without changing held history. */
  id?: string;
  kind: OutputItemKind;
  text: string;
  ts: number;
  role?: "agent" | "reasoning" | "action" | "user" | "plan";
  detail?: string;
};

export type DashboardWorkStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";

export type DashboardQueueItem = Readonly<{
  id: string;
  status: DashboardWorkStatus;
} & (
  | { kind: "plan"; path: string }
  | { kind: "message"; text: string; afterPlanId: string }
)>;

export type DashboardTask = {
  id: string;
  title: string;
  status: DashboardWorkStatus;
  steps?: Array<{ name: string; status: DashboardWorkStatus }>;
};

export type DashboardRunState = {
  agent?: string;
  model?: string;
  cwd?: string;
  phase?: string;
  activity?: string;
  activePlanId?: string;
  activeTaskId?: string;
  activeStep?: string;
  queue?: readonly DashboardQueueItem[];
  tasks?: readonly DashboardTask[];
};

export type DashboardStats = {
  status: "idle" | "running" | "paused" | "done" | "error";
  iterations: number;
  iterationsLabel?: string;
  iterationsTotal?: number;
  context?: string[];
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  currentAction?: string;
  session?: { cwd: string; agent: string; model?: string };
  usageAvailable?: boolean;
  run?: DashboardRunState;
};

export type Command =
  | "quit"
  | "forceQuit"
  | "edit"
  | "pause"
  | "retry"
  | "view-log"
  | "scroll-up"
  | "scroll-down"
  | "page-up"
  | "page-down"
  | "follow"
  | "render-stats";

export type DashboardState = {
  output: OutputItem[];
  stats: DashboardStats;
};

export type CellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
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
