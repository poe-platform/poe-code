import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { IndexedDocument, closeDocumentResources } from "safe-bash-diff-engine/document";
import { inspect, ToolError, type Budget } from "safe-bash-diff-engine/shared";
import { pathOf } from "safe-bash-io-engine/internal";
import type { DiffFlags } from "./diff-options.js";
import { GlobText, compileGlob, matchesGlob } from "./stored-glob.js";

/** Exclusion source, compiled byte sets and pattern descriptors share one cache. */
export class StoredExclusions {
  private readonly cache = new PagedStorageCache(16);
  private readonly tokens: PagedStorage;
  private readonly patterns: PagedStorage;
  private count = 0;
  private bytes = 0;
  constructor(private readonly budget: Budget) {
    this.tokens = new PagedStorage(budget.context, 16, this.cache);
    this.patterns = new PagedStorage(budget.context, 16, this.cache);
  }
  private document(): IndexedDocument {
    return new IndexedDocument({ context: this.budget.context, documentCache: this.cache,
      step: this.budget.step.bind(this.budget), checkpoint: this.budget.checkpoint.bind(this.budget) });
  }
  private async append(document: IndexedDocument, start: number, end: number, ignoreCase: boolean): Promise<void> {
    if (this.count >= this.budget.limits.maxExcludePatterns) throw new ToolError("exclusion pattern count limit exceeded");
    if (end - start > this.budget.limits.maxExcludePatternBytes - this.bytes) throw new ToolError("exclusion pattern byte limit exceeded");
    this.bytes += end - start;
    const position = this.tokens.allocate(0);
    const count = await compileGlob(new GlobText(document.data, 8 + start, end - start, this.budget), ignoreCase, this.tokens, this.budget, this.cache);
    const cell = new Uint8Array(16), view = new DataView(cell.buffer);
    view.setFloat64(0, position, true); view.setFloat64(8, count, true);
    await this.patterns.append(cell); this.count++;
  }
  async load(options: DiffFlags): Promise<void> {
    for (const { pattern, ignoreCase } of options.excludes) {
      const document = this.document();
      try {
        await document.load({ async *[Symbol.asyncIterator]() {
          for (let start = 0; start < pattern.length;) {
            let end = Math.min(start + 4096, pattern.length);
            const last = pattern.charCodeAt(end - 1);
            if (end < pattern.length && last >= 0xd800 && last <= 0xdbff) end--;
            yield new TextEncoder().encode(pattern.slice(start, end)); start = end;
          }
        } });
        await this.append(document, 0, document.size, ignoreCase);
      } finally { await document.close(); }
    }
    for (const { path, ignoreCase } of options.excludeFiles) {
      if (path !== "-") await inspect(this.budget, path, "follow");
      const document = this.document();
      try {
        await document.load(path === "-" ? this.budget.stdinSource() : this.budget.diffSource(pathOf(this.budget.context, path)));
        if (document.binary) throw new ToolError("binary input is unsupported (NUL byte)");
        if (!document.validUtf8) throw new ToolError("binary input is unsupported (invalid UTF-8)");
        for (let index = 0; index < document.length; index++) {
          const line = await document.line(index);
          const end = (await document.data.read(8 + line.end - 1, 1))[0] === 10 ? line.end - 1 : line.end;
          if (end > line.start) await this.append(document, line.start, end, ignoreCase);
          else { this.budget.step(); const pause = this.budget.checkpoint(); if (pause) await pause; }
        }
      } finally { await document.close(); }
    }
  }
  async matches(name: string): Promise<boolean> {
    if (!this.count) return false;
    const bytes = new TextEncoder().encode(name);
    for (let index = 0; index < this.count; index++) {
      const cell = await this.patterns.read(8 + index * 16, 16), view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
      if (await matchesGlob(this.tokens, view.getFloat64(0, true), view.getFloat64(8, true), bytes, this.budget)) return true;
    }
    return false;
  }
  close(): Promise<void> { return closeDocumentResources([this.tokens, this.patterns]); }
}
