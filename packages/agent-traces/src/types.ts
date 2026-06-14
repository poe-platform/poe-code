export type AgentTraceSource = "claude" | "codex";

export interface AgentTraceFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, options?: { encoding?: BufferEncoding }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; mtime?: Date }>;
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
  metadata?: Record<string, unknown>;
}

export interface NormalizedTrace {
  source: AgentTraceSource;
  id: string;
  path?: string;
  cwd?: string;
  title?: string;
  createdAt?: Date;
  updatedAt?: Date;
  turns: NormalizedTraceTurn[];
}

export interface NormalizedTraceTurn {
  id?: string;
  role: "human" | "assistant" | "tool" | "system";
  text: string;
  timestamp?: Date;
  sourceKind?: string;
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
