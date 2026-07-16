import path from "node:path";
import type { AuditClaimsOptions, PageAudit } from "./audit.js";
import { auditClaims as auditClaimsFree } from "./audit.js";
import type { ExplainOptions } from "./explain.js";
import { explainPage as explainPageFree } from "./explain.js";
import { ingest as ingestFree } from "./ingest.js";
import { listMemoryFiles, listPages, readPage } from "./pages.js";
import { queryMemory } from "./query.js";
import { searchMemory } from "./search.js";
import { statusOf } from "./status.js";
import { computeTokenStats } from "./tokens.js";
import type {
  ExplainResult,
  IngestOptions,
  IngestResult,
  MemoryDiff,
  MemoryPage,
  MemoryRoot,
  PageFrontmatter,
  QueryOptions,
  QueryResult,
  SearchHit,
  TokenStats
} from "./types.js";
import { appendToPage, clearMemory, writePage } from "./write.js";

export type OpenMemoryOptions = {
  root: MemoryRoot;
  agent?: string;
};

export type StatusInfo = {
  pageCount: number;
  totalBytes: number;
  lastWriteAt: string | null;
  initialized: boolean;
};

export type AuditCallOptions = AuditClaimsOptions & { repoRoot: string };

export interface MemoryHandle {
  readonly root: MemoryRoot;

  listPages(): Promise<MemoryPage[]>;
  listMemoryFiles(): Promise<MemoryPage[]>;
  readPage(relPath: string): Promise<MemoryPage>;
  searchMemory(query: string): Promise<SearchHit[]>;
  statusOf(): Promise<StatusInfo>;
  computeTokenStats(): Promise<TokenStats>;
  explainPage(opts: ExplainOptions): Promise<ExplainResult>;

  writePage(
    relPath: string,
    body: string,
    opts: { reason: string; frontmatter?: PageFrontmatter }
  ): Promise<MemoryDiff>;
  appendToPage(
    relPath: string,
    content: string,
    opts: { reason: string }
  ): Promise<MemoryDiff>;
  clearMemory(): Promise<void>;

  query(opts: QueryOptions): Promise<QueryResult>;
  ingest(opts: IngestOptions): Promise<IngestResult>;
  auditClaims(opts: AuditCallOptions): Promise<PageAudit[]>;
}

export function openMemory(opts: OpenMemoryOptions): MemoryHandle {
  if (!path.isAbsolute(opts.root)) {
    throw new Error(`openMemory: root must be absolute, got ${opts.root}`);
  }

  const root = opts.root;
  const defaultAgent = opts.agent;

  return {
    root,
    listPages: async () => await listPages(root),
    listMemoryFiles: async () => await listMemoryFiles(root),
    readPage: async (relPath) => await readPage(root, relPath),
    searchMemory: async (query) => await searchMemory(root, query),
    statusOf: async () => await statusOf(root),
    computeTokenStats: async () => await computeTokenStats(root),
    explainPage: async (options) => await explainPageFree(root, withDefaultAgent(options, defaultAgent)),
    writePage: async (relPath, body, options) => await writePage(root, relPath, body, options),
    appendToPage: async (relPath, content, options) =>
      await appendToPage(root, relPath, content, options),
    clearMemory: async () => await clearMemory(root),
    query: async (options) => await queryMemory(root, withDefaultAgent(options, defaultAgent)),
    ingest: async (options) => await ingestFree(root, withDefaultAgent(options, defaultAgent)),
    auditClaims: async ({ repoRoot, ...options }) => await auditClaimsFree(root, repoRoot, options)
  };
}

function withDefaultAgent<T extends { agent?: string }>(options: T, agent: string | undefined): T {
  if (options.agent !== undefined || agent === undefined) {
    return options;
  }

  return {
    ...options,
    agent
  };
}
