export type {
  ConfidenceTag,
  ConfidenceVerb,
  ExplainResult,
  IndexEntry,
  IngestCacheEntry,
  IngestCacheKey,
  IngestOptions,
  IngestResult,
  IngestSource,
  LogEntry,
  LogVerb,
  MemoryDiff,
  MemoryInstallResult,
  MemoryPage,
  MemoryRoot,
  MemorySnapshot,
  PageFrontmatter,
  PageWithClaims,
  QueryCitation,
  QueryOptions,
  QueryResult,
  SearchHit,
  SourceRef,
  TaggedClaim,
  TokenStats
} from "./types.js";
export { resolveMemoryRoot } from "./paths.js";
export {
  MEMORY_ROOT_ENV_VAR,
  resolveConfiguredMemoryRoot,
  type ResolveConfiguredMemoryRootOptions
} from "./resolve-root.js";
export { initMemory } from "./init.js";
export { listMemoryFiles, listPages, readPage } from "./pages.js";
export { searchMemory } from "./search.js";
export { statusOf } from "./status.js";
export { editPage } from "./edit.js";
export { appendToPage, clearMemory, writePage } from "./write.js";
export { reconcile, snapshot } from "./reconcile.js";
export { parseClaims, serializeTag } from "./confidence.js";
export { auditClaims } from "./audit.js";
export { cacheStatus, clearCache, computeIngestKey, readCacheEntry, writeCacheEntry } from "./cache.js";
export { runMemoryCacheClear, runMemoryCacheStatus } from "./cache.cli.js";
export { ingest, INGEST_PROMPT_VERSION } from "./ingest.js";
export { computeTokenStats } from "./tokens.js";
export { startMemoryMcpServer, printMcpConfig } from "./mcp.js";
export { installMemory } from "./install.js";
export { queryMemory, rankPagesForQuery, selectQueryContext } from "./query.js";
export { explainPage } from "./explain.js";
export { runMemoryExplain } from "./explain.cli.js";
export { openMemory } from "./handle.js";
export type {
  AuditCallOptions,
  MemoryHandle,
  OpenMemoryOptions,
  StatusInfo
} from "./handle.js";
