export type AgentTraceSource = "claude" | "codex" | "pi" | "poe-code";

export interface AgentTraceFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, options?: { encoding?: BufferEncoding }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  stat(
    path: string
  ): Promise<{ isFile(): boolean; isDirectory(): boolean; mtime?: Date; size?: number }>;
}

export interface SqliteTraceDatabase {
  all(sql: string, params: unknown[]): unknown[] | Promise<unknown[]>;
  close(): void | Promise<void>;
}

export type SqliteTraceDatabaseFactory = (path: string) => Promise<SqliteTraceDatabase>;

export interface TraceDiscoverOptions {
  cwd?: string;
  homeDir: string;
  since?: Date;
  allWorkspaces?: boolean;
  fs: AgentTraceFileSystem;
  sqlite?: SqliteTraceDatabaseFactory;
}

export type TraceReadOptions = Pick<TraceDiscoverOptions, "fs">;

export interface TraceReference {
  source: AgentTraceSource;
  id: string;
  path?: string;
  cwd?: string;
  updatedAt?: Date;
  title?: string;
  agentType?: string;
  spawnDepth?: number;
  metadata?: Record<string, unknown>;
}

export interface NormalizedTrace {
  source: AgentTraceSource;
  id: string;
  path?: string;
  cwd?: string;
  title?: string;
  model?: string;
  contextWindow?: number;
  usage?: TraceUsage;
  createdAt?: Date;
  updatedAt?: Date;
  children?: TraceReference[];
  turns: NormalizedTraceTurn[];
}

export interface TraceUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  contextTokens: number;
  source: "reported";
}

export interface NormalizedTraceTurn {
  id?: string;
  role: "human" | "assistant" | "tool" | "system";
  text: string;
  timestamp?: Date;
  sourceKind?: string;
  toolName?: string;
  mcpServer?: string;
  skillName?: string;
}

export interface HumanPromptRecord {
  traceId: string;
  source: AgentTraceSource;
  cwd?: string;
  title?: string;
  timestamp?: string;
  text: string;
}

export interface CollectHumanPromptsOptions {
  sources?: AgentTraceSource[];
  cwd?: string;
  homeDir?: string;
  since?: Date;
  limit?: number;
  allWorkspaces?: boolean;
  fs?: AgentTraceFileSystem;
  sqlite?: SqliteTraceDatabaseFactory;
}

export interface CollectHumanPromptsResult {
  records: HumanPromptRecord[];
  traceCount: number;
}

export interface TraceReader {
  id: AgentTraceSource;
  defaultRoots(homeDir: string): string[];
  discover(options: TraceDiscoverOptions): Promise<TraceReference[]>;
  read(reference: TraceReference, options: TraceReadOptions): Promise<NormalizedTrace>;
}
