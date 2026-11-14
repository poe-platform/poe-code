import { PdfError } from "../errors.js";
import { PdfArrayCursor } from "./array-cursor.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfContentNode, type PdfPathSegment, type PdfCosArray, type PdfCosDict, type PdfCosNode, type PdfCosStream } from "../ast.js";
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
    const sub = (yield* resolveDict(entry.value, ["Resources", entry.key.decoded]));
    if (sub) {
      onAllocation?.(64 + sub.entries.length * 64);
      // Named lookups already enforce last-key-wins; immutable backing can be
      // shared until an appearance actually adds resources. Font enumeration
      // still requires duplicate normalization before skipping invalid fonts.
      const shareBacking = entry.key.decoded !== "Font";
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
      if (apN?.kind === "dict" && vNode?.kind === "name") {
        apN = (yield* resolveNode(dictGet(apN, vNode.decoded)));
      }
      if (apN?.kind === "stream") {
        const hasContent = yield { kind: "appearance-content", stream: apN };
        if (hasContent === true) {
          onAllocation?.(2048);
          renderedApStream = true;
          const apRes = (yield* resolveDict(dictGet(apN.dict, "Resources"), ["Resources"]));
          if (apRes) {
            for (const subKey of ["Font", "XObject", "ExtGState", "ColorSpace", "Pattern", "Shading"]) {
              const srcSub = (yield* resolveDict(dictGet(apRes, subKey), ["Resources", subKey]));
              if (!srcSub) continue;
              let dstSub = (yield* resolveDict(dictGet(evalResourcesDict, subKey), ["Resources", subKey]));
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
          if (r2Node?.kind === "number") rx0 = Math.min(rx0, r2Node.value);
          if (r3Node?.kind === "number") ry0 = Math.min(ry0, r3Node.value);
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
          ops.push({ kind: "path-op", segments: [{ kind: "rect", x: bx0, y: by0, width: bw, height: bh }], paint: "n", clip: "W" });
          yield { kind: "appearance", stream: apN, nodes: ops };
        }
      }

      const subNode = (yield* resolveNode(dictGet(annotDict, "Subtype")));
      if (!apN || apN.kind === "null") {
        const markup = yield* markupAppearance(annotDict, subNode?.kind === "name" ? subNode.decoded : "", onAllocation);
        if (markup) { yield {kind:"appearance",nodes:[markup]}; continue; }
      }
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

/** PDF markup dictionaries are sufficient to draw common annotations without /AP. */
function* markupAppearance(annot: PdfCosDict, subtype: string, onAllocation?: (bytes: number) => void): AppearanceWork<PdfContentNode | undefined> {
  if (!["Highlight", "Underline", "StrikeOut", "Squiggly", "Square", "Circle", "Ink"].includes(subtype)) return;
  let remaining = 65536;
  function* numbers(node: PdfCosNode | undefined): AppearanceWork<number[] | undefined> {
    if (!node) return;
    const resolved = yield* resolveNode(node);
    if (resolved?.kind === "null") return;
    const array = resolved?.kind === "array" ? resolved : undefined;
    if (!array) throw new PdfError("E_PARSE", "Invalid PDF markup coordinates");
    const cursor = new PdfArrayCursor(array), out: number[] = [];
    for (let step = yield* cursor.next(); !step.done; step = yield* cursor.next()) {
      if (--remaining < 0) throw new PdfError("E_LIMIT", "PDF markup geometry limit exceeded");
      const value = yield* resolveNode(step.value);
      if (value?.kind !== "number" || !Number.isFinite(value.value)) throw new PdfError("E_PARSE", "Invalid PDF markup coordinates");
      onAllocation?.(16); out.push(value.value);
    }
    return out;
  }
  const rect = yield* numbers(dictGet(annot, "Rect"));
  if (!rect || rect.length !== 4) throw new PdfError("E_PARSE", "Invalid PDF markup rectangle");
  let bounds=[Math.min(rect[0]!,rect[2]!),Math.min(rect[1]!,rect[3]!),Math.max(rect[0]!,rect[2]!),Math.max(rect[1]!,rect[3]!)];
  const ops: PdfContentNode[] = [];
  const state = (operator: string, values: number[]) => { onAllocation?.(64 + values.length * 32); ops.push({kind:"state-op",operator,operands:values.map(v=>cosNumber(v))}); };
  const path = (segments: PdfPathSegment[], paint: "S" | "f" | "b" | "s") => { onAllocation?.(64 + segments.length * 96); ops.push({kind:"path-op",segments,paint}); };
  function color(values: number[] | undefined, stroke: boolean) {
    if (!values?.length) return false;
    if (![1,3,4].includes(values.length)) throw new PdfError("E_PARSE", "Invalid PDF markup color");
    state(values.length === 1 ? stroke ? "G" : "g" : values.length === 3 ? stroke ? "RG" : "rg" : stroke ? "K" : "k", values);
    return true;
  }
  const opacity = yield* resolveNode(dictGet(annot, "CA"));
  if (opacity && opacity.kind !== "null" && (opacity.kind !== "number" || !Number.isFinite(opacity.value))) throw new PdfError("E_PARSE", "Invalid PDF markup opacity");
  const alpha = opacity?.kind === "number" ? Math.max(0,Math.min(1,opacity.value)) : 1;
  onAllocation?.(512);
  ops.push({kind:"state-op",operator:"gs",operands:[cosDict({CA:cosNumber(alpha),ca:cosNumber(alpha),BM:cosName(subtype === "Highlight" ? "Multiply" : "Normal")})]});
  const c = yield* numbers(dictGet(annot,"C"));
  if (["Highlight","Underline","StrikeOut","Squiggly"].includes(subtype)) {
    const quads = yield* numbers(dictGet(annot,"QuadPoints"));
    if (!quads?.length) return;
    if (quads.length % 8) throw new PdfError("E_PARSE", "Invalid PDF markup quadrilaterals");
    bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(let i=0;i<quads.length;i+=2) {bounds[0]=Math.min(bounds[0]!,quads[i]!);bounds[1]=Math.min(bounds[1]!,quads[i+1]!);bounds[2]=Math.max(bounds[2]!,quads[i]!);bounds[3]=Math.max(bounds[3]!,quads[i+1]!);}
    color(c ?? (subtype === "Highlight" ? [1,1,0] : [0]),subtype !== "Highlight");
    state("w",[1]);
    for (let i=0;i<quads.length;i+=8) {
      const q=quads.slice(i,i+8);
      const left=Math.min(q[0]!,q[2]!,q[4]!,q[6]!),right=Math.max(q[0]!,q[2]!,q[4]!,q[6]!);
      const bottom=Math.min(q[1]!,q[3]!,q[5]!,q[7]!),top=Math.max(q[1]!,q[3]!,q[5]!,q[7]!);
      if (subtype === "Highlight") {
        path([{kind:"move",x:q[0]!,y:q[1]!},{kind:"line",x:q[2]!,y:q[3]!},{kind:"line",x:q[6]!,y:q[7]!},{kind:"line",x:q[4]!,y:q[5]!},{kind:"close"}],"f");
      } else if (subtype === "Squiggly") {
        const count=Math.ceil((right-left)/2);
        if (!Number.isFinite(count) || count > remaining) throw new PdfError("E_LIMIT", "PDF markup geometry limit exceeded");
        remaining-=count;
        const segments: PdfPathSegment[]=[{kind:"move",x:left,y:bottom+2}];
        for(let n=1;n<=count;n++) {
          const x=Math.min(right,left+n*2),fraction=(x-left-(n-1)*2)/2;
          segments.push({kind:"line",x,y:bottom+((n%2 ? 2 : 0)+(n%2 ? -2 : 2)*fraction)});
        }
        path(segments,"S");
      } else {
        const y=subtype === "Underline" ? bottom+1 : (bottom+top)/2;
        path([{kind:"move",x:left,y},{kind:"line",x:right,y}],"S");
      }
    }
  } else {
    const bs=yield* resolveDict(dictGet(annot,"BS"));
    const border=yield* resolveArray(dictGet(annot,"Border"));
    let borderWidth: number | undefined, borderDash: PdfCosNode | undefined;
    if(border) {
      const cursor=new PdfArrayCursor(border);let count=0;
      for(let step=yield* cursor.next();!step.done;step=yield* cursor.next()) {
        if(++count>4) throw new PdfError("E_PARSE","Invalid PDF markup border");
        if(count===4) borderDash=step.value;
        else {
          const value=yield* resolveNode(step.value);
          if(value?.kind!=="number" || !Number.isFinite(value.value)) throw new PdfError("E_PARSE","Invalid PDF markup border");
          if(count===3) borderWidth=value.value;
        }
      }
      if(count<3) throw new PdfError("E_PARSE","Invalid PDF markup border");
    }
    const w=bs ? yield* resolveNode(dictGet(bs,"W")) : undefined;
    if (w && (w.kind !== "number" || !Number.isFinite(w.value))) throw new PdfError("E_PARSE","Invalid PDF markup border");
    const width=Math.max(0,w?.kind === "number" ? w.value : borderWidth ?? 1);
    state("w",[width]);
    const stroke=color(c ?? [0],true) && width>0;
    const style=bs ? yield* resolveNode(dictGet(bs,"S")) : undefined;
    if ((style?.kind === "name" && style.decoded === "D") || (!bs && borderDash)) {
      const dash=(yield* numbers(bs ? dictGet(bs,"D") : borderDash)) ?? [3];
      if (dash.some(v=>v<0) || (dash.length>0 && !dash.some(v=>v>0))) throw new PdfError("E_PARSE","Invalid PDF markup dash");
      ops.push({kind:"state-op",operator:"d",operands:[cosArray(dash.map(v=>cosNumber(v))),cosNumber(0)]});
    }
    if (subtype === "Ink") {
      bounds=bounds.map((v,i)=>v+(i<2 ? -width/2 : width/2));
      const lists=yield* resolveArray(dictGet(annot,"InkList"));
      if (!lists || !stroke) return;
      const cursor=new PdfArrayCursor(lists);
      for(let step=yield* cursor.next();!step.done;step=yield* cursor.next()) {
        if (--remaining<0) throw new PdfError("E_LIMIT","PDF markup geometry limit exceeded");
        const points=yield* numbers(step.value);
        if (!points || points.length%2) throw new PdfError("E_PARSE","Invalid PDF ink coordinates");
        if (points.length<2) continue;
        const segments:PdfPathSegment[]=[{kind:"move",x:points[0]!,y:points[1]!}];
        for(let i=0;i<points.length;i+=2) segments.push({kind:"line",x:points[i]!,y:points[i+1]!});
        path(segments,"S");
      }
    } else {
      const fill=color(yield* numbers(dictGet(annot,"IC")),false);
      if (!fill && !stroke) return;
      const inset=width/2,x=Math.min(rect[0]!,rect[2]!)+inset,y=Math.min(rect[1]!,rect[3]!)+inset;
      const rw=Math.abs(rect[2]!-rect[0]!)-width,rh=Math.abs(rect[3]!-rect[1]!)-width;
      if (rw<=0 || rh<=0) return;
      const paint=fill ? stroke ? "b" : "f" : "s";
      if (subtype === "Square") path([{kind:"rect",x,y,width:rw,height:rh}],paint);
      else {
        const cx=x+rw/2,cy=y+rh/2,rx=rw/2,ry=rh/2,k=0.5523;
        path([{kind:"move",x:cx,y:y+rh},
          {kind:"cubic",x1:cx+k*rx,y1:y+rh,x2:x+rw,y2:cy+k*ry,x:x+rw,y:cy},
          {kind:"cubic",x1:x+rw,y1:cy-k*ry,x2:cx+k*rx,y2:y,x:cx,y:y},
          {kind:"cubic",x1:cx-k*rx,y1:y,x2:x,y2:cy-k*ry,x:x,y:cy},
          {kind:"cubic",x1:x,y1:cy+k*ry,x2:cx-k*rx,y2:y+rh,x:cx,y:y+rh}],paint);
      }
    }
  }
  ops.unshift({kind:"path-op",segments:[{kind:"rect",x:bounds[0]!,y:bounds[1]!,width:bounds[2]!-bounds[0]!,height:bounds[3]!-bounds[1]!}],paint:"n",clip:"W"});
  return {kind:"graphics-group",ops};
}
