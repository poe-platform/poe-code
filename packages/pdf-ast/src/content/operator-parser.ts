/* Command recovery adapted from Mozilla PDF.js EvaluatorPreprocessor.
 * Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import type { PdfCosNode, PdfCosDict, PdfDictEntry } from "../ast.js";
import { CosByteLexer, type CosToken, isPdfDelimiter, isPdfWhitespace } from "../cos/lexer.js";
import { PdfError } from "../errors.js";
import { PDF_KNOWN_COMMANDS, PDF_OPERATOR_ARITIES, PDF_PATH_OPERATORS, PDF_VARIABLE_OPERATORS } from "./operators.js";

export interface PdfContentOperator {
  operator: string;
  operands: PdfCosNode[];
  inlineImage?: { dict: PdfCosDict; start: number; end: number };
}

type Work<T> = Generator<OperatorRequest, T, CosToken | PdfCosNode | number | undefined>;
export type OperatorRequest =
  | { kind: "token" }
  | { kind: "byte"; position: number }
  | { kind: "push"; node: PdfCosNode }
  | { kind: "pop" }
  | { kind: "operator"; value: PdfContentOperator };
export interface ContentOperandLimits { maxNodes: number; maxDepth: number }
function* token(): Work<CosToken | undefined> { return (yield { kind: "token" }) as CosToken | undefined; }
function* byte(position: number): Work<number | undefined> { return (yield { kind: "byte", position }) as number | undefined; }
function* parseOperandToken(tok: CosToken, limits: ContentOperandLimits, depth = 0, state = { nodes: 0 }): Work<PdfCosNode> {
  if (++state.nodes > limits.maxNodes || depth > limits.maxDepth) throw new PdfError("E_LIMIT", "PDF content operand limit exceeded");
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
        const next = (yield* token());
        if (!next || next.kind === "array-end") {
          return { kind: "array", items };
        }
        items.push((yield* parseOperandToken(next, limits, depth + 1, state)));
      }
    }
    case "dict-start": {
      const entries: PdfDictEntry[] = [];
      while (true) {
        const kTok = (yield* token());
        if (!kTok || kTok.kind === "dict-end") break;
        if (kTok.kind !== "name") continue;
        if (++state.nodes > limits.maxNodes) throw new PdfError("E_LIMIT", "PDF content operand limit exceeded");
        const vTok = (yield* token());
        if (!vTok || vTok.kind === "dict-end") break;
        entries.push({
          key: { kind: "name", decoded: kTok.decoded, rawBytes: kTok.rawBytes },
          value: (yield* parseOperandToken(vTok, limits, depth + 1, state)),
        });
      }
      return { kind: "dict", entries };
    }
    default:
      return { kind: "null" };
  }
}

function computeInlineImageMinBytes(entries: readonly PdfDictEntry[]): number {
  const getEntry = (shortKey: string, longKey: string): PdfCosNode | undefined =>
    entries.find(e => e.key.decoded === shortKey || e.key.decoded === longKey)?.value;

  const filterNode = getEntry("F", "Filter");
  if (filterNode) {
    if (filterNode.kind === "array" && filterNode.items.length === 0) {
      // Empty filter array means uncompressed (pypdf #4026)
    } else {
      return 0;
    }
  }
  const wNode = getEntry("W", "Width");
  const hNode = getEntry("H", "Height");
  const bpcNode = getEntry("BPC", "BitsPerComponent");
  const csNode = getEntry("CS", "ColorSpace");

  const w = wNode?.kind === "number" ? wNode.value : 0;
  const h = hNode?.kind === "number" ? hNode.value : 0;
  if (w <= 0 || h <= 0) return 0;

  const maskNode = getEntry("IM", "ImageMask");
  const isMask = maskNode?.kind === "boolean" && maskNode.value;
  const bpc = isMask ? 1 : bpcNode?.kind === "number" ? bpcNode.value : 8;
  const csName = csNode?.kind === "name" ? csNode.decoded : "DeviceRGB";
  const channels =
    isMask || csName === "G" || csName === "DeviceGray" || csName === "I" || csName === "Indexed"
      ? 1
      : csName === "CMYK" || csName === "DeviceCMYK"
        ? 4
        : 3;
  return h * Math.ceil((w * channels * bpc) / 8);
}

function* looksLikePostEiContentStream(size: number, posAfterEi: number): Work<boolean> {
  let p = posAfterEi;
  while (p < size && isPdfWhitespace((yield* byte(p))!)) p++;
  if (p >= size) return true;
  const limit = Math.min(size, p + 16);
  for (let i = p; i < limit; i++) {
    const b = (yield* byte(i))!;
    if (b === 0x28 || b === 0x3c || b === 0x25) break;
    if (!isPdfWhitespace(b) && (b < 0x20 || b > 0x7e)) {
      return false;
    }
  }
  return true;
}

/** Shared grammar driven by synchronous bytes or retained asynchronous ranges. */
export function* contentOperatorSteps(lexer: { offset: number }, size: number, limits: ContentOperandLimits): Work<void> {
  const operands: PdfCosNode[] = [];
  let previousWasPath = false;
  let invalidPathCount = 0;
  while (true) {
    const tok = (yield* token());
    if (!tok) break;

    if (tok.kind !== "keyword") {
      const operand = (yield* parseOperandToken(tok, limits));
      if (operand.kind !== "null") operands.push(operand);
      if (operands.length > 33) throw new PdfError("E_PARSE", "Too many arguments");
      continue;
    }

    const op = tok.value;
    const variable = PDF_VARIABLE_OPERATORS.has(op);
    const count = Object.hasOwn(PDF_OPERATOR_ARITIES, op) ? PDF_OPERATOR_ARITIES[op]! : undefined;
    if (count === undefined && !variable) continue;
    const args = operands.splice(0, operands.length);
    if (!previousWasPath) invalidPathCount = 0;
    previousWasPath = PDF_PATH_OPERATORS.has(op);
    if (!variable && count !== undefined) {
      while (args.length > count) yield { kind: "push", node: args.shift()! };
      while (args.length < count) {
        const recovered = (yield { kind: "pop" }) as PdfCosNode | undefined;
        if (!recovered) break;
        args.unshift(recovered);
      }
      if (args.length < count) {
        if (previousWasPath && ++invalidPathCount > 10) {
          throw new PdfError("E_PARSE", `Invalid command ${op}: expected ${count} args, but received ${args.length} args.`);
        }
        continue;
      }
    }

    if (op === "BI") {
      const entries: PdfDictEntry[] = [];
      const imageState = { nodes: 1 };
      while (true) {
        const kTok = (yield* token());
        if (!kTok || (kTok.kind === "keyword" && kTok.value === "ID")) break;
        if (kTok.kind === "name") {
          if (++imageState.nodes > limits.maxNodes) throw new PdfError("E_LIMIT", "PDF inline image dictionary limit exceeded");
          const vTok = (yield* token());
          if (!vTok || (vTok.kind === "keyword" && vTok.value === "ID")) break;
          entries.push({
            key: { kind: "name", decoded: kTok.decoded, rawBytes: kTok.rawBytes },
            value: (yield* parseOperandToken(vTok, limits, 1, imageState)),
          });
        }
      }
      if (lexer.offset < size && (yield* byte(lexer.offset)) === 0x0d && lexer.offset + 1 < size && (yield* byte(lexer.offset + 1)) === 0x0a) {
        lexer.offset += 2;
      } else if (lexer.offset < size && isPdfWhitespace((yield* byte(lexer.offset))!)) {
        lexer.offset++;
      }
      const dataStart = lexer.offset;
      const minBytes = computeInlineImageMinBytes(entries);
      let dataEnd = size;
      for (let i = dataStart + minBytes; i + 2 < size; i++) {
        if (
          isPdfWhitespace((yield* byte(i))!) &&
          (yield* byte(i + 1)) === 0x45 && // E
          (yield* byte(i + 2)) === 0x49 && // I
          (i + 3 >= size || isPdfWhitespace((yield* byte(i + 3))!) || isPdfDelimiter((yield* byte(i + 3))!)) &&
          (yield* looksLikePostEiContentStream(size, i + 3))
        ) {
          dataEnd = i;
          lexer.offset = i + 3;
          break;
        }
      }
      if (dataEnd === size) lexer.offset = size;
      yield { kind: "operator", value: { operator: op, operands: args, inlineImage: { dict: { kind: "dict", entries }, start: dataStart, end: dataEnd } } };
      continue;
    }

    yield { kind: "operator", value: { operator: op, operands: args } };
  }
}

/** Pull one normalized operator at a time; image payloads remain input ranges. */
export function* parseContentOperators(bytes: Uint8Array): Generator<PdfContentOperator> {
  const lexer = new CosByteLexer(bytes, 0, bytes.length, Infinity, PDF_KNOWN_COMMANDS);
  const stack: PdfCosNode[] = [];
  const work = contentOperatorSteps(lexer, bytes.length, { maxNodes: Infinity, maxDepth: Infinity });
  try {
    let step = work.next();
    while (!step.done) {
      const request = step.value;
      let result: CosToken | PdfCosNode | number | undefined;
      switch (request.kind) {
        case "token": result = lexer.nextToken(); break;
        case "byte": result = bytes[request.position]; break;
        case "push": stack.push(request.node); break;
        case "pop": result = stack.pop(); break;
        case "operator": yield request.value; break;
      }
      step = work.next(result);
    }
  } finally { work.return(); }
}
