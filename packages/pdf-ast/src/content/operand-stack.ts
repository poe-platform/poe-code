import type { PdfCosNode } from "../ast.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { parseCosRangeValue } from "../cos/range-parser.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";

interface Run { source: PdfFileSource; end: number }
/** One small resident tail and logarithmically many immutable caller-backed
 * runs. Length footers allow reverse traversal without a resident offset index. */
export class PdfOperandStack {
  private readonly tail: PdfCosNode[] = [];
  private readonly levels: Array<Run | undefined> = [];
  constructor(private readonly storage: PdfIndexStorage, private readonly options: {
    chunkBytes: number; maxStagingBytes: number; maxNodes: number; maxDepth: number; maxTokenBytes: number; signal?: AbortSignal;
  }) {}

  async push(node: PdfCosNode): Promise<void> {
    this.tail.push(node);
    if (this.tail.length < 32) return;
    let level = 0;
    while (this.levels[level]) level++;
    const inputs = this.levels.slice(0, level).reverse();
    const tail = this.tail;
    const { chunkBytes, signal, maxDepth } = this.options;
    async function* records() {
      for (const run of inputs) yield* run!.source.stream(0, run!.end, signal);
      for (const value of tail) {
        let length = 0;
        for (const chunk of serializeCosNodeChunks(value, { chunkBytes, maxRecursionDepth: maxDepth })) {
          length += chunk.length; yield chunk;
        }
        const footer = new Uint8Array(8); new DataView(footer.buffer).setFloat64(0, length); yield footer;
      }
    }
    const live = this.levels.reduce((sum, run) => sum + (run?.source.size ?? 0), 0);
    const remaining = Math.min(this.options.maxStagingBytes, Number.MAX_SAFE_INTEGER) - live;
    if (remaining < 0) throw new PdfError("E_LIMIT", "PDF operand staging limit exceeded");
    const source = await PdfFileSource.fromStream(this.storage.fs, this.storage.directory, records(), {
      chunkBytes, cacheBytes: chunkBytes, maxInputBytes: remaining, ...(signal ? { signal } : {}),
    });
    try {
      for (let i = 0; i < level; i++) { await this.levels[i]!.source.close(); this.levels[i] = undefined; }
      this.levels[level] = { source, end: source.size }; this.tail.length = 0;
    } catch (error) { try { await source.close(); } catch { /* Preserve original failure. */ } throw error; }
  }

  async pop(): Promise<PdfCosNode | undefined> {
    if (this.tail.length) return this.tail.pop();
    const level = this.levels.findIndex(run => run !== undefined);
    if (level < 0) return undefined;
    const run = this.levels[level]!;
    const { signal, maxNodes, maxDepth, maxTokenBytes } = this.options;
    const footer = await run.source.read(run.end - 8, 8, signal);
    const length = new DataView(footer.buffer, footer.byteOffset, 8).getFloat64(0);
    const end = run.end - 8;
    if (!Number.isSafeInteger(length) || length < 0 || length > end) throw new PdfError("E_PARSE", "Invalid PDF operand stack record");
    const parsed = await parseCosRangeValue(run.source, end - length, {
      end, maxNodes, maxTokenBytes, maxRecursionDepth: maxDepth, ...(signal ? { signal } : {}),
    });
    run.end = end - length;
    if (run.end === 0) { await run.source.close(); this.levels[level] = undefined; }
    // Offsets in the private recovery tape are not content-stream provenance.
    function clearSpans(value: PdfCosNode): PdfCosNode {
      const { span: ignoredSpan, ...node } = value;
      if (node.kind === "array") return { ...node, items: node.items.map(clearSpans) };
      if (node.kind === "dict") return { ...node, entries: node.entries.map(entry => {
        const { span: ignoredKeySpan, ...key } = entry.key;
        return { key, value: clearSpans(entry.value) };
      }) };
      return node;
    }
    return parsed.value ? clearSpans(parsed.value) : undefined;
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(this.levels.map(run => run?.source.close()));
    this.tail.length = 0; this.levels.length = 0;
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
