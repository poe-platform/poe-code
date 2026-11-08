/* Command recovery adapted from Mozilla PDF.js EvaluatorPreprocessor.
 * Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import {
  decodePdfString,
  dictGet,
  type PdfContentNode,
  type PdfStoredBytes,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosNumber,
  type PdfCosString,
  type PdfPathSegment,
  type PdfStoredPath,
  type PdfTextCommand,
} from "../ast.js";
import type { PdfFileSource } from "../source.js";
import { parseContentOperators, type PdfContentOperator } from "./operator-parser.js";

const PATH_PAINT_OPS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);

function numVal(node: PdfCosNode | undefined, fallback = 0): number {
  return node?.kind === "number" ? node.value : fallback;
}

/** Borrowed inline-image bytes. The caller keeps source open through decoding. */
export interface PdfContentRange {
  readonly kind: "range";
  readonly source: PdfFileSource;
  readonly start: number;
  readonly end: number;
}
export type PdfBufferedContentEvent = PdfContentNode
  | { readonly kind: "begin-group"; readonly group: Extract<PdfContentNode, { kind: "graphics-group" | "marked-content" }> }
  | { readonly kind: "end-group" };
export type PdfContentEvent = PdfBufferedContentEvent
  | { readonly kind: "inline-image"; readonly dict: PdfCosDict; readonly data: PdfContentRange };
export type PdfContentParseRequest = { readonly kind: "operator" }
  | { readonly kind: "inline-image"; readonly start: number; readonly end: number }
  | { readonly kind: "path-segment"; readonly segment: PdfPathSegment }
  | { readonly kind: "finish-path" }
  | { readonly kind: "event"; readonly event: PdfContentEvent };
export type PdfContentParseResult = PdfContentOperator | Uint8Array | PdfContentRange | PdfStoredPath | undefined;
type ParseWork = Generator<PdfContentParseRequest, void, PdfContentParseResult>;

/** Shared grammar with caller-supplied operators and inline-image bytes or ranges. Group
 * boundaries are events; text is emitted incrementally unless a buffered caller
 * explicitly requests the original text-object grouping. */
export function* parseContentSteps(options: { readonly splitText?: boolean; readonly storedPaths?: boolean } = {}): ParseWork {
  const splitText = options.splitText ?? true;
  function* emit(event: PdfContentEvent): ParseWork { yield { kind: "event", event }; }

  let inText = false;
  let textContinuation = false;
  let currentTextCommands: PdfTextCommand[] = [];
  let currentPathSegments: PdfPathSegment[] = [];
  function* append(segment: PdfPathSegment): ParseWork {
    if (options.storedPaths) yield {kind:"path-segment", segment};
    else currentPathSegments.push(segment);
  }
  let pendingClip: "W" | "W*" | undefined;
  let curPathX = 0;
  let curPathY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  function* flushInTextCommands(): ParseWork {
    if (!inText) return;
    if (currentTextCommands.length > 0 || !textContinuation) {
      yield* emit({
        kind: "text-object",
        commands: currentTextCommands,
        end: false,
        ...(textContinuation ? { continuation: true } : {}),
      });
      currentTextCommands = [];
      textContinuation = true;
    }
  };

  while (true) {
    const input = yield { kind: "operator" };
    if (input === undefined) break;
    if (input instanceof Uint8Array || "kind" in input) throw new TypeError("Expected a PDF content operator");
    const { operator: op, operands: args, inlineImage } = input;
    if (inlineImage) {
      yield* flushInTextCommands();
      const data = yield { kind: "inline-image", start: inlineImage.start, end: inlineImage.end };
      if (data instanceof Uint8Array) yield* emit({ kind: "inline-image", dict: inlineImage.dict, data });
      else if (data && "kind" in data && data.kind === "range") yield* emit({ kind: "inline-image", dict: inlineImage.dict, data });
      else throw new TypeError("Expected PDF inline-image bytes or retained range");
      continue;
    }

    if (op === "q") {
      yield* flushInTextCommands();
      const group: PdfContentNode = { kind: "graphics-group", ops: [] };
      yield* emit({ kind: "begin-group", group });
      continue;
    }
    if (op === "Q") {
      yield* flushInTextCommands();
      yield* emit({ kind: "end-group" });
      continue;
    }

    if (op === "BMC" || op === "BDC") {
      yield* flushInTextCommands();
      const tagNode = args[0];
      const tag = tagNode?.kind === "name" ? tagNode.decoded : "Span";
      const propNode = args[1];
      let properties: PdfCosDict | string | undefined;
      let actualText: string | undefined;
      let storedActualText: PdfStoredBytes | undefined;
      let mcid: number | undefined;
      if (propNode?.kind === "dict") {
        properties = propNode;
        const at = dictGet(propNode, "ActualText");
        if (at?.kind === "string") { if (at.storedBytes) storedActualText = at.storedBytes; else actualText = decodePdfString(at); }
        const mc = dictGet(propNode, "MCID");
        if (mc?.kind === "number") mcid = mc.value;
      } else if (propNode?.kind === "name") {
        properties = propNode.decoded;
      }
      const mcNode: PdfContentNode = {
        kind: "marked-content",
        tag,
        properties,
        actualText,
        ...(storedActualText ? { storedActualText } : {}),
        mcid,
        children: [],
      };
      yield* emit({ kind: "begin-group", group: mcNode });
      continue;
    }
    if (op === "EMC") {
      yield* flushInTextCommands();
      yield* emit({ kind: "end-group" });
      continue;
    }

    if (op === "BT") {
      inText = true;
      textContinuation = false;
      currentTextCommands = [];
      continue;
    }
    if (op === "ET") {
      if (inText) {
        yield* emit({
          kind: "text-object",
          commands: currentTextCommands,
          end: true,
          ...(textContinuation ? { continuation: true } : {}),
        });
        inText = false;
        textContinuation = false;
        currentTextCommands = [];
      }
      continue;
    }

    if (inText) {
      switch (op) {
        case "Tf": {
          const fName = args[0]?.kind === "name" ? args[0].decoded : "Helvetica";
          const fSize = numVal(args[1], 12);
          currentTextCommands.push({ kind: "font", fontName: fName, size: fSize });
          break;
        }
        case "Tm":
          currentTextCommands.push({
            kind: "matrix",
            matrix: [
              numVal(args[0], 1),
              numVal(args[1], 0),
              numVal(args[2], 0),
              numVal(args[3], 1),
              numVal(args[4], 0),
              numVal(args[5], 0),
            ],
          });
          break;
        case "Td":
          currentTextCommands.push({ kind: "move", tx: numVal(args[0]), ty: numVal(args[1]) });
          break;
        case "TD":
          currentTextCommands.push({
            kind: "move",
            tx: numVal(args[0]),
            ty: numVal(args[1]),
            setLeading: true,
          });
          break;
        case "T*":
          currentTextCommands.push({ kind: "next-line" });
          break;
        case "TL":
          currentTextCommands.push({ kind: "leading", leading: numVal(args[0]) });
          break;
        case "Tc":
          currentTextCommands.push({ kind: "char-spacing", charSpace: numVal(args[0]) });
          break;
        case "Tw":
          currentTextCommands.push({ kind: "word-spacing", wordSpace: numVal(args[0]) });
          break;
        case "Tz":
          currentTextCommands.push({ kind: "horiz-scaling", scalePercent: numVal(args[0], 100) });
          break;
        case "Tr":
          currentTextCommands.push({ kind: "render-mode", mode: numVal(args[0], 0) });
          break;
        case "Ts":
          currentTextCommands.push({ kind: "rise", rise: numVal(args[0], 0) });
          break;
        case "Tj": {
          if (args[0]?.kind === "string") {
            currentTextCommands.push({ kind: "show-text", token: args[0] });
          }
          break;
        }
        case "'": {
          currentTextCommands.push({ kind: "next-line" });
          if (args[0]?.kind === "string") {
            currentTextCommands.push({ kind: "show-text", token: args[0] });
          }
          break;
        }
        case "\"": {
          currentTextCommands.push({ kind: "word-spacing", wordSpace: numVal(args[0]) });
          currentTextCommands.push({ kind: "char-spacing", charSpace: numVal(args[1]) });
          currentTextCommands.push({ kind: "next-line" });
          if (args[2]?.kind === "string") {
            currentTextCommands.push({ kind: "show-text", token: args[2] });
          }
          break;
        }
        case "TJ": {
          if (args[0]?.kind === "array") {
            const items: (PdfCosString | PdfCosNumber)[] = [];
            for (const item of (args[0] as PdfCosArray).items) {
              if (item.kind === "string" || item.kind === "number") {
                items.push(item);
              }
            }
            currentTextCommands.push({ kind: "show-text-array", items, ...(args[0].storedItems ? { storedItems: args[0].storedItems } : {}) });
          }
          break;
        }
        default:
          currentTextCommands.push({ kind: "state-op", operator: op, operands: args });
          break;
      }
      if (splitText) yield* flushInTextCommands();
      continue;
    }

    // Path construction & painting outside BT..ET
    if (op === "m") {
      const mx = numVal(args[0]);
      const my = numVal(args[1]);
      yield* append({ kind: "move", x: mx, y: my });
      curPathX = mx;
      curPathY = my;
      subpathStartX = mx;
      subpathStartY = my;
      continue;
    }
    if (op === "l") {
      const lx = numVal(args[0]);
      const ly = numVal(args[1]);
      yield* append({ kind: "line", x: lx, y: ly });
      curPathX = lx;
      curPathY = ly;
      continue;
    }
    if (op === "c") {
      const x = numVal(args[4]);
      const y = numVal(args[5]);
      yield* append({
        kind: "cubic",
        x1: numVal(args[0]),
        y1: numVal(args[1]),
        x2: numVal(args[2]),
        y2: numVal(args[3]),
        x,
        y,
      });
      curPathX = x;
      curPathY = y;
      continue;
    }
    if (op === "v") {
      const x = numVal(args[2]);
      const y = numVal(args[3]);
      yield* append({
        kind: "cubic",
        x1: curPathX,
        y1: curPathY,
        x2: numVal(args[0]),
        y2: numVal(args[1]),
        x,
        y,
      });
      curPathX = x;
      curPathY = y;
      continue;
    }
    if (op === "y") {
      const x = numVal(args[2]);
      const y = numVal(args[3]);
      yield* append({
        kind: "cubic",
        x1: numVal(args[0]),
        y1: numVal(args[1]),
        x2: x,
        y2: y,
        x,
        y,
      });
      curPathX = x;
      curPathY = y;
      continue;
    }
    if (op === "h") {
      yield* append({ kind: "close" });
      curPathX = subpathStartX;
      curPathY = subpathStartY;
      continue;
    }
    if (op === "re") {
      const rx = numVal(args[0]);
      const ry = numVal(args[1]);
      yield* append({
        kind: "rect",
        x: rx,
        y: ry,
        width: numVal(args[2]),
        height: numVal(args[3]),
      });
      curPathX = rx;
      curPathY = ry;
      subpathStartX = rx;
      subpathStartY = ry;
      continue;
    }
    if (op === "W" || op === "W*") {
      pendingClip = op;
      continue;
    }
    if (PATH_PAINT_OPS.has(op)) {
      const stored = options.storedPaths ? yield {kind:"finish-path"} : undefined;
      if (options.storedPaths && (!stored || !("kind" in stored) || stored.kind !== "stored-path")) throw new TypeError("Expected stored PDF path");
      yield* emit({
        kind: "path-op",
        segments: currentPathSegments,
        ...(stored && "kind" in stored && stored.kind === "stored-path" ? {storedSegments:stored} : {}),
        paint: op as "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n",
        clip: pendingClip,
      });
      currentPathSegments = [];
      pendingClip = undefined;
      continue;
    }
    if (op === "Do") {
      const name = args[0]?.kind === "name" ? args[0].decoded : "Im0";
      yield* emit({ kind: "xobject", name });
      continue;
    }

    yield* emit({ kind: "state-op", operator: op, operands: args });
  }

  if (inText && (currentTextCommands.length > 0 || (splitText && textContinuation))) {
    yield* emit({ kind: "text-object", commands: currentTextCommands,
      ...(splitText && textContinuation ? { continuation: true } : {}) });
  }
}

/** Pull parser events without collecting graphics groups or whole text objects. */
export function* parseContentEvents(bytes: Uint8Array, options: { splitText?: boolean } = {}): Generator<PdfBufferedContentEvent, void, void> {
  const operators = parseContentOperators(bytes);
  const work = parseContentSteps(options);
  let step = work.next();
  try {
    while (!step.done) {
      let result: PdfContentParseResult;
      switch (step.value.kind) {
        case "operator": { const next = operators.next(); result = next.done ? undefined : next.value; break; }
        case "inline-image": result = bytes.subarray(step.value.start, step.value.end); break;
        case "event": {
          const event = step.value.event;
          if (event.kind === "inline-image") {
            if (!(event.data instanceof Uint8Array)) throw new TypeError("Buffered parser received a retained inline image");
            yield { kind: "inline-image", dict: event.dict, data: event.data };
          } else yield event;
          break;
        }
      }
      step = work.next(result);
    }
  } finally { work.return(); operators.return(undefined); }
}

export function parseContentStream(bytes: Uint8Array): PdfContentNode[] {
  const rootNodes: PdfContentNode[] = [];
  const stack: PdfContentNode[][] = [rootNodes];
  for (const event of parseContentEvents(bytes, { splitText: false })) {
    if (event.kind === "end-group") { if (stack.length > 1) stack.pop(); }
    else if (event.kind === "begin-group") {
      stack[stack.length - 1]!.push(event.group);
      stack.push(event.group.kind === "graphics-group" ? event.group.ops : event.group.children);
    } else stack[stack.length - 1]!.push(event);
  }
  return rootNodes;
}
