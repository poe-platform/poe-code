import { describe, expect, it } from "vitest";
import * as entrypoint from "./index.js";

describe("memory index exports", () => {
  it("exposes the public package API", () => {
    expect(entrypoint.resolveMemoryRoot("/repo")).toBe("/repo/.poe-code/memory");
    expect(entrypoint.initMemory).toBeTypeOf("function");
    expect(entrypoint.listPages).toBeTypeOf("function");
    expect(entrypoint.readPage).toBeTypeOf("function");
    expect(entrypoint.searchMemory).toBeTypeOf("function");
    expect(entrypoint.statusOf).toBeTypeOf("function");
    expect(entrypoint.editPage).toBeTypeOf("function");
    expect(entrypoint.writePage).toBeTypeOf("function");
    expect(entrypoint.appendToPage).toBeTypeOf("function");
    expect(entrypoint.clearMemory).toBeTypeOf("function");
    expect(entrypoint.snapshot).toBeTypeOf("function");
    expect(entrypoint.reconcile).toBeTypeOf("function");
    expect(entrypoint.parseClaims).toBeTypeOf("function");
    expect(entrypoint.serializeTag).toBeTypeOf("function");
    expect(entrypoint.auditClaims).toBeTypeOf("function");
    expect(entrypoint.computeIngestKey).toBeTypeOf("function");
    expect(entrypoint.readCacheEntry).toBeTypeOf("function");
    expect(entrypoint.writeCacheEntry).toBeTypeOf("function");
    expect(entrypoint.clearCache).toBeTypeOf("function");
    expect(entrypoint.runMemoryCacheStatus).toBeTypeOf("function");
    expect(entrypoint.runMemoryCacheClear).toBeTypeOf("function");
    expect(entrypoint.ingest).toBeTypeOf("function");
    expect(entrypoint.INGEST_PROMPT_VERSION).toBeTypeOf("string");
    expect(entrypoint.computeTokenStats).toBeTypeOf("function");
    expect(entrypoint.startMemoryMcpServer).toBeTypeOf("function");
    expect(entrypoint.printMcpConfig).toBeTypeOf("function");
    expect(entrypoint.installMemory).toBeTypeOf("function");
    expect(entrypoint.queryMemory).toBeTypeOf("function");
    expect(entrypoint.rankPagesForQuery).toBeTypeOf("function");
    expect(entrypoint.selectQueryContext).toBeTypeOf("function");
    expect(entrypoint.explainPage).toBeTypeOf("function");
    expect(entrypoint.runMemoryExplain).toBeTypeOf("function");
  });
});
