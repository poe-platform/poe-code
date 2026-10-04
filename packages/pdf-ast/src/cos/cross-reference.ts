import { dictGet, type PdfCosArray, type PdfCosDict, type PdfCosRef, type PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { CosRangeLexer } from "./lexer.js";
import { PdfObjectIndex, type PdfIndexStorage, type PdfObjectIndexOptions } from "./object-index.js";
import { readCosXrefRevision, type ReadCosXrefOptions } from "./range-xref.js";

export interface PdfCrossReferenceOptions extends ReadCosXrefOptions {
  readonly maxRevisions?: number;
  /** Limits for each external index construction, including visited offsets.
   * The combined-index builder and one nested builder may coexist. */
  readonly index?: Omit<PdfObjectIndexOptions, "duplicate" | "signal">;
}

export interface PdfCrossReference {
  readonly version: string;
  readonly xrefOffset: number;
  readonly revisionCount: number;
  readonly trailer: PdfCosDict;
  readonly rootRef: PdfCosRef;
  readonly infoRef?: PdfCosRef;
  readonly encryptNode?: PdfCosRef | PdfCosDict;
  readonly idArray?: PdfCosArray;
  /** Owned by the caller; close after use. The input source remains caller-owned. */
  readonly index: PdfObjectIndex;
}

const marker = new TextEncoder().encode("startxref");

async function header(source: PdfFileSource, signal?: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(Math.min(1024, source.size));
  let offset = 0;
  for await (const chunk of source.stream(0, bytes.length, signal)) { bytes.set(chunk, offset); offset += chunk.length; }
  const head = new TextDecoder("latin1").decode(bytes);
  const start = head.indexOf("%PDF-");
  if (start < 0) throw new PdfError("E_PARSE", "Invalid PDF header: missing %PDF- signature");
  return head.slice(start + 5, start + 8);
}

/** Locate the final startxref pointer with bounded reverse reads. */
export async function findPdfStartXref(source: PdfFileSource, options: PdfCrossReferenceOptions = {}): Promise<number> {
  let end = source.size;
  let suffix: Uint8Array = new Uint8Array(0);
  let turns = 0;
  while (end > 0) {
    options.signal?.throwIfAborted();
    const start = Math.max(0, end - source.chunkBytes);
    const chunk = await source.read(start, end - start, options.signal);
    const window = new Uint8Array(chunk.length + suffix.length);
    window.set(chunk); window.set(suffix, chunk.length);
    for (let i = Math.min(chunk.length - 1, window.length - marker.length); i >= 0; i--) {
      let matched = true;
      for (let j = 0; j < marker.length; j++) if (window[i + j] !== marker[j]) { matched = false; break; }
      if (!matched) continue;
      const lexer = new CosRangeLexer(source, {
        start: start + i + marker.length,
        ...(options.maxTokenBytes === undefined ? {} : { maxTokenBytes: options.maxTokenBytes }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const token = await lexer.nextToken();
      if (token?.kind !== "number" || !Number.isSafeInteger(token.value) || token.value < 0 || token.value >= source.size) {
        throw new PdfError("E_PARSE", "Invalid startxref byte offset");
      }
      return token.value;
    }
    suffix = window.slice(0, marker.length - 1);
    end = start;
    if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new PdfError("E_PARSE", "Invalid PDF trailer: missing startxref");
}

function link(trailer: PdfCosDict, key: string, size: number): number | undefined {
  const node = dictGet(trailer, key);
  if (node?.kind !== "number") return undefined;
  if (!Number.isSafeInteger(node.value) || node.value < 0 || node.value >= size) throw new PdfError("E_PARSE", `Invalid /${key} xref offset`);
  return node.value;
}

/** Discover and combine retained xref revisions without whole-document Maps.
 * Duplicate rows within a revision use last-row precedence; newest revisions
 * win across the chain, including free entries. Hybrid stream rows override the
 * accompanying classic table. Visited offsets are themselves externally indexed
 * so a malicious Prev chain cannot grow a resident Set. */
export async function openPdfCrossReference(source: PdfFileSource, storage: PdfIndexStorage, options: PdfCrossReferenceOptions = {}): Promise<PdfCrossReference> {
  const maxRevisions = options.maxRevisions ?? Infinity;
  if (maxRevisions !== Infinity && (!Number.isSafeInteger(maxRevisions) || maxRevisions < 0)) throw new RangeError("Invalid maxRevisions");
  options.signal?.throwIfAborted();
  const version = await header(source, options.signal);
  const xrefOffset = await findPdfStartXref(source, options);
  const indexOptions = { ...options.index, ...(options.signal ? { signal: options.signal } : {}) };
  let visited: PdfObjectIndex | undefined;
  let revision: PdfObjectIndex | undefined;
  let index: PdfObjectIndex | undefined;
  let revisionCount = 0;
  let newest: PdfCosDict | undefined;
  let rootRef: PdfCosRef | undefined;
  let infoRef: PdfCosRef | undefined;
  let encryptNode: PdfCosRef | PdfCosDict | undefined;
  let idArray: PdfCosArray | undefined;

  function metadata(trailer: PdfCosDict): void {
    const root = dictGet(trailer, "Root");
    const info = dictGet(trailer, "Info");
    const encrypt = dictGet(trailer, "Encrypt");
    const id = dictGet(trailer, "ID");
    if (!rootRef && root?.kind === "ref") rootRef = root;
    if (!infoRef && info?.kind === "ref") infoRef = info;
    if (!encryptNode && (encrypt?.kind === "ref" || encrypt?.kind === "dict")) encryptNode = encrypt;
    if (!idArray && id?.kind === "array") idArray = id;
  }

  async function* entries(): AsyncGenerator<PdfXRefEntry> {
    let offset: number | undefined = xrefOffset;
    let failed = false;
    try {
      while (offset !== undefined) {
        options.signal?.throwIfAborted();
        if (await visited?.get(offset, options.signal)) break;
        if (revisionCount >= Math.min(maxRevisions, Number.MAX_SAFE_INTEGER)) throw new PdfError("E_LIMIT", "PDF revision count limit exceeded");
        revisionCount++;
        const previous = visited;
        const current = offset;
        async function* offsets(): AsyncGenerator<PdfXRefEntry> {
          yield { objectNumber: current, type: "uncompressed", offset: 0 };
          if (previous) yield* previous.entries(options.signal);
        }
        visited = await PdfObjectIndex.build(offsets(), storage, indexOptions);
        await previous?.close();

        let trailer: PdfCosDict | undefined;
        async function* rows(): AsyncGenerator<PdfXRefEntry> {
          trailer = yield* readCosXrefRevision(source, current, options);
          metadata(trailer);
          const hybrid = link(trailer, "XRefStm", source.size);
          if (hybrid !== undefined && hybrid !== current) {
            const supplement = yield* readCosXrefRevision(source, hybrid, options);
            metadata(supplement);
          }
        }
        revision = await PdfObjectIndex.build(rows(), storage, { ...indexOptions, duplicate: "last" });
        newest ??= trailer!;
        yield* revision.entries(options.signal);
        await revision.close();
        revision = undefined;
        offset = link(trailer!, "Prev", source.size);
      }
    } catch (error) { failed = true; throw error; }
    finally {
      // The outer index can cancel a pending input pull. This generator still
      // owns any nested construction and cleans it when that pull settles.
      let cleanupError: unknown;
      for (const owned of [revision, visited]) {
        try { await owned?.close(); } catch (error) { cleanupError ??= error; }
      }
      revision = undefined;
      visited = undefined;
      if (!failed && cleanupError !== undefined) await Promise.reject(cleanupError);
    }
  }

  try {
    index = await PdfObjectIndex.build(entries(), storage, indexOptions);
    if (!rootRef || !newest) throw new PdfError("E_PARSE", "PDF trailer missing /Root reference");
    return {
      version, xrefOffset, revisionCount, trailer: newest, rootRef, index,
      ...(infoRef ? { infoRef } : {}), ...(encryptNode ? { encryptNode } : {}), ...(idArray ? { idArray } : {}),
    };
  } catch (error) {
    for (const owned of [revision, visited, index]) {
      try { await owned?.close(); } catch { /* Preserve the primary parse, limit or storage error. */ }
    }
    throw error;
  }
}
