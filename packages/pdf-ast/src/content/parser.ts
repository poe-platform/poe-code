/* Command recovery adapted from Mozilla PDF.js EvaluatorPreprocessor.
 * Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import {
  decodePdfString,
  dictGet,
  type PdfContentNode,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosNumber,
  type PdfCosString,
  type PdfPathSegment,
  type PdfTextCommand,
} from "../ast.js";
import { parseContentOperators } from "./operator-parser.js";

const PATH_PAINT_OPS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);

function numVal(node: PdfCosNode | undefined, fallback = 0): number {
  return node?.kind === "number" ? node.value : fallback;
}

export function parseContentStream(bytes: Uint8Array): PdfContentNode[] {
  const rootNodes: PdfContentNode[] = [];
  const stack: Array<{ target: PdfContentNode[] }> = [{ target: rootNodes }];

  let inText = false;
  let textContinuation = false;
  let currentTextCommands: PdfTextCommand[] = [];
  let currentPathSegments: PdfPathSegment[] = [];
  let pendingClip: "W" | "W*" | undefined;
  let curPathX = 0;
  let curPathY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  const currentTarget = (): PdfContentNode[] => stack[stack.length - 1]!.target;
  const flushInTextCommands = (): void => {
    if (!inText) return;
    if (currentTextCommands.length > 0 || !textContinuation) {
      currentTarget().push({
        kind: "text-object",
        commands: currentTextCommands,
        end: false,
        ...(textContinuation ? { continuation: true } : {}),
      });
      currentTextCommands = [];
      textContinuation = true;
    }
  };

  for (const { operator: op, operands: args, inlineImage } of parseContentOperators(bytes)) {
    if (inlineImage) {
      flushInTextCommands();
      currentTarget().push({ kind: "inline-image", dict: inlineImage.dict, data: bytes.subarray(inlineImage.start, inlineImage.end) });
      continue;
    }

    if (op === "q") {
      flushInTextCommands();
      const group: PdfContentNode = { kind: "graphics-group", ops: [] };
      currentTarget().push(group);
      stack.push({ target: group.ops });
      continue;
    }
    if (op === "Q") {
      flushInTextCommands();
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (op === "BMC" || op === "BDC") {
      flushInTextCommands();
      const tagNode = args[0];
      const tag = tagNode?.kind === "name" ? tagNode.decoded : "Span";
      const propNode = args[1];
      let properties: PdfCosDict | string | undefined;
      let actualText: string | undefined;
      let mcid: number | undefined;
      if (propNode?.kind === "dict") {
        properties = propNode;
        const at = dictGet(propNode, "ActualText");
        if (at?.kind === "string") actualText = decodePdfString(at);
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
        mcid,
        children: [],
      };
      currentTarget().push(mcNode);
      stack.push({ target: mcNode.children });
      continue;
    }
    if (op === "EMC") {
      flushInTextCommands();
      if (stack.length > 1) stack.pop();
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
        currentTarget().push({
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
            currentTextCommands.push({ kind: "show-text-array", items });
          }
          break;
        }
        default:
          currentTextCommands.push({ kind: "state-op", operator: op, operands: args });
          break;
      }
      continue;
    }

    // Path construction & painting outside BT..ET
    if (op === "m") {
      const mx = numVal(args[0]);
      const my = numVal(args[1]);
      currentPathSegments.push({ kind: "move", x: mx, y: my });
      curPathX = mx;
      curPathY = my;
      subpathStartX = mx;
      subpathStartY = my;
      continue;
    }
    if (op === "l") {
      const lx = numVal(args[0]);
      const ly = numVal(args[1]);
      currentPathSegments.push({ kind: "line", x: lx, y: ly });
      curPathX = lx;
      curPathY = ly;
      continue;
    }
    if (op === "c") {
      const x = numVal(args[4]);
      const y = numVal(args[5]);
      currentPathSegments.push({
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
      currentPathSegments.push({
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
      currentPathSegments.push({
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
      currentPathSegments.push({ kind: "close" });
      curPathX = subpathStartX;
      curPathY = subpathStartY;
      continue;
    }
    if (op === "re") {
      const rx = numVal(args[0]);
      const ry = numVal(args[1]);
      currentPathSegments.push({
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
      currentTarget().push({
        kind: "path-op",
        segments: currentPathSegments,
        paint: op as "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n",
        clip: pendingClip,
      });
      currentPathSegments = [];
      pendingClip = undefined;
      continue;
    }
    if (op === "Do") {
      const name = args[0]?.kind === "name" ? args[0].decoded : "Im0";
      currentTarget().push({ kind: "xobject", name });
      continue;
    }

    currentTarget().push({ kind: "state-op", operator: op, operands: args });
  }

  if (inText && currentTextCommands.length > 0) {
    currentTarget().push({ kind: "text-object", commands: currentTextCommands });
  }

  return rootNodes;
}
