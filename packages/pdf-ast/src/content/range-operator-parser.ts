import { StoredMetadataStack, readStoredItems, appendStoredRecord } from "./stored-record.js";
import type { PdfCosNode } from "../ast.js";
import { CosRangeLexer, type CosToken } from "../cos/lexer.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFileSource } from "../source.js";
import { contentOperatorSteps, type PdfContentOperator } from "./operator-parser.js";
import { PdfOperandStack } from "./operand-stack.js";
import { PDF_KNOWN_COMMANDS } from "./operators.js";

export interface ParseContentRangeOptions {
  /** Preserve inline ActualText bytes on pathStorage for retained consumers. */
  readonly retainActualText?: boolean;
  readonly pathStorage?: import("../ast.js").PdfPixelStorage;
  readonly chunkBytes?: number;
  readonly maxStagingBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxTokenBytes?: number;
  readonly signal?: AbortSignal;
}

/** Pull normalized operators using bounded source ranges and caller-backed
 * recovery state. Inline images reference the still caller-owned source. */
export async function* parseContentRangeOperators(source: PdfFileSource, storage: PdfIndexStorage, options: ParseContentRangeOptions = {}): AsyncGenerator<PdfContentOperator, void> {
  const limits = { chunkBytes: options.chunkBytes ?? 4096, maxStagingBytes: options.maxStagingBytes ?? Infinity,
    maxNodes: options.maxNodes ?? 65536, maxDepth: options.maxDepth ?? 100, maxTokenBytes: options.maxTokenBytes ?? 1024 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  for (const [name, value] of Object.entries(limits)) {
    if (name === "signal") continue;
    if (typeof value !== "number" || (value !== Infinity && (!Number.isSafeInteger(value) || value < 0))) throw new RangeError(`Invalid ${name}`);
  }
  if (!Number.isSafeInteger(limits.chunkBytes) || limits.chunkBytes < 8) throw new RangeError("chunkBytes must be at least 8");
  const { signal } = options;
  const lexer = new CosRangeLexer(source, { maxTokenBytes: limits.maxTokenBytes, knownCommands: PDF_KNOWN_COMMANDS, ...(options.pathStorage ? { stringStorage: options.pathStorage } : {}), ...(signal ? { signal } : {}) });
  const stack = new PdfOperandStack(storage, limits);
  const backedStack = options.pathStorage ? new StoredMetadataStack<PdfCosNode>(options.pathStorage, signal) : undefined;
  const operands = backedStack ?? stack;
  // Non-text consumers still require their normal COS value representation.
  async function materialize(node: PdfCosNode, retainActualText = false): Promise<PdfCosNode> {
    if (node.kind === "string" && node.storedBytes) {
      const { storedBytes, ...value } = node;
      const bytes = new Uint8Array(storedBytes.byteLength);
      for (let at = 0; at < bytes.length; at += 4096) {
        signal?.throwIfAborted();
        const part = await storedBytes.storage.read(storedBytes.position + at, Math.min(4096, bytes.length - at), signal ? { signal } : undefined);
        signal?.throwIfAborted();
        if (part.length !== Math.min(4096, bytes.length - at)) throw new Error("Incomplete stored PDF string");
        bytes.set(part, at);
      }
      return { ...value, bytes };
    }
    if (node.kind === "array") {
      const items: PdfCosNode[] = [];
      for await (const item of node.storedItems ? readStoredItems<PdfCosNode>(node.storedItems, signal) : node.items) items.push(await materialize(item));
      const { storedItems: ignoredItems, ...value } = node;
      return { ...value, items };
    }
    if (node.kind === "dict") {
      const entries = [];
      for (const entry of node.entries) entries.push({ ...entry, value: retainActualText && entry.key.decoded === "ActualText" && entry.value.kind === "string" ? entry.value : await materialize(entry.value) });
      return { ...node, entries };
    }
    return node;
  }
  const work = contentOperatorSteps(lexer, source.size, { ...limits, ...(options.pathStorage ? { arrayStorage: options.pathStorage } : {}) });
  let cache: Uint8Array = new Uint8Array(0); let cacheStart = 0; let turns = 0;
  let failed = false;
  try {
    signal?.throwIfAborted();
    let step = work.next();
    while (!step.done) {
      signal?.throwIfAborted();
      if (++turns % 4096 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const request = step.value;
      let result: CosToken | PdfCosNode | number | undefined;
      switch (request.kind) {
        case "array-append": {
          result = await appendStoredRecord(options.pathStorage!, request.node, request.previous, signal); break;
        }
        case "token": result = await lexer.nextToken(); break;
        case "byte": {
          const at = request.position;
          if (at < source.size) {
            if (at < cacheStart || at >= cacheStart + cache.length) {
              cacheStart = at; cache = await source.read(at, Math.min(source.chunkBytes, source.size - at), signal);
            }
            result = cache[at - cacheStart];
          }
          break;
        }
        case "push": await operands.push(request.node); break;
        case "pop": result = await operands.pop(); break;
        case "operator": {
          const value = request.value;
          if (options.pathStorage && !["Tj", "TJ", "'", '"', "d"].includes(value.operator)) {
            const operands: PdfCosNode[] = [];
            for (const [index, node] of value.operands.entries()) operands.push(await materialize(node, !!options.retainActualText && value.operator === "BDC" && index === 1));
            const inlineImage = value.inlineImage ? { ...value.inlineImage, dict: await materialize(value.inlineImage.dict) as typeof value.inlineImage.dict } : undefined;
            yield { ...value, operands, ...(inlineImage ? { inlineImage } : {}) };
          } else yield value;
          break;
        }
      }
      step = work.next(result);
    }
  } catch (error) { failed = true; throw error; }
  finally {
    work.return();
    await stack.close().catch(error => { if (!failed) throw error; });
  }
}
