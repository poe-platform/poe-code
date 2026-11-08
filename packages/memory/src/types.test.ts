import { describe, expectTypeOf, it } from "vitest";
import type {
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

describe("memory types", () => {
  it("match the plan's exported shapes", () => {
    expectTypeOf<MemoryRoot>().toEqualTypeOf<string>();
    expectTypeOf<IngestCacheKey>().toEqualTypeOf<string>();
    expectTypeOf<ConfidenceVerb>().toEqualTypeOf<"extracted" | "inferred" | "ambiguous">();
    expectTypeOf<LogVerb>().toEqualTypeOf<"create" | "update" | "delete" | "ingest" | "lint">();

    expectTypeOf<PageFrontmatter>().toEqualTypeOf<{
      name?: string;
      description?: string;
      lastTouchedAt?: string;
      sources?: SourceRef[];
    }>();

    expectTypeOf<SourceRef>().toEqualTypeOf<{
      path: string;
      startLine?: number;
      endLine?: number;
    }>();

    expectTypeOf<ConfidenceTag>().toEqualTypeOf<
      | { verb: "extracted"; source: SourceRef; note?: string }
      | { verb: "inferred"; confidence: number; source?: SourceRef; note?: string }
      | { verb: "ambiguous"; reason: string }
    >();

    expectTypeOf<TaggedClaim>().toEqualTypeOf<{
      tag: ConfidenceTag;
      body: string;
      lineNumber: number;
    }>();

    expectTypeOf<MemoryPage>().toEqualTypeOf<{
      relPath: string;
      frontmatter: PageFrontmatter;
      body: string;
      bytes: number;
      mtimeMs: number;
    }>();

    expectTypeOf<PageWithClaims>().toEqualTypeOf<
      MemoryPage & {
        claims: TaggedClaim[];
      }
    >();

    expectTypeOf<IndexEntry>().toEqualTypeOf<{
      relPath: string;
      description: string;
    }>();

    expectTypeOf<LogEntry>().toEqualTypeOf<{
      timestamp: string;
      verb: LogVerb;
      relPath?: string;
      detail: string;
    }>();

    expectTypeOf<MemoryDiff>().toEqualTypeOf<{
      created: string[];
      updated: string[];
      deleted: string[];
    }>();

    expectTypeOf<MemorySnapshot>().toEqualTypeOf<{
      pages: Record<string, string>;
    }>();

    expectTypeOf<SearchHit>().toEqualTypeOf<{
      relPath: string;
      lineNumber: number;
      line: string;
    }>();

    expectTypeOf<IngestSource>().toEqualTypeOf<
      { kind: "file"; absPath: string } | { kind: "url"; url: string }
    >();

    expectTypeOf<IngestOptions>().toEqualTypeOf<{
      source: IngestSource;
      agent?: string;
      reason?: string;
      timeoutMs?: number;
      dryRun?: boolean;
      force?: boolean;
      noCacheWrite?: boolean;
    }>();

    expectTypeOf<TokenStats>().toEqualTypeOf<{
      memoryTokens: number;
      sourceTokens: number;
      reductionRatio: number;
      missingSources: string[];
    }>();

    expectTypeOf<IngestResult>().toEqualTypeOf<{
      diff: MemoryDiff;
      exitCode: number;
      durationMs: number;
      cacheHit: boolean;
      tokens: TokenStats;
    }>();

    expectTypeOf<IngestCacheEntry>().toEqualTypeOf<{
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
    }>();

    expectTypeOf<MemoryInstallResult>().toEqualTypeOf<{
      skillInstalled: boolean;
      mcpConfigured: boolean;
      skillPath?: string;
      mcpConfigPath?: string;
    }>();

    expectTypeOf<QueryOptions>().toEqualTypeOf<{
      question: string;
      budget: number;
      agent?: string;
    }>();

    expectTypeOf<QueryCitation>().toEqualTypeOf<{
      relPath: string;
      section?: string;
      confidence: ConfidenceVerb;
    }>();

    expectTypeOf<QueryResult>().toEqualTypeOf<{
      answer: string;
      citations: QueryCitation[];
      tokensUsed: number;
      budget: number;
      exitCode: number;
    }>();

    expectTypeOf<ExplainResult>().toEqualTypeOf<
      QueryResult & {
        inboundPages: string[];
        outboundSources: SourceRef[];
      }
    >();
  });
});
