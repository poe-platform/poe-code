import type { PdfContentNode, PdfCosNode, PdfPathSegment, PdfTextCommand } from "../ast.js";
import { serializeCosNodeBytes } from "../cos/writer.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(4)).toString();
}

function fmtNode(node: PdfCosNode): string {
  return decoder.decode(serializeCosNodeBytes(node));
}

function serializeTextCommand(cmd: PdfTextCommand): string {
  switch (cmd.kind) {
    case "font":
      return `/${cmd.fontName} ${fmtNum(cmd.size)} Tf`;
    case "matrix":
      return `${cmd.matrix.map(fmtNum).join(" ")} Tm`;
    case "move":
      return `${fmtNum(cmd.tx)} ${fmtNum(cmd.ty)} ${cmd.setLeading ? "TD" : "Td"}`;
    case "next-line":
      return "T*";
    case "leading":
      return `${fmtNum(cmd.leading)} TL`;
    case "char-spacing":
      return `${fmtNum(cmd.charSpace)} Tc`;
    case "word-spacing":
      return `${fmtNum(cmd.wordSpace)} Tw`;
    case "horiz-scaling":
      return `${fmtNum(cmd.scalePercent)} Tz`;
    case "render-mode":
      return `${fmtNum(cmd.mode)} Tr`;
    case "rise":
      return `${fmtNum(cmd.rise)} Ts`;
    case "show-text":
      return `${fmtNode(cmd.token)} Tj`;
    case "show-text-array":
      return `[${cmd.items.map(fmtNode).join(" ")}] TJ`;
  }
}

function serializePathSegment(seg: PdfPathSegment): string {
  switch (seg.kind) {
    case "move":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} m`;
    case "line":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} l`;
    case "cubic":
      return `${fmtNum(seg.x1)} ${fmtNum(seg.y1)} ${fmtNum(seg.x2)} ${fmtNum(seg.y2)} ${fmtNum(seg.x)} ${fmtNum(seg.y)} c`;
    case "rect":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} ${fmtNum(seg.width)} ${fmtNum(seg.height)} re`;
    case "close":
      return "h";
  }
}

export function serializeContentNodesToLines(nodes: readonly PdfContentNode[]): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "graphics-group":
        lines.push("q");
        lines.push(...serializeContentNodesToLines(node.ops));
        lines.push("Q");
        break;
      case "marked-content":
        if (node.properties !== undefined) {
          const propStr =
            typeof node.properties === "string"
              ? `/${node.properties}`
              : fmtNode(node.properties);
          lines.push(`/${node.tag} ${propStr} BDC`);
        } else {
          lines.push(`/${node.tag} BMC`);
        }
        lines.push(...serializeContentNodesToLines(node.children));
        lines.push("EMC");
        break;
      case "text-object":
        lines.push("BT");
        for (const cmd of node.commands) {
          lines.push(serializeTextCommand(cmd));
        }
        lines.push("ET");
        break;
      case "path-op":
        for (const seg of node.segments) {
          lines.push(serializePathSegment(seg));
        }
        if (node.clip) {
          lines.push(node.clip);
        }
        lines.push(node.paint);
        break;
      case "xobject":
        lines.push(`/${node.name} Do`);
        break;
      case "inline-image": {
        const entryParts: string[] = [];
        for (const entry of node.dict.entries) {
          entryParts.push(`/${entry.key.decoded} ${fmtNode(entry.value)}`);
        }
        lines.push(`BI ${entryParts.join(" ")} ID`);
        lines.push(decoder.decode(node.data));
        lines.push("EI");
        break;
      }
      case "state-op": {
        if (node.operands.length === 0) {
          lines.push(node.operator);
        } else {
          lines.push(`${node.operands.map(fmtNode).join(" ")} ${node.operator}`);
        }
        break;
      }
    }
  }
  return lines;
}

export function serializeContentAst(nodes: readonly PdfContentNode[]): Uint8Array {
  return encoder.encode(serializeContentNodesToLines(nodes).join("\n"));
}
