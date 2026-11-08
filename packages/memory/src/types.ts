export type MemoryRoot = string;

export type PageFrontmatter = {
  name?: string;
  description?: string;
  lastTouchedAt?: string;
  sources?: SourceRef[];
};

export type SourceRef = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type ConfidenceVerb = "extracted" | "inferred" | "ambiguous";

export type ConfidenceTag =
  | { verb: "extracted"; source: SourceRef; note?: string }
  | { verb: "inferred"; confidence: number; source?: SourceRef; note?: string }
  | { verb: "ambiguous"; reason: string };

export type TaggedClaim = {
  tag: ConfidenceTag;
  body: string;
  lineNumber: number;
};

export type PageWithClaims = MemoryPage & {
  claims: TaggedClaim[];
};

export type MemoryPage = {
  relPath: string;
  frontmatter: PageFrontmatter;
  body: string;
  bytes: number;
  mtimeMs: number;
};

export type IndexEntry = {
  relPath: string;
  description: string;
};

export type LogVerb = "create" | "update" | "delete" | "ingest" | "lint";

export type LogEntry = {
  timestamp: string;
  verb: LogVerb;
  relPath?: string;
  detail: string;
};

export type MemoryDiff = {
  created: string[];
  updated: string[];
  deleted: string[];
};

export type MemorySnapshot = {
  pages: Record<string, string>;
};

export type SearchHit = {
  relPath: string;
  lineNumber: number;
  line: string;
};

export type IngestSource =
  | { kind: "file"; absPath: string }
  | { kind: "url"; url: string };

export type IngestOptions = {
  source: IngestSource;
  agent?: string;
  reason?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  force?: boolean;
  noCacheWrite?: boolean;
};

export type IngestResult = {
  diff: MemoryDiff;
  exitCode: number;
  durationMs: number;
  cacheHit: boolean;
  tokens: TokenStats;
};

export type IngestCacheKey = string;

export type IngestCacheEntry = {
  key: IngestCacheKey;
  ingestedAt: string;
  sourceLabel: string;
  diff: MemoryDiff;
  exitCode: number;
  durationMs: number;
  memoryTokens: number;
  sourceTokens: number;
  promptTemplateVersion: string;
  agentId: string;
};

export type TokenStats = {
  memoryTokens: number;
  sourceTokens: number;
  reductionRatio: number;
  missingSources: string[];
};

export type MemoryInstallResult = {
  skillInstalled: boolean;
  mcpConfigured: boolean;
  skillPath?: string;
  mcpConfigPath?: string;
};

export type QueryOptions = {
  question: string;
  budget: number;
  agent?: string;
  model?: string;
  /** Kill the agent after this many ms without output. Defaults to 10 minutes. */
  activityTimeoutMs?: number;
};

export type QueryCitation = {
  relPath: string;
  section?: string;
  confidence: ConfidenceVerb;
};

export type QueryResult = {
  answer: string;
  citations: QueryCitation[];
  tokensUsed: number;
  budget: number;
  exitCode: number;
};

export type ExplainResult = QueryResult & {
  inboundPages: string[];
  outboundSources: SourceRef[];
};
