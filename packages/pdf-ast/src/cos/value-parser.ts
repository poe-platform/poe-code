import type { PdfCosNode, PdfCosDict, PdfDictEntry, PdfPixelStorage, PdfStoredItems } from "../ast.js";
import { PdfError } from "../errors.js";
import type { CosToken } from "./lexer.js";

// Drivers supply tokens and decide how a completed dictionary's optional stream
// is represented. The container/reference grammar is shared by both I/O paths.
export interface ValueArrayStorage {
  readonly arrayStorage?: PdfPixelStorage;
  /** Select decoded source strings without changing other string consumers. */
  readonly stringStorage?: PdfPixelStorage;
  readonly storedStringKeys?: readonly string[];
  readonly storeRootString?: boolean;
  readonly storedArrayKeys?: readonly string[];
  /** Match a suffix of enclosing dictionary keys; '*' matches one key.
   * Array boundaries do not match dictionary path segments. */
  readonly storedArrayPaths?: readonly (readonly string[])[];
  /** Enclosing keys from the caller when parsing an indirect dictionary. */
  readonly arrayPathPrefix?: readonly string[];
  readonly storeRootArray?: boolean;
}
export type ValueWork<T> = Generator<void | "token" | PdfCosDict | {kind: "array-append"; node: PdfCosNode; previous: number}, T, CosToken | PdfCosNode | number | undefined>;

export function* parseValueSteps(lexer: { offset: number; setStringStorage?: (storage: PdfPixelStorage | undefined) => void }, maxDepth: number, repair = false, maxNodes = Infinity, options: ValueArrayStorage = {}): ValueWork<PdfCosNode | undefined> {
  yield;
  let work = 0;
  let nodes = 0;
  const charge = () => {
    if (nodes >= maxNodes) throw new PdfError("E_LIMIT", "PDF value node limit exceeded");
    nodes++;
  };

  type Container =
    | { kind: "array"; start: number; items: PdfCosNode[]; storedItems?: PdfStoredItems; tail: number }
    | { kind: "dict"; start: number; entries: PdfDictEntry[]; key?: PdfDictEntry["key"] };
  const stack: Container[] = [];
  function matchesStoredPath(): boolean {
    return options.storedArrayPaths?.some(path => {
      const prefix = options.arrayPathPrefix ?? [], length = prefix.length + stack.length;
      if (!path.length || path.length > length) return false;
      for (let i = 0; i < path.length; i++) {
        const at = length - path.length + i;
        let key: string | undefined;
        if (at < prefix.length) key = prefix[at];
        else {
          const parent = stack[at - prefix.length]!;
          if (parent.kind !== "dict") return false;
          key = parent.key?.decoded;
        }
        if (key === undefined || (path[i] !== "*" && path[i] !== key)) return false;
      }
      return true;
    }) ?? false;
  }
  while (true) {
    if (++work % 16 === 0) yield;

    const parent = stack.at(-1);
    lexer.setStringStorage?.(options.stringStorage && ((parent?.kind === "dict" && parent.key && options.storedStringKeys?.includes(parent.key.decoded)) || (!parent && options.storeRootString)) ? options.stringStorage : undefined);
    const tok = (yield "token") as CosToken | undefined;
    if (!tok) {
      if (!parent) return undefined;
      throw new PdfError("E_PARSE", parent.kind === "array" ? "Unterminated PDF array" : "Unterminated PDF dictionary");
    }
    // Eager COS materialization also visits unused dummy objects that PDF.js
    // need not fetch. Preserve them as null only during document recovery.
    if (!parent && repair && tok.kind === "keyword" && tok.value === "endobj") {
      charge();
      return { kind: "null", span: tok.span };
    }
    let node: PdfCosNode;
    if (parent?.kind === "array" && tok.kind === "array-end") {
      stack.pop();
      node = { kind: "array", items: parent.items, ...(parent.storedItems ? {storedItems: parent.storedItems} : {}), span: { start: parent.start, end: tok.span.end } };
    } else if (parent?.kind === "dict" && !parent.key) {
      if (tok.kind === "dict-end") {
        stack.pop();
        node = (yield { kind: "dict", entries: parent.entries, span: { start: parent.start, end: tok.span.end } }) as PdfCosNode;
      } else if (tok.kind === "name") {
        charge();
        parent.key = { kind: "name", rawBytes: tok.rawBytes, decoded: tok.decoded, span: tok.span };
        continue;
      } else {
        // PDF.js Parser.getObj advances past stray non-Name keys rather than
        // discarding the dictionary (e.g. unescaped font-name spaces).
        if (repair) continue;
        throw new PdfError("E_PARSE", `Expected dictionary key /Name, got ${tok.kind}`);
      }
    } else {
      if (parent?.kind === "dict" && tok.kind === "dict-end") {
        throw new PdfError("E_PARSE", `Missing value for dictionary key /${parent.key!.decoded}`);
      }
      charge();
      if (stack.length > maxDepth) throw new PdfError("E_LIMIT", "PDF syntax nesting limit exceeded");
      if (tok.kind === "array-start") {
        const backed = options.arrayStorage && (parent?.kind === "array" && parent.storedItems || parent?.kind === "dict" && (options.storedArrayKeys?.includes(parent.key!.decoded) || matchesStoredPath()) || !parent && options.storeRootArray);
        stack.push({ kind: "array", start: tok.span.start, items: [], tail: -1,
          ...(backed ? {storedItems: {storage: options.arrayStorage!, position: -1, length: 0}} : {}) });
        continue;
      }
      if (tok.kind === "dict-start") {
        stack.push({ kind: "dict", start: tok.span.start, entries: [] });
        continue;
      }
      node = yield* parseLeafFromToken(tok, lexer);
    }
    const container = stack.at(-1);
    if (!container) return node;
    if (container.kind === "array") {
      if (container.storedItems) {
        const position = (yield {kind: "array-append", node, previous: container.tail}) as number;
        container.storedItems = {...container.storedItems, position: container.tail === -1 ? position : container.storedItems.position, length: container.storedItems.length + 1};
        container.tail = position;
      } else container.items.push(node);
    }
    else {
      container.entries.push({ key: container.key!, value: node });
      delete container.key;
    }
  }
}


function* parseLeafFromToken(tok: CosToken, lexer: { offset: number }): ValueWork<PdfCosNode> {
  switch (tok.kind) {
    case "null":
      return { kind: "null", span: tok.span };
    case "boolean":
      return { kind: "boolean", value: tok.value, span: tok.span };
    case "number": {
      const savedOffset = lexer.offset;
      const t2 = (yield "token") as CosToken | undefined;
      if (t2?.kind === "number" && Number.isInteger(tok.value) && Number.isInteger(t2.value)) {
        const t3 = (yield "token") as CosToken | undefined;
        if (t3?.kind === "keyword" && t3.value === "R") {
          return {
            kind: "ref",
            objectNumber: tok.value,
            generationNumber: t2.value,
            span: { start: tok.span.start, end: t3.span.end },
          };
        }
      }
      lexer.offset = savedOffset;
      return {
        kind: "number",
        value: tok.value,
        isInteger: Number.isInteger(tok.value) && !tok.raw.includes("."),
        raw: tok.raw,
        span: tok.span,
      };
    }
    case "name":
      return { kind: "name", rawBytes: tok.rawBytes, decoded: tok.decoded, span: tok.span };
    case "string":
      return { kind: "string", encoding: "literal", bytes: tok.bytes, ...(tok.storedBytes ? { storedBytes: tok.storedBytes } : {}), span: tok.span };
    case "hex-string":
      return { kind: "string", encoding: "hex", bytes: tok.bytes, ...(tok.storedBytes ? { storedBytes: tok.storedBytes } : {}), span: tok.span };
    default:
      throw new PdfError("E_PARSE", `Unexpected PDF token: ${tok.kind}`);
  }
}

