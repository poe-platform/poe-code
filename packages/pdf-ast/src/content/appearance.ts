import { PdfArrayCursor } from "./array-cursor.js";
import { cosDict, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfContentNode, type PdfCosArray, type PdfCosDict, type PdfCosNode, type PdfCosStream } from "../ast.js";
import { optionalContentVisibilitySteps } from "./evaluator.js";

export type PdfAppearanceRequest = { readonly kind: "dictionary-merge"; readonly destination: PdfCosDict; readonly source?: PdfCosDict } | { readonly kind: "resolve"; readonly node: PdfCosNode; readonly arrayPathPrefix?: readonly string[] }
  | { readonly kind: "array-reference"; readonly items: import("../ast.js").PdfStoredItems; readonly objectNumber: number }
  | { readonly kind: "array-item"; readonly items: import("../ast.js").PdfStoredItems; readonly position: number }
  | { readonly kind: "catalog" }
  | { readonly kind: "appearance-content"; readonly stream: PdfCosStream }
  | { readonly kind: "appearance"; readonly stream?: PdfCosStream; readonly nodes: readonly PdfContentNode[] };
export type PdfAppearanceResult = PdfCosNode | boolean | undefined;
type AppearanceWork<T = void> = Generator<PdfAppearanceRequest, T, PdfAppearanceResult>;
function* resolveNode(node: PdfCosNode | undefined, arrayPathPrefix?: readonly string[]): AppearanceWork<PdfCosNode | undefined> {
  if (!node) return undefined;
  const result = yield { kind: "resolve", node, ...(arrayPathPrefix ? { arrayPathPrefix } : {}) };
  if (typeof result === "boolean") throw new TypeError("Expected a PDF appearance object");
  return result;
}
function* resolveDict(node: PdfCosNode | undefined, arrayPathPrefix?: readonly string[]): AppearanceWork<PdfCosDict | undefined> {
  const value = yield* resolveNode(node, arrayPathPrefix); return value?.kind === "dict" ? value : undefined;
}
function* resolveArray(node: PdfCosNode | undefined, arrayPathPrefix?: readonly string[]): AppearanceWork<PdfCosArray | undefined> {
  const value = yield* resolveNode(node, arrayPathPrefix); return value?.kind === "array" ? value : undefined;
}
function* visible(node: PdfCosNode | undefined): AppearanceWork<boolean> {
  const work = optionalContentVisibilitySteps(node);
  try {
    let step = work.next();
    while (!step.done) {
      if (step.value.kind !== "resolve" && step.value.kind !== "catalog" && step.value.kind !== "array-item" && step.value.kind !== "array-reference") throw new TypeError("Unexpected appearance visibility request");
      const value = yield step.value;
      if (typeof value === "boolean") throw new TypeError("Expected a PDF appearance visibility object");
      step = work.next({ kind: "resolved", node: value });
    }
    return step.value;
  } finally { work.return(false); }
}
/** Prepare resources and emit one appearance at a time. Drivers own content
 * cursors; the program retains only the current annotation and its placement. */
export function* preparePageAppearanceSteps(pageDict: PdfCosDict, pageRes: PdfCosDict, evalResourcesDict: PdfCosDict, hideAnnotations = false, onAllocation?: (bytes: number) => void): AppearanceWork {
  onAllocation?.(64 * pageRes.entries.length);
  for (const entry of pageRes.entries) {
    const sub = (yield* resolveDict(entry.value, [entry.key.decoded]));
    if (sub) {
      onAllocation?.(64 + sub.entries.length * 64);
      // Named lookups already enforce last-key-wins; immutable backing can be
      // shared until an appearance actually adds resources. Font enumeration
      // still requires duplicate normalization before skipping invalid fonts.
      const shareBacking = entry.key.decoded === "XObject" || entry.key.decoded === "Properties";
      const clonedSub = sub.storedEntries
        ? shareBacking ? { ...sub, entries: [] } : (yield {kind: "dictionary-merge", destination: sub}) as PdfCosDict
        : cosDict({});
      if (!sub.storedEntries) for (const se of sub.entries) dictSet(clonedSub, se.key.decoded, se.value);
      dictSet(evalResourcesDict, entry.key.decoded, clonedSub);
    } else {
      dictSet(evalResourcesDict, entry.key.decoded, entry.value);
    }
  }

  const annotsArr = (yield* resolveArray(dictGet(pageDict, "Annots"), ["Annots"]));
  if (!hideAnnotations && annotsArr) {
    const annotations = new PdfArrayCursor(annotsArr);
    for (let step = yield* annotations.next(); !step.done; step = yield* annotations.next()) {
      const item = step.value;
      const annotDict = (yield* resolveDict(item));
      if (!annotDict) continue;
      const fNode = (yield* resolveNode(dictGet(annotDict, "F")));
      const annotFlags = fNode?.kind === "number" ? fNode.value : 0;
      // Skip Hidden (bit 2 = 2) or NoView (bit 6 = 32) annotations on screen
      if ((annotFlags & 2) !== 0 || (annotFlags & 32) !== 0) continue;
      if (!(yield* visible(dictGet(annotDict, "OC")))) continue;

      const rectArr = (yield* resolveArray(dictGet(annotDict, "Rect")));
      let rx0 = 50;
      let ry0 = 700;
      if (rectArr && rectArr.items.length >= 2) {
        const r0 = (yield* resolveNode(rectArr.items[0]));
        const r1 = (yield* resolveNode(rectArr.items[1]));
        if (r0?.kind === "number") rx0 = r0.value;
        if (r1?.kind === "number") ry0 = r1.value;
      }

      const parentDict = (yield* resolveDict(dictGet(annotDict, "Parent")));
      const ownAsOrV = dictGet(annotDict, "AS") ?? dictGet(annotDict, "V");
      const vNode = (yield* resolveNode(
        ownAsOrV ?? (parentDict ? dictGet(parentDict, "V") ?? dictGet(parentDict, "AS") : undefined)
      ));

      let renderedApStream = false;
      const apDict = (yield* resolveDict(dictGet(annotDict, "AP")));
      let apN = apDict ? (yield* resolveNode(dictGet(apDict, "N"))) : undefined;
      if (apN?.kind === "dict" && vNode?.kind === "name" && vNode.decoded !== "Off") {
        apN = (yield* resolveNode(dictGet(apN, vNode.decoded)));
      }
      if (apN?.kind === "stream") {
        const hasContent = yield { kind: "appearance-content", stream: apN };
        if (hasContent === true) {
          onAllocation?.(2048);
          renderedApStream = true;
          const apRes = (yield* resolveDict(dictGet(apN.dict, "Resources")));
          if (apRes) {
            for (const subKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading"]) {
              const srcSub = (yield* resolveDict(dictGet(apRes, subKey), [subKey]));
              if (!srcSub) continue;
              let dstSub = (yield* resolveDict(dictGet(evalResourcesDict, subKey), [subKey]));
              if (!dstSub) {
                onAllocation?.(64);
                dstSub = cosDict({});
                dictSet(evalResourcesDict, subKey, dstSub);
              }
              if (srcSub.storedEntries || dstSub.storedEntries) {
                const merged = (yield {kind: "dictionary-merge", destination: dstSub, source: srcSub}) as PdfCosDict;
                dictSet(evalResourcesDict, subKey, merged);
                continue;
              }
              for (const se of srcSub.entries) {
                if (!dictGet(dstSub, se.key.decoded)) {
                  onAllocation?.(64);
                  dictSet(dstSub, se.key.decoded, se.value);
                }
              }
            }
          }

          const r2Node = rectArr && rectArr.items[2] ? (yield* resolveNode(rectArr.items[2])) : undefined;
          const r3Node = rectArr && rectArr.items[3] ? (yield* resolveNode(rectArr.items[3])) : undefined;
          const rectW = r2Node?.kind === "number" ? Math.max(1, Math.abs(r2Node.value - rx0)) : 20;
          const rectH = r3Node?.kind === "number" ? Math.max(1, Math.abs(r3Node.value - ry0)) : 20;
          const bboxArr = (yield* resolveArray(dictGet(apN.dict, "BBox")));
          let bx0 = 0, by0 = 0, bw = rectW, bh = rectH;
          if (bboxArr && bboxArr.items.length >= 4) {
            const b0 = (yield* resolveNode(bboxArr.items[0]));
            const b1 = (yield* resolveNode(bboxArr.items[1]));
            const b2 = (yield* resolveNode(bboxArr.items[2]));
            const b3 = (yield* resolveNode(bboxArr.items[3]));
            if (b0?.kind === "number" && b1?.kind === "number" && b2?.kind === "number" && b3?.kind === "number") {
              bx0 = Math.min(b0.value, b2.value);
              by0 = Math.min(b1.value, b3.value);
              bw = Math.max(1, Math.abs(b2.value - b0.value));
              bh = Math.max(1, Math.abs(b3.value - b1.value));
            }
          }
          let ma = 1, mb = 0, mc = 0, md = 1, me = 0, mf = 0;
          const matArr = (yield* resolveArray(dictGet(apN.dict, "Matrix")));
          if (matArr && matArr.items.length >= 6) {
            const items = matArr.items;
            function* mn(idx: number, fb = 0): AppearanceWork<number> {
              const r = (yield* resolveNode(items[idx]));
              return r?.kind === "number" ? r.value : fb;
            };
            ma = (yield* mn(0, 1)); mb = (yield* mn(1, 0)); mc = (yield* mn(2, 0)); md = (yield* mn(3, 1)); me = (yield* mn(4, 0)); mf = (yield* mn(5, 0));
          }
          const corners: Array<[number, number]> = [
            [ma * bx0 + mc * by0 + me, mb * bx0 + md * by0 + mf],
            [ma * (bx0 + bw) + mc * by0 + me, mb * (bx0 + bw) + md * by0 + mf],
            [ma * bx0 + mc * (by0 + bh) + me, mb * bx0 + md * (by0 + bh) + mf],
            [ma * (bx0 + bw) + mc * (by0 + bh) + me, mb * (bx0 + bw) + md * (by0 + bh) + mf],
          ];
          const tMinX = Math.min(...corners.map(c => c[0]));
          const tMinY = Math.min(...corners.map(c => c[1]));
          const tW = Math.max(1, Math.max(...corners.map(c => c[0])) - tMinX);
          const tH = Math.max(1, Math.max(...corners.map(c => c[1])) - tMinY);
          const sx = rectW / tW;
          const sy = rectH / tH;
          const tx = rx0 - tMinX * sx;
          const ty = ry0 - tMinY * sy;
          const ops: PdfContentNode[] = [
            {
              kind: "state-op",
              operator: "cm",
              operands: [
                cosNumber(sx),
                cosNumber(0),
                cosNumber(0),
                cosNumber(sy),
                cosNumber(tx),
                cosNumber(ty),
              ],
            },
          ];
          if (matArr && matArr.items.length >= 6) {
            ops.push({
              kind: "state-op",
              operator: "cm",
              operands: [
                cosNumber(ma),
                cosNumber(mb),
                cosNumber(mc),
                cosNumber(md),
                cosNumber(me),
                cosNumber(mf),
              ],
            });
          }
          yield { kind: "appearance", stream: apN, nodes: ops };
        }
      }

      const subNode = (yield* resolveNode(dictGet(annotDict, "Subtype")));
      const isWidget =
        (subNode?.kind === "name" && subNode.decoded === "Widget") ||
        Boolean(dictGet(annotDict, "FT") || dictGet(annotDict, "T") || parentDict);
      if (!isWidget || renderedApStream) continue;

      let valText = "";
      if (vNode?.kind === "string") { onAllocation?.(vNode.bytes.length * 2); valText = decodePdfString(vNode); }
      else if (vNode?.kind === "name" && vNode.decoded !== "Off") valText = vNode.decoded;
      if (!valText) continue;

      onAllocation?.(512 + valText.length * 4);
      yield { kind: "appearance", nodes: [{
        kind: "text-object",
        commands: [
          { kind: "font", fontName: "Helvetica", size: 11 },
          { kind: "move", tx: rx0 + 2, ty: ry0 + 4 },
          { kind: "show-text", token: cosString(valText) },
        ],
      }] };
    }
  }
}
