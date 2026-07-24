import type {
  AgentTraceFileSystem,
  AgentTraceSource,
  NormalizedTrace,
  SqliteTraceDatabaseFactory,
  TraceReference
} from "@poe-code/agent-traces";

export type TraceIndexMode = "sync" | "background" | "off";

export interface ListTracesOptions {
  cwd: string;
  homeDir: string;
  fs: AgentTraceFileSystem;
  sources?: AgentTraceSource[];
  allWorkspaces?: boolean;
  since?: Date;
  limit?: number;
  sqlite?: SqliteTraceDatabaseFactory;
  index?: TraceIndexMode;
  indexDir?: string;
  rebuildIndex?: boolean;
  onIndexProgress?: (progress: { scannedDirs: number; headReads: number }) => void;
  onIndexUpdate?: (references: TraceReference[]) => void;
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

export interface TraceTreeNode {
  view: TraceView;
  children: TraceTreeNode[];
  /** Present for child nodes (the reference used to load this node). */
  reference?: TraceReference;
  unavailable?: {
    reference: TraceReference;
    reason: string;
  };
}

export interface LoadTraceTreeOptions extends LoadTraceOptions {
  maxDepth?: number;
  maxNodes?: number;
}
