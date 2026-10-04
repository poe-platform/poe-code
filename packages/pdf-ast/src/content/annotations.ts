import { PdfArrayCursor, type PdfArrayCursorState } from "./array-cursor.js";
import { PdfError } from "../errors.js";
import { decodePdfString, dictGet, type PdfCosArray, type PdfCosDict, type PdfCosNode, type PdfCosRef, type PdfStoredItems, type PdfLinkAnnotation } from "../ast.js";

export interface PdfAnnotationPageFrame { readonly kind: "annotation-page-frame"; readonly cursor: PdfArrayCursorState; readonly depth: number }

export type PdfAnnotationRequest = { readonly kind: "resolve"; readonly node: PdfCosNode; readonly arrayKey?: string }
  | { readonly kind: "array-item"; readonly items: PdfStoredItems; readonly position: number }
  | { readonly kind: "push-page-frame"; readonly frame: PdfAnnotationPageFrame }
  | { readonly kind: "pop-page-frame" }
  | { readonly kind: "visit-page"; readonly reference: PdfCosRef }
  | { readonly kind: "page-number"; readonly reference: PdfCosRef }
  | { readonly kind: "annotation"; readonly annotation: PdfLinkAnnotation };
export type PdfAnnotationResult = PdfCosNode | PdfAnnotationPageFrame | number | boolean | undefined;
type AnnotationWork<T = void> = Generator<PdfAnnotationRequest, T, PdfAnnotationResult>;
function* resolveNode(node: PdfCosNode | undefined, arrayKey?: string): AnnotationWork<PdfCosNode | undefined> {
  if (!node) return undefined;
  const result = yield { kind: "resolve", node, ...(arrayKey ? {arrayKey} : {}) };
  if (typeof result === "number" || typeof result === "boolean" || result?.kind === "annotation-page-frame") throw new TypeError("Expected a PDF annotation object");
  return result;
}
function* resolveDict(node: PdfCosNode | undefined): AnnotationWork<PdfCosDict | undefined> {
  const result = yield* resolveNode(node); return result?.kind === "dict" ? result : undefined;
}
function* resolveArray(node: PdfCosNode | undefined, arrayKey?: string): AnnotationWork<PdfCosArray | undefined> {
  const result = yield* resolveNode(node, arrayKey); return result?.kind === "array" ? result : undefined;
}
/** Visit backed children without collecting the list; a match stops source reads. */
function* visitChildren<T>(array: PdfCosArray, visit: (node: PdfCosNode) => AnnotationWork<T | undefined>): AnnotationWork<T | undefined> {
  const cursor = new PdfArrayCursor(array);
  for (let step = yield* cursor.next(); !step.done; step = yield* cursor.next()) {
    const found = yield* visit(step.value);
    if (found !== undefined) return found;
  }
  return undefined;
}
/** Shared annotation semantics; drivers own object reads and destination page traversal. */
export function* extractPageAnnotationSteps(pageDict: PdfCosDict, root: PdfCosRef | undefined, maxDepth = Infinity): AnnotationWork {
  const annotsArr = (yield* resolveArray(dictGet(pageDict, "Annots"), "Annots"));
  if (!annotsArr) return;

  function* resolveDestToPageNum(destNode: PdfCosNode | undefined, depth = 0): AnnotationWork<number | undefined> {
    if (!destNode || depth > 4) return undefined;
    const resolved = (yield* resolveNode(destNode));
    if (!resolved) return undefined;
    if (resolved.kind === "array" && resolved.items.length > 0) {
      const first = resolved.items[0]!;
      if (first.kind === "ref") {
        const result = yield { kind: "page-number", reference: first };
        return typeof result === "number" ? result : undefined;
      }
      const rFirst = (yield* resolveNode(first));
      if (rFirst?.kind === "number") {
        return rFirst.value + 1;
      }
    }
    if (resolved.kind === "dict") {
      return (yield* resolveDestToPageNum(dictGet(resolved, "D"), depth + 1));
    }
    if (resolved.kind === "name" || resolved.kind === "string") {
      const destName = resolved.kind === "name" ? resolved.decoded : decodePdfString(resolved);
      const catalog = (yield* resolveDict(root));
      if (catalog) {
        const destsDict = (yield* resolveDict(dictGet(catalog, "Dests")));
        if (destsDict) {
          const found = dictGet(destsDict, destName);
          if (found) return (yield* resolveDestToPageNum(found, depth + 1));
        }
        const namesDict = (yield* resolveDict(dictGet(catalog, "Names")));
        const destsTree = namesDict ? dictGet(namesDict, "Dests") : undefined;
        const active = new Set<PdfCosNode | string>();
        function* searchNameTree(node: PdfCosNode | undefined, depth = 0): AnnotationWork<PdfCosNode | undefined> {
          if (!node) return undefined;
          if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF annotation name-tree depth limit exceeded");
          const identity = node.kind === "ref" ? `${node.objectNumber}:${node.generationNumber}` : node;
          if (active.has(identity)) return undefined;
          active.add(identity);
          try {
            const treeDict = yield* resolveDict(node);
            if (!treeDict) return undefined;
            const namesArr = (yield* resolveArray(dictGet(treeDict, "Names")));
            if (namesArr) {
              for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
                const kNode = (yield* resolveNode(namesArr.items[i]));
                const kStr = kNode?.kind === "string" ? decodePdfString(kNode) : kNode?.kind === "name" ? kNode.decoded : "";
                if (kStr === destName) return namesArr.items[i + 1];
              }
            }
            const kidsArr = (yield* resolveArray(dictGet(treeDict, "Kids"), "Kids"));
            if (kidsArr) {
              const found = yield* visitChildren(kidsArr, kid => searchNameTree(kid, depth + 1));
              if (found) return found;
            }
            return undefined;
          } finally { active.delete(identity); }
        }
        const treeFound = (yield* searchNameTree(destsTree));
        if (treeFound) return (yield* resolveDestToPageNum(treeFound, depth + 1));
      }
    }
    return undefined;
  }

  const annotations = new PdfArrayCursor(annotsArr);
  for (let step = yield* annotations.next(); !step.done; step = yield* annotations.next()) {
    const item = step.value;
    const dict = (yield* resolveDict(item));
    if (!dict) continue;
    const rectArr = (yield* resolveArray(dictGet(dict, "Rect")));
    if (!rectArr || rectArr.items.length < 4) continue;
    const r0 = (yield* resolveNode(rectArr.items[0]));
    const r1 = (yield* resolveNode(rectArr.items[1]));
    const r2 = (yield* resolveNode(rectArr.items[2]));
    const r3 = (yield* resolveNode(rectArr.items[3]));
    const rect: [number, number, number, number] = [
      r0?.kind === "number" ? r0.value : 0,
      r1?.kind === "number" ? r1.value : 0,
      r2?.kind === "number" ? r2.value : 0,
      r3?.kind === "number" ? r3.value : 0,
    ];
    const aDict = (yield* resolveDict(dictGet(dict, "A")));
    let uri: string | undefined;
    if (aDict) {
      const uNode = (yield* resolveNode(dictGet(aDict, "URI")));
      if (uNode?.kind === "string") uri = decodePdfString(uNode);
      if (!uri) {
        const sNode = (yield* resolveNode(dictGet(aDict, "S")));
        if (!sNode || (sNode.kind === "name" && sNode.decoded === "GoTo")) {
          const targetPage = (yield* resolveDestToPageNum(dictGet(aDict, "D")));
          if (targetPage !== undefined) uri = `#page${targetPage}`;
        }
      }
    }
    if (!uri) {
      const targetPage = (yield* resolveDestToPageNum(dictGet(dict, "Dest")));
      if (targetPage !== undefined) uri = `#page${targetPage}`;
    }
    const contentsNode = (yield* resolveNode(dictGet(dict, "Contents")));
    const contents = contentsNode?.kind === "string" ? decodePdfString(contentsNode) : undefined;
    yield { kind: "annotation", annotation: { rect, uri, contents } };
  }
}

/** Preserve annotation destination numbering, including malformed leaf dictionaries.
 * The driver owns exact duplicate tracking, which may live in caller storage. */
export function* annotationPageNumberSteps(root: PdfCosRef | undefined, reference: PdfCosRef, maxDepth = Infinity): AnnotationWork<number | undefined> {
  let index = 0, depth = 0;
  const catalog = yield* resolveDict(root);
  let node = catalog ? dictGet(catalog, "Pages") : undefined;
  let cursor: PdfArrayCursor | undefined, cursorDepth = 0;
  while (true) {
    if (!node) {
      if (!cursor) {
        const frame = yield {kind:"pop-page-frame"};
        if (frame === undefined) return undefined;
        if (typeof frame !== "object" || frame.kind !== "annotation-page-frame") throw new TypeError("Expected an annotation page frame");
        cursor = new PdfArrayCursor(frame.cursor.array, frame.cursor); cursorDepth = frame.depth;
      }
      const step = yield* cursor.next();
      if (step.done) { cursor = undefined; continue; }
      node = step.value; depth = cursorDepth;
      if (!node) continue;
    }
    const current = node; node = undefined;
    if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF annotation page-tree depth limit exceeded");
    if (current.kind === "ref" && !(yield { kind: "visit-page", reference: current })) continue;
    const dict = yield* resolveDict(current);
    if (!dict) continue;
    const type = yield* resolveNode(dictGet(dict, "Type"));
    const kids = yield* resolveArray(dictGet(dict, "Kids"), "Kids");
    if (kids && (type?.kind !== "name" || type.decoded !== "Page")) {
      if (cursor) yield {kind:"push-page-frame",frame:{kind:"annotation-page-frame",cursor:cursor.snapshot(),depth:cursorDepth}};
      cursor = new PdfArrayCursor(kids); cursorDepth = depth + 1;
    } else {
      index++;
      if (current.kind === "ref" && current.objectNumber === reference.objectNumber) return index;
    }
  }
}
