import type { PdfCosNode, PdfCosDict, PdfDictEntry, PdfPixelStorage, PdfStoredItems } from "../ast.js";
import { PdfError } from "../errors.js";
import type { CosToken } from "./lexer.js";

// Drivers supply tokens and decide how a completed dictionary's optional stream
// is represented. The container/reference grammar is shared by both I/O paths.
export interface ValueArrayStorage {
  readonly dictionaryStorage?: PdfPixelStorage;
  /** Select resource maps; their entry names are data, not nested map selectors. */
  readonly storedDictionaryKeys?: readonly string[];
  /** Select dictionary path suffixes; entry names of backed maps remain opaque. */
  readonly storedDictionaryPaths?: readonly (readonly string[])[];
  readonly storeRootDictionary?: boolean;
  readonly arrayStorage?: PdfPixelStorage;
  /** Back suspended parser containers; selected descriptors must share this storage. */
  readonly containerStorage?: PdfPixelStorage;
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
export type ValueContainer = (
  | { kind: "array"; start: number; items: PdfCosNode[]; storedItems?: PdfStoredItems; tail: number }
  | { kind: "dict"; start: number; entries: PdfDictEntry[]; storedEntries?: PdfStoredItems; tail: number; key?: PdfDictEntry["key"] }
) & { path: readonly (string | null)[] };
export type ValueWork<T> = Generator<void | "token" | PdfCosDict
  | {kind: "dictionary-append"; entry: PdfDictEntry; previous: number}
  | {kind: "array-append"; node: PdfCosNode; previous: number}
  | {kind: "container-push"; container: ValueContainer}
  | {kind: "container-pop"}, T, CosToken | PdfCosNode | ValueContainer | number | undefined>;

export function* parseValueSteps(lexer: { offset: number; setStringStorage?: (storage: PdfPixelStorage | undefined) => void }, maxDepth: number, repair = false, maxNodes = Infinity, options: ValueArrayStorage = {}): ValueWork<PdfCosNode | undefined> {
  yield;
  let work = 0;
  let nodes = 0;
  const charge = () => {
    if (nodes >= maxNodes) throw new PdfError("E_LIMIT", "PDF value node limit exceeded");
    nodes++;
  };

  // Keep a fixed shallow window to avoid rewriting wide ordinary dictionaries
  // for every child. Deeper suspended frames use the caller backing.
  const residentDepth = 32;
  const stack: ValueContainer[] = [];
  let current: ValueContainer | undefined, depth = 0;
  const pathLength = [...(options.storedArrayPaths ?? []), ...(options.storedDictionaryPaths ?? [])].reduce((length,path)=>Math.max(length,path.length-1),0);
  function matchesStoredPath(parent: ValueContainer | undefined, paths: readonly (readonly string[])[] | undefined): boolean {
    const currentPath = parent ? [...parent.path, parent.kind === "dict" ? parent.key?.decoded : null] : options.arrayPathPrefix ?? [];
    return paths?.some(path => {
      const length = currentPath.length;
      if (!path.length || path.length > length) return false;
      for (let i = 0; i < path.length; i++) {
        const at = length - path.length + i;
        const key = currentPath[at];
        if (key == null || (path[i] !== "*" && path[i] !== key)) return false;
      }
      return true;
    }) ?? false;
  }
  function ancestorPath(parent: ValueContainer | undefined): readonly (string|null)[] {
    if(!pathLength) return [];
    return parent ? [...parent.path,parent.kind === "dict" ? parent.key?.decoded ?? null : null].slice(-pathLength) : options.arrayPathPrefix?.slice(-pathLength) ?? [];
  }
  function* push(container: ValueContainer): ValueWork<void> {
    if(current) {
      if(options.containerStorage && depth > residentDepth) yield {kind:"container-push",container:current};
      else stack.push(current);
    }
    current=container;depth++;
  }
  function* pop(): ValueWork<void> {
    depth--;
    current = options.containerStorage && depth > residentDepth ? (yield {kind:"container-pop"}) as ValueContainer | undefined : stack.pop();
  }
  while (true) {
    if (++work % 16 === 0) yield;

    const parent = current;
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
      yield* pop();
      node = { kind: "array", items: parent.items, ...(parent.storedItems ? {storedItems: parent.storedItems} : {}), span: { start: parent.start, end: tok.span.end } };
    } else if (parent?.kind === "dict" && !parent.key) {
      if (tok.kind === "dict-end") {
        yield* pop();
        node = (yield { kind: "dict", entries: parent.entries, ...(parent.storedEntries ? {storedEntries: parent.storedEntries} : {}), span: { start: parent.start, end: tok.span.end } }) as PdfCosNode;
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
      if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF syntax nesting limit exceeded");
      if (tok.kind === "array-start") {
        const backed = options.arrayStorage && (parent?.kind === "array" && parent.storedItems || parent?.kind === "dict" && (options.storedArrayKeys?.includes(parent.key!.decoded) || matchesStoredPath(parent, options.storedArrayPaths)) || !parent && options.storeRootArray);
        yield* push({ kind: "array", path:ancestorPath(parent), start: tok.span.start, items: [], tail: -1,
          ...(backed ? {storedItems: {storage: options.arrayStorage!, position: -1, length: 0}} : {}) });
        continue;
      }
      if (tok.kind === "dict-start") {
        const backed = options.dictionaryStorage && (parent?.kind === "dict" && !parent.storedEntries && (options.storedDictionaryKeys?.includes(parent.key!.decoded) || matchesStoredPath(parent, options.storedDictionaryPaths)) || !parent && (options.storeRootDictionary || matchesStoredPath(undefined, options.storedDictionaryPaths)));
        yield* push({ kind: "dict", path:ancestorPath(parent), start: tok.span.start, entries: [], tail: -1,
          ...(backed ? {storedEntries: {storage: options.dictionaryStorage!, position: -1, length: 0}} : {}) });
        continue;
      }
      node = yield* parseLeafFromToken(tok, lexer);
    }
    const container = current;
    if (!container) return node;
    if (container.kind === "array") {
      if (container.storedItems) {
        const position = (yield {kind: "array-append", node, previous: container.tail}) as number;
        container.storedItems = {...container.storedItems, position: container.tail === -1 ? position : container.storedItems.position, length: container.storedItems.length + 1};
        container.tail = position;
      } else container.items.push(node);
    }
    else {
      const entry = { key: container.key!, value: node };
      if (container.storedEntries) {
        const position = (yield {kind: "dictionary-append", entry, previous: container.tail}) as number;
        container.storedEntries = {...container.storedEntries, position: container.tail === -1 ? position : container.storedEntries.position, length: container.storedEntries.length + 1};
        container.tail = position;
      } else container.entries.push(entry);
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

