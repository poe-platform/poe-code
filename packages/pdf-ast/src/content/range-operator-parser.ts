import type { PdfCosNode } from "../ast.js";
import { CosRangeLexer, type CosToken } from "../cos/lexer.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFileSource } from "../source.js";
import { contentOperatorSteps, type PdfContentOperator } from "./operator-parser.js";
import { PdfOperandStack } from "./operand-stack.js";
import { PDF_KNOWN_COMMANDS } from "./operators.js";

export interface ParseContentRangeOptions {
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
  const lexer = new CosRangeLexer(source, { maxTokenBytes: limits.maxTokenBytes, knownCommands: PDF_KNOWN_COMMANDS, ...(signal ? { signal } : {}) });
  const stack = new PdfOperandStack(storage, limits);
  const work = contentOperatorSteps(lexer, source.size, limits);
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
        case "push": await stack.push(request.node); break;
        case "pop": result = await stack.pop(); break;
        case "operator": yield request.value; break;
      }
      step = work.next(result);
    }
  } catch (error) { failed = true; throw error; }
  finally {
    work.return();
    await stack.close().catch(error => { if (!failed) throw error; });
  }
}
