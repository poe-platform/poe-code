import {
  decodePdfString,
  dictGet,
  type PdfContentNode,
  type PdfCosArray,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosNumber,
  type PdfCosString,
  type PdfDictEntry,
  type PdfPathSegment,
  type PdfTextCommand,
} from "../ast.js";
import { CosByteLexer, type CosToken, isPdfWhitespace } from "../cos/lexer.js";

const PATH_PAINT_OPS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);

function parseOperandToken(tok: CosToken, lexer: CosByteLexer): PdfCosNode {
  switch (tok.kind) {
    case "null":
      return { kind: "null", span: tok.span };
    case "boolean":
      return { kind: "boolean", value: tok.value, span: tok.span };
    case "number":
      return {
        kind: "number",
        value: tok.value,
        isInteger: tok.isInteger,
        raw: tok.raw,
        span: tok.span,
      };
    case "name":
      return { kind: "name", decoded: tok.decoded, rawBytes: tok.rawBytes, span: tok.span };
    case "string":
      return { kind: "string", encoding: "literal", bytes: tok.bytes, span: tok.span };
    case "hex-string":
      return { kind: "string", encoding: "hex", bytes: tok.bytes, span: tok.span };
    case "array-start": {
      const items: PdfCosNode[] = [];
      while (true) {
        const next = lexer.nextToken();
        if (!next || next.kind === "array-end") {
          return { kind: "array", items };
        }
        items.push(parseOperandToken(next, lexer));
      }
    }
    case "dict-start": {
      const entries: PdfDictEntry[] = [];
      while (true) {
        const kTok = lexer.nextToken();
        if (!kTok || kTok.kind === "dict-end") break;
        if (kTok.kind !== "name") continue;
        const vTok = lexer.nextToken();
        if (!vTok || vTok.kind === "dict-end") break;
        entries.push({
          key: { kind: "name", decoded: kTok.decoded, rawBytes: kTok.rawBytes },
          value: parseOperandToken(vTok, lexer),
        });
      }
      return { kind: "dict", entries };
    }
    default:
      return { kind: "null" };
  }
}

function numVal(node: PdfCosNode | undefined, fallback = 0): number {
  return node?.kind === "number" ? node.value : fallback;
}

export function parseContentStream(bytes: Uint8Array): PdfContentNode[] {
  const lexer = new CosByteLexer(bytes);
  const rootNodes: PdfContentNode[] = [];
  const stack: Array<{ target: PdfContentNode[] }> = [{ target: rootNodes }];
  const operands: PdfCosNode[] = [];

  let inText = false;
  let currentTextCommands: PdfTextCommand[] = [];
  let currentPathSegments: PdfPathSegment[] = [];
  let pendingClip: "W" | "W*" | undefined;
  let curPathX = 0;
  let curPathY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  const currentTarget = (): PdfContentNode[] => stack[stack.length - 1]!.target;

  while (true) {
    const tok = lexer.nextToken();
    if (!tok) break;

    if (tok.kind !== "keyword") {
      operands.push(parseOperandToken(tok, lexer));
      continue;
    }

    const op = tok.value;
    const args = operands.splice(0, operands.length);

    if (op === "BI") {
      const entries: PdfDictEntry[] = [];
      while (true) {
        const kTok = lexer.nextToken();
        if (!kTok || (kTok.kind === "keyword" && kTok.value === "ID")) break;
        if (kTok.kind === "name") {
          const vTok = lexer.nextToken();
          if (!vTok || (vTok.kind === "keyword" && vTok.value === "ID")) break;
          entries.push({
            key: { kind: "name", decoded: kTok.decoded, rawBytes: kTok.rawBytes },
            value: parseOperandToken(vTok, lexer),
          });
        }
      }
      if (lexer.pos < bytes.length && isPdfWhitespace(bytes[lexer.pos]!)) {
        lexer.pos++;
      }
      const dataStart = lexer.pos;
      let dataEnd = bytes.length;
      for (let i = dataStart; i + 2 < bytes.length; i++) {
        if (
          isPdfWhitespace(bytes[i]!) &&
          bytes[i + 1] === 0x45 && // E
          bytes[i + 2] === 0x49 && // I
          (i + 3 >= bytes.length || isPdfWhitespace(bytes[i + 3]!))
        ) {
          dataEnd = i;
          lexer.pos = i + 3;
          break;
        }
      }
      currentTarget().push({
        kind: "inline-image",
        dict: { kind: "dict", entries },
        data: bytes.subarray(dataStart, dataEnd),
      });
      continue;
    }

    if (op === "q") {
      const group: PdfContentNode = { kind: "graphics-group", ops: [] };
      currentTarget().push(group);
      stack.push({ target: group.ops });
      continue;
    }
    if (op === "Q") {
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (op === "BMC" || op === "BDC") {
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
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (op === "BT") {
      inText = true;
      currentTextCommands = [];
      continue;
    }
    if (op === "ET") {
      if (inText) {
        currentTarget().push({ kind: "text-object", commands: currentTextCommands });
        inText = false;
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
          currentTarget().push({ kind: "state-op", operator: op, operands: args });
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
