import {
  cosNumber,
  cosString,
  type PdfContentNode,
  type PdfCosDict,
  type PdfRgbColor,
  type PdfTextCommand,
} from "../ast.js";
import { evaluateContentStreamToDisplayList } from "../content/evaluator.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { encodeWinAnsiBytes } from "../fonts/standard14.js";

export interface RedactOptions {
  readonly fillColor?: PdfRgbColor | undefined;
  readonly replacementText?: string | undefined;
  readonly fontName?: string | undefined;
}

function boxesIntersect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  const ax0 = Math.min(a[0], a[2]);
  const ay0 = Math.min(a[1], a[3]);
  const ax1 = Math.max(a[0], a[2]);
  const ay1 = Math.max(a[1], a[3]);
  const bx0 = Math.min(b[0], b[2]);
  const by0 = Math.min(b[1], b[3]);
  const bx1 = Math.max(b[0], b[2]);
  const by1 = Math.max(b[1], b[3]);
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

export function redactPageContentAst(params: {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly PdfContentNode[];
  readonly regions: readonly (readonly [number, number, number, number])[];
  readonly cosDoc?: ParsedCosDocument | undefined;
  readonly resourcesDict?: PdfCosDict | undefined;
  readonly options?: RedactOptions | undefined;
}): PdfContentNode[] {
  const { regions } = params;
  if (regions.length === 0) return [...params.nodes];

  const filterNodes = (nodes: readonly PdfContentNode[]): PdfContentNode[] => {
    const out: PdfContentNode[] = [];
    for (const node of nodes) {
      if (node.kind === "graphics-group") {
        out.push({ kind: "graphics-group", ops: filterNodes(node.ops) });
        continue;
      }
      if (node.kind === "marked-content") {
        out.push({
          ...node,
          children: filterNodes(node.children),
        });
        continue;
      }
      if (node.kind === "text-object") {
        const singleDl = evaluateContentStreamToDisplayList({
          pageIndex: params.pageIndex,
          width: params.width,
          height: params.height,
          nodes: [node],
          cosDoc: params.cosDoc,
          resourcesDict: params.resourcesDict,
        });
        const anyHit = singleDl.glyphs.some(g => regions.some(r => boxesIntersect(g.bbox, r)));
        if (!anyHit) {
          out.push(node);
          continue;
        }
        const survivingGlyphs = singleDl.glyphs.filter(
          g => !regions.some(r => boxesIntersect(g.bbox, r))
        );
        if (survivingGlyphs.length > 0) {
          const rebuiltCommands: PdfTextCommand[] = [];
          for (const g of survivingGlyphs) {
            rebuiltCommands.push({ kind: "font", fontName: "F1", size: g.fontSize });
            rebuiltCommands.push({
              kind: "matrix",
              matrix: [1, 0, 0, 1, g.bbox[0], g.baselineY],
            });
            rebuiltCommands.push({
              kind: "show-text",
              token: cosString(encodeWinAnsiBytes(g.unicode)),
            });
          }
          out.push({ kind: "text-object", commands: rebuiltCommands });
        }
        continue;
      }
      if (node.kind === "path-op") {
        const singleDl = evaluateContentStreamToDisplayList({
          pageIndex: params.pageIndex,
          width: params.width,
          height: params.height,
          nodes: [node],
          cosDoc: params.cosDoc,
          resourcesDict: params.resourcesDict,
        });
        const pathHit = singleDl.paths.some(p => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const seg of p.segments) {
            if (seg.kind === "move" || seg.kind === "line" || seg.kind === "cubic") {
              minX = Math.min(minX, seg.x);
              minY = Math.min(minY, seg.y);
              maxX = Math.max(maxX, seg.x);
              maxY = Math.max(maxY, seg.y);
            } else if (seg.kind === "rect") {
              minX = Math.min(minX, seg.x);
              minY = Math.min(minY, seg.y);
              maxX = Math.max(maxX, seg.x + seg.width);
              maxY = Math.max(maxY, seg.y + seg.height);
            }
          }
          if (!Number.isFinite(minX)) return false;
          return regions.some(r => boxesIntersect([minX, minY, maxX, maxY], r));
        });
        if (!pathHit) out.push(node);
        continue;
      }
      out.push(node);
    }
    return out;
  };

  const cleaned = filterNodes(params.nodes);
  const fill = params.options?.fillColor ?? { r: 0, g: 0, b: 0 };
  const overlayOps: PdfContentNode[] = [
    {
      kind: "state-op",
      operator: "rg",
      operands: [cosNumber(fill.r), cosNumber(fill.g), cosNumber(fill.b)],
    },
  ];
  for (const r of regions) {
    const x = Math.min(r[0], r[2]);
    const y = Math.min(r[1], r[3]);
    const w = Math.abs(r[2] - r[0]);
    const h = Math.abs(r[3] - r[1]);
    overlayOps.push({
      kind: "path-op",
      segments: [{ kind: "rect", x, y, width: w, height: h }],
      paint: "f",
    });
    if (params.options?.replacementText) {
      overlayOps.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(1), cosNumber(1), cosNumber(1)],
      });
      overlayOps.push({
        kind: "text-object",
        commands: [
          { kind: "font", fontName: params.options.fontName ?? "F1", size: Math.min(10, Math.max(6, h * 0.6)) },
          { kind: "matrix", matrix: [1, 0, 0, 1, x + 2, y + h * 0.25] },
          { kind: "show-text", token: cosString(encodeWinAnsiBytes(params.options.replacementText)) },
        ],
      });
      overlayOps.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(fill.r), cosNumber(fill.g), cosNumber(fill.b)],
      });
    }
  }
  cleaned.push({ kind: "graphics-group", ops: overlayOps });
  return cleaned;
}
