import type {
  AgentTraceFileSystem,
  AgentTraceSource,
  NormalizedTrace,
  SqliteTraceDatabaseFactory,
  TraceReference
} from "@poe-code/agent-traces";

export interface ListTracesOptions {
  cwd: string;
  homeDir: string;
  fs: AgentTraceFileSystem;
  sources?: AgentTraceSource[];
  allWorkspaces?: boolean;
  since?: Date;
  limit?: number;
  sqlite?: SqliteTraceDatabaseFactory;
}

export interface LoadTraceOptions {
  fs: AgentTraceFileSystem;
  signal?: AbortSignal;
  cacheDir?: string;
  deferExactTokens?: boolean;
  onExactBreakdown?: (breakdown: ContextBreakdown) => void;
}

export interface ContextUsage {
  tokens: number;
  window: number;
  percent: number;
  source: "reported" | "estimated";
}

export interface ContextBreakdownItem {
  name: string;
  tokens: number;
  count: number;
}

export interface ContextBreakdownCategory {
  id: string;
  label: string;
  tokens: number;
  percent: number;
  items: ContextBreakdownItem[];
}

export interface ContextBreakdown {
  measuredTokens: number;
  categories: ContextBreakdownCategory[];
  source: "exact" | "estimated";
}

export type TraceView = NormalizedTrace & {
  context: ContextUsage;
  breakdown: ContextBreakdown;
};

export interface SubagentSummary {
  reference: TraceReference;
  context: ContextUsage;
  turnCount: number;
}
