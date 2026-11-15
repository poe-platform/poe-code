import { tokenizeCos } from "../cos/lexer.js";
import { encodeWinAnsiBytes, STANDARD_14_FONTS, normalizeStandard14FontName } from "../fonts/standard14.js";
import { PdfError } from "../errors.js";
import { PdfArrayCursor } from "./array-cursor.js";
import { cosArray, cosDict, cosName, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfContentNode, type PdfPathSegment, type PdfCosArray, type PdfCosDict, type PdfCosNode, type PdfCosStream } from "../ast.js";
import { optionalContentVisibilitySteps } from "./evaluator.js";

export type PdfAppearanceRequest = { readonly kind: "dictionary-value"; readonly dict: PdfCosDict; readonly key: string } | { readonly kind: "dictionary-merge"; readonly destination: PdfCosDict; readonly source?: PdfCosDict } | { readonly kind: "resolve"; readonly node: PdfCosNode; readonly arrayPathPrefix?: readonly string[] }
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
function* field(dict: PdfCosDict, key: string): AppearanceWork<PdfCosNode | undefined> {
  if (!dict.storedEntries) return dictGet(dict, key);
  const value = yield {kind: "dictionary-value", dict, key};
  if (typeof value === "boolean") throw new TypeError("Expected a PDF dictionary value");
  return value;
}

function* widgetAppearance(annot: PdfCosDict, resources: PdfCosDict, allocate?: (bytes: number) => void): AppearanceWork<PdfContentNode | undefined> {
  function* inherited(key: string): AppearanceWork<PdfCosNode | undefined> {
    let current: PdfCosDict | undefined = annot;
    for (let depth = 0; current && depth < 128; depth++) {
      const value = yield* resolveNode(yield* field(current, key));
      if (value && value.kind !== "null") return value;
      current = yield* resolveDict(yield* field(current, "Parent"));
    }
    if (current) throw new PdfError("E_LIMIT", "PDF widget parent depth limit exceeded");
    return undefined;
  }
  const kind = yield* inherited("FT");
  if (kind?.kind !== "name" || !["Tx", "Ch", "Btn"].includes(kind.decoded)) return undefined;
  const flagsNode = yield* inherited("Ff");
  const flags = flagsNode?.kind === "number" ? flagsNode.value | 0 : 0;
  const button = kind.decoded === "Btn", push = button && (flags & 65536) !== 0;
  const radio = button && !push && (flags & 32768) !== 0;
  const stateNode = button ? yield* resolveNode(yield* field(annot, "AS")) : undefined;
  // Appearance state belongs to this widget; a parent value can select a sibling.
  const checked = stateNode?.kind === "name" && stateNode.decoded !== "Off";
  function* numbers(node: PdfCosNode | undefined): AppearanceWork<number[]> {
    const value = yield* resolveArray(node);
    if (!value) return [];
    const cursor = new PdfArrayCursor(value), out: number[] = [];
    for (let step = yield* cursor.next(); !step.done; step = yield* cursor.next()) {
      if (out.length >= 256) throw new PdfError("E_LIMIT", "PDF widget numeric array limit exceeded");
      const number = yield* resolveNode(step.value);
      if (number?.kind !== "number" || !Number.isFinite(number.value)) throw new PdfError("E_PARSE", "Invalid PDF widget geometry");
      out.push(number.value);
    }
    allocate?.(out.length * 8);
    return out;
  }
  const rect = yield* numbers(dictGet(annot, "Rect"));
  if (rect.length !== 4) throw new PdfError("E_PARSE", "Invalid PDF widget rectangle");
  const rx = Math.min(rect[0]!, rect[2]!), ry = Math.min(rect[1]!, rect[3]!);
  const rw = Math.abs(rect[2]! - rect[0]!), rh = Math.abs(rect[3]! - rect[1]!);
  const mk = yield* resolveDict(dictGet(annot, "MK"));
  const rotationNode = mk ? yield* resolveNode(yield* field(mk, "R")) : undefined;
  const rotation = rotationNode?.kind === "number" ? ((rotationNode.value % 360) + 360) % 360 : 0;
  if (![0,90,180,270].includes(rotation) || !Number.isFinite(rw+rh+rx+ry)) throw new PdfError("E_PARSE", "Invalid PDF widget geometry");
  const matrix = rotation === 90 ? [0,1,-1,0,rx+rw,ry] : rotation === 180 ? [-1,0,0,-1,rx+rw,ry+rh] : rotation === 270 ? [0,-1,1,0,rx,ry+rh] : [1,0,0,1,rx,ry];
  const x=0, y=0, width = rotation % 180 ? rh : rw, height = rotation % 180 ? rw : rh;
  if (!width || !height) return {kind: "graphics-group", ops: []};
  const catalogValue = yield {kind: "catalog"};
  const catalog = typeof catalogValue === "object" && catalogValue?.kind === "dict" ? catalogValue : undefined;
  const form = catalog ? yield* resolveDict(yield* field(catalog, "AcroForm")) : undefined;
  const formResources = form ? yield* resolveDict(yield* field(form, "DR")) : undefined;
  const formFonts = formResources ? yield* resolveDict(yield* field(formResources, "Font")) : undefined;
  const daValue = (yield* inherited("DA")) ?? (form ? yield* resolveNode(yield* field(form, "DA")) : undefined);
  const da = daValue?.kind === "string" ? decodePdfString(daValue) : "/Helv 12 Tf 0 g";
  if (da.length > 65536) throw new PdfError("E_LIMIT", "PDF widget appearance limit exceeded");
  allocate?.(da.length * 32);
  const tokens = tokenizeCos(new TextEncoder().encode(da));
  let sourceName = "Helv", size = 12;
  let color: {operator: string; operands: PdfCosNode[]} = {operator: "g", operands: [cosNumber(0)]};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "keyword") continue;
    if (token.value === "Tf" && i >= 2) {
      const name = tokens[i-2]!, value = tokens[i-1]!;
      if (name.kind === "name") sourceName = name.decoded;
      if (value.kind === "number" && Number.isFinite(value.value)) size = value.value;
    }
    const count = token.value === "g" ? 1 : token.value === "rg" ? 3 : token.value === "k" ? 4 : 0;
    if (count && i >= count) {
      const values = tokens.slice(i-count, i);
      if (values.every(n => n.kind === "number" && Number.isFinite(n.value))) color = {operator: token.value, operands: values.map(n => cosNumber(n.kind === "number" ? n.value : 0))};
    }
  }
  if (button && !push) sourceName = "ZapfDingbats";
  let font = formFonts && !(button && !push) ? yield* field(formFonts, sourceName) : undefined;
  let fontDict = yield* resolveDict(font);
  const aliases: Record<string, string> = {Helv: "Helvetica", HeBo: "Helvetica-Bold", HeOb: "Helvetica-Oblique", HeBI: "Helvetica-BoldOblique", Cour: "Courier", CoBo: "Courier-Bold", TiRo: "Times-Roman", TiBo: "Times-Bold", TiIt: "Times-Italic"};
  const base = fontDict ? yield* resolveNode(yield* field(fontDict, "BaseFont")) : undefined;
  const baseName = base?.kind === "name" ? base.decoded : aliases[sourceName] ?? sourceName;
  if (!fontDict) {
    fontDict = cosDict({Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(baseName), ...(!(button && !push) ? {Encoding: cosName("WinAnsiEncoding")} : {})});
    font = fontDict;
  }
  const metrics = STANDARD_14_FONTS[normalizeStandard14FontName(baseName)];
  const widths = yield* numbers(yield* field(fontDict, "Widths"));
  const first = yield* resolveNode(yield* field(fontDict, "FirstChar"));
  const firstCode = first?.kind === "number" ? first.value : 0;
  const advance = (code: number) => widths[code-firstCode] ?? metrics.widthsByCode[code] ?? metrics.defaultWidth;
  const alignNode = yield* inherited("Q"), maxNode = yield* inherited("MaxLen");
  const align = button ? 1 : alignNode?.kind === "number" ? alignNode.value : 0;
  let characters = 0;
  const string = (node: PdfCosNode | undefined) => {
    const text = node?.kind === "string" ? decodePdfString(node) : node?.kind === "name" && node.decoded !== "Off" ? node.decoded : "";
    characters += text.length;
    if (characters > 65536) throw new PdfError("E_LIMIT", "PDF widget text limit exceeded");
    allocate?.(text.length*32);
    return text;
  };
  const value = yield* inherited("V"), values: string[] = [];
  if (value?.kind === "array") {
    const cursor = new PdfArrayCursor(value);
    for (let step=yield* cursor.next(); !step.done; step=yield* cursor.next()) {
      if (values.length >= 4096) throw new PdfError("E_LIMIT", "PDF widget choice limit exceeded");
      values.push(string(yield* resolveNode(step.value)));
    }
  } else values.push(string(value));
  let text = values[0] ?? "";
  let round = radio;
  if (button) {
    const caption = string(mk ? yield* resolveNode(yield* field(mk, "CA")) : undefined);
    const mark = caption[0] && "48Hlnu".includes(caption[0]) ? caption[0] : radio ? "l" : "4";
    round = radio && mark === "l";
    text = push ? caption : checked ? mark : "";
  }
  const choices: {text: string; selected: boolean}[] = [];
  const list = kind.decoded === "Ch" && !(flags & 131072);
  if (kind.decoded === "Ch") {
    const options = yield* inherited("Opt");
    const selected = yield* numbers(yield* inherited("I"));
    if (options?.kind === "array") {
      const cursor = new PdfArrayCursor(options);
      for (let step=yield* cursor.next(); !step.done; step=yield* cursor.next()) {
        if (choices.length >= 4096) throw new PdfError("E_LIMIT", "PDF widget choice limit exceeded");
        const option = yield* resolveNode(step.value);
        let exported: string, label: string;
        if (option?.kind === "array") {
          const pair = new PdfArrayCursor(option), first=yield* pair.next(), second=yield* pair.next();
          exported=string(first.done ? undefined : yield* resolveNode(first.value));
          label=second.done ? exported : string(yield* resolveNode(second.value));
        } else exported=label=string(option);
        if (values[0] === exported) text=label;
        choices.push({text:label,selected:selected.length ? selected.includes(choices.length) : values.includes(exported)});
      }
    }
  }
  allocate?.(2048+choices.length*64);
  if (kind.decoded === "Tx" && flags & 8192) text = "*".repeat(text.length);
  const multiline = kind.decoded === "Tx" && (flags & 4096) !== 0;
  text = text.replace(/\r\n?/g, "\n");
  if (!multiline) text = text.replace(/\n/g, " ");
  const background = yield* numbers(mk ? yield* field(mk, "BG") : undefined);
  const borderColor = yield* numbers(mk ? yield* field(mk, "BC") : undefined);
  const bs = yield* resolveDict(dictGet(annot, "BS"));
  const oldBorder = yield* resolveArray(dictGet(annot, "Border"));
  const oldValues: number[] = []; let oldDash: PdfCosNode | undefined;
  if (oldBorder) {
    const cursor=new PdfArrayCursor(oldBorder);
    for (let i=0; i<4; i++) {
      const step=yield* cursor.next(); if(step.done) break;
      if(i===3) oldDash=step.value;
      else {
        const value=yield* resolveNode(step.value);
        if(value?.kind!=="number" || !Number.isFinite(value.value)) throw new PdfError("E_PARSE", "Invalid PDF widget border");
        oldValues.push(value.value);
      }
    }
  }
  const widthNode = bs ? yield* resolveNode(yield* field(bs, "W")) : undefined;
  if (widthNode && widthNode.kind !== "number") throw new PdfError("E_PARSE", "Invalid PDF widget border");
  const borderWidth = widthNode?.kind === "number" ? widthNode.value : oldValues[2] ?? 1;
  if (!Number.isFinite(borderWidth) || Math.abs(borderWidth) > 1e6) throw new PdfError("E_PARSE", "Invalid PDF widget border");
  const styleNode = bs ? yield* resolveNode(yield* field(bs, "S")) : undefined;
  const style = styleNode?.kind === "name" ? styleNode.decoded : !bs && oldDash ? "D" : "S";
  const relief = style === "B" || style === "I";
  const border = borderColor.length || relief ? Math.min(Math.max(0,borderWidth), relief ? Math.min(width,height)/4 : Infinity) : 0;
  const comb = kind.decoded === "Tx" && (flags & 16777216) !== 0 && !(flags & (4096|8192|1048576)) && maxNode?.kind === "number" && Number.isSafeInteger(maxNode.value) && maxNode.value > 0;
  const count = comb ? maxNode.value : 0;
  if (count > 65536) throw new PdfError("E_LIMIT", "PDF widget cell limit exceeded");
  allocate?.(count*128);
  const padding = border * (relief ? 2 : 1) + 1, available = Math.max(0, width - 2*padding);
  if (button && !push) size = Math.max(.1, Math.min(available, height-2*padding)*.9);
  else if (size <= 0) {
    const units = [...encodeWinAnsiBytes(text)].reduce((sum, c) => sum + advance(c), 0) / 1000;
    size = Math.max(.1, Math.min(12, (height-2*padding)/1.2, !multiline && units ? available/units : 12));
  }
  if (!Number.isFinite(size) || size > 1e6 || !Number.isFinite(border)) throw new PdfError("E_PARSE", "Invalid PDF widget size");
  let fonts = yield* resolveDict(dictGet(resources, "Font"));
  if (!fonts) fonts = cosDict({});
  let name = "WidgetFont", suffix = 0;
  while (yield* field(fonts, name)) {
    if (++suffix > 65536) throw new PdfError("E_LIMIT", "PDF widget font limit exceeded");
    name = `WidgetFont${suffix}`;
  }
  if (fonts.storedEntries) fonts = (yield {kind: "dictionary-merge", destination: fonts, source: cosDict({[name]: font!})}) as PdfCosDict;
  else dictSet(fonts, name, font!);
  dictSet(resources, "Font", fonts);
  const ops: PdfContentNode[] = [];
  const state = (operator: string, values: number[]) => ops.push({kind: "state-op", operator, operands: values.map(n => cosNumber(n))});
  const paintColor = (values: number[], stroke: boolean) => {
    if (!values.length) return;
    const op = values.length === 1 ? "g" : values.length === 3 ? "rg" : values.length === 4 ? "k" : undefined;
    if (!op) throw new PdfError("E_PARSE", "Invalid PDF widget color");
    state(stroke ? op.toUpperCase() : op, values);
  };
  const box = (xx: number, yy: number, w: number, h: number, paint: "f" | "S" | "n", clip?: "W") => ops.push({kind: "path-op", segments: [{kind: "rect", x: xx, y: yy, width: w, height: h}], paint, ...(clip ? {clip} : {})});
  const circle = (radius: number, paint: "f" | "S") => {
    const cx=width/2, cy=height/2, r=Math.max(0,radius), k=r*.5523;
    ops.push({kind:"path-op",segments:[{kind:"move",x:cx,y:cy+r},
      {kind:"cubic",x1:cx+k,y1:cy+r,x2:cx+r,y2:cy+k,x:cx+r,y:cy},
      {kind:"cubic",x1:cx+r,y1:cy-k,x2:cx+k,y2:cy-r,x:cx,y:cy-r},
      {kind:"cubic",x1:cx-k,y1:cy-r,x2:cx-r,y2:cy-k,x:cx-r,y:cy},
      {kind:"cubic",x1:cx-r,y1:cy+k,x2:cx-k,y2:cy+r,x:cx,y:cy+r}],paint});
  };
  state("cm",matrix);
  box(x, y, width, height, "n", "W");
  if (background.length) { paintColor(background, false); if(round) circle(Math.min(width,height)/2,"f"); else box(x,y,width,height,"f"); }
  if (border && borderColor.length) {
    paintColor(borderColor, true); state("w", [border]);
    if (style === "D") {
      const dash = yield* numbers(bs ? yield* field(bs, "D") : oldDash);
      if (dash.some(n => n < 0) || (dash.length && dash.every(n => n === 0))) throw new PdfError("E_PARSE", "Invalid PDF widget dash");
      ops.push({kind: "state-op", operator: "d", operands: [cosArray((dash.length ? dash : [3]).map(n => cosNumber(n))), cosNumber(0)]});
    }
    if (round) circle((Math.min(width,height)-border)/2,"S");
    else if (style === "U") ops.push({kind: "path-op", segments: [{kind: "move", x, y: y+border/2}, {kind: "line", x:x+width, y:y+border/2}], paint: "S"});
    else box(x+border/2,y+border/2,Math.max(0,width-border),Math.max(0,height-border),"S");
  }
  if (border && relief) {
    // PDFium's interactive forms use different bevel shading for circular controls.
    const bg = background.length ? background : [1];
    const shades = style === "I" ? [[.5],[.75]] : [[1],bg.map(v => round ? Math.max(0,v-.25) : v/2)];
    allocate?.(4096);
    const b = border;
    for (let side=0;side<2;side++) {
      paintColor(shades[side]!, round);
      if (round) {
        state("w",[b]);
        const r=Math.max(0,Math.min(width,height)/2-1.5*b), cx=width/2, cy=height/2;
        const start=Math.PI/4+side*Math.PI;
        const segments: PdfPathSegment[]=[{kind:"move",x:cx+r*Math.cos(start),y:cy+r*Math.sin(start)}];
        for(let j=0;j<2;j++) {
          const a=start+j*Math.PI/2, z=a+Math.PI/2, k=.5523*r;
          segments.push({kind:"cubic",x1:cx+r*Math.cos(a)-k*Math.sin(a),y1:cy+r*Math.sin(a)+k*Math.cos(a),x2:cx+r*Math.cos(z)+k*Math.sin(z),y2:cy+r*Math.sin(z)-k*Math.cos(z),x:cx+r*Math.cos(z),y:cy+r*Math.sin(z)});
        }
        ops.push({kind:"path-op",segments,paint:"S"});
      } else {
        const points=side===0 ? [[b,b],[b,height-b],[width-b,height-b],[width-2*b,height-2*b],[2*b,height-2*b],[2*b,2*b]]
          : [[b,b],[width-b,b],[width-b,height-b],[width-2*b,height-2*b],[width-2*b,2*b],[2*b,2*b]];
        ops.push({kind:"path-op",segments:[...points.map(([px,py],i): PdfPathSegment => ({kind:i===0 ? "move" : "line",x:px!,y:py!})),{kind:"close"}],paint:"f"});
      }
    }
  }
  if (comb && border && ["S","D"].includes(style)) {
    for(let i=1; i<count; i++) ops.push({kind:"path-op",segments:[{kind:"move",x:i*width/count,y:0},{kind:"line",x:i*width/count,y:height}],paint:"S"});
  }
  box(x+padding,y+padding,available,Math.max(0,height-2*padding),"n","W");
  ops.push({kind: "state-op", ...color});
  if (radio && text === "l") {
    circle(Math.max(0,Math.min(available,height-2*padding))/4,"f");
    return {kind:"graphics-group",ops};
  }
  if (list) {
    const topNode=yield* inherited("TI"), top=topNode?.kind==="number" ? Math.max(0,Math.floor(topNode.value)) : 0;
    const leading=size*1.2;
    for(let i=top; i<choices.length && (i-top)*leading<height-2*padding; i++) {
      const item=choices[i]!, bottom=height-padding-(i-top+1)*leading;
      if(item.selected) { paintColor([0,.2,113/255],false); box(padding,bottom,available,leading,"f"); paintColor([1],false); }
      else ops.push({kind:"state-op",...color});
      ops.push({kind:"text-object",commands:[{kind:"font",fontName:name,size},{kind:"move",tx:padding,ty:height-padding-size*.8-(i-top)*leading},{kind:"show-text",token:cosString(encodeWinAnsiBytes(item.text))}]});
    }
    return {kind:"graphics-group",ops};
  }
  const bytes = encodeWinAnsiBytes(text), lines: Uint8Array[] = [];
  // Keep newlines before encoding: WinAnsi has no newline glyph.
  for (const paragraph of text.split("\n")) {
    let remaining = encodeWinAnsiBytes(paragraph);
    while (multiline && remaining.length) {
      let end = 0, lastSpace = -1, used = 0;
      for (; end < remaining.length; end++) {
        const next = advance(remaining[end]!) * size / 1000;
        if (end && used + next > available) break;
        used += next; if (remaining[end] === 32) lastSpace = end;
      }
      if (end === remaining.length) break;
      if (lastSpace > 0) end = lastSpace;
      lines.push(remaining.slice(0, end));
      remaining = remaining.subarray(end + (remaining[end] === 32 ? 1 : 0));
    }
    lines.push(remaining);
  }
  const baseline = y + (multiline ? height-padding-size*.8 : (height-size*.6)/2);
  if (comb) {
    const cell = width/count, unused=count-Math.min(count,bytes.length), offset=align===2 ? unused : align===1 ? Math.floor(unused/2) : 0;
    for (let i = 0; i < Math.min(count, bytes.length); i++) {
      const code = bytes[i]!;
      ops.push({kind:"text-object",commands:[{kind:"font",fontName:name,size},{kind:"move",tx:x+(i+offset)*cell+(cell-advance(code)*size/1000)/2,ty:baseline},{kind:"show-text",token:cosString(Uint8Array.of(code))}]});
    }
  } else for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, length = [...line].reduce((sum,c) => sum+advance(c)*size/1000,0);
    const left = align === 1 ? (width-length)/2 : align === 2 ? width-padding-length : padding;
    ops.push({kind:"text-object",commands:[{kind:"font",fontName:name,size},{kind:"move",tx:x+Math.max(padding,left),ty:baseline-i*size*1.2},{kind:"show-text",token:cosString(line)}]});
  }
  return {kind:"graphics-group",ops};
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
      const rectItems: PdfCosNode[]=[];
      if(rectArr) {
        const cursor=new PdfArrayCursor(rectArr);
        for(let i=0;i<4;i++) {const step=yield* cursor.next();if(step.done)break;rectItems.push(step.value);}
      }
      let rx0 = 50;
      let ry0 = 700;
      if (rectItems.length >= 2) {
        const r0 = (yield* resolveNode(rectItems[0]));
        const r1 = (yield* resolveNode(rectItems[1]));
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
        renderedApStream = true;
        const hasContent = yield { kind: "appearance-content", stream: apN };
        if (hasContent === true) {
          onAllocation?.(2048);
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

          const r2Node = rectItems[2] ? (yield* resolveNode(rectItems[2])) : undefined;
          const r3Node = rectItems[3] ? (yield* resolveNode(rectItems[3])) : undefined;
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
      const widget = yield* widgetAppearance(annotDict, evalResourcesDict, onAllocation);
      if (widget) { yield {kind: "appearance", nodes: [widget]}; continue; }

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
