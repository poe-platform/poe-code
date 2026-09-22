import { SyntaxReader } from "./syntax.js";
import type { PdfObject } from "./syntax.js";
import { interpretPdfTextOwned } from "./text.js";
import type { PdfTextOptions, PdfTextResult } from "./text.js";
import type { PdfBox } from "./pages.js";

export interface PdfLayoutOptions extends PdfTextOptions {
  mode?: "logical" | "layout" | "content";
  box?: PdfBox;
  rotate?: number;
  /** Fixed display-coordinate row bands; no author reading-order inference. */
  lineTolerance?: number;
  maxRuns?: number;
}
export interface PdfTextRun {
  text: string;
  glyphStart: number;
  glyphEnd: number;
  origin: [number, number] | undefined;
  end: [number, number] | undefined;
  direction: [number, number] | undefined;
}
export interface PdfLayoutResult extends PdfTextResult {
  mode: "logical" | "layout" | "content";
  ordering: "semantic-content-order" | "display-row-bands" | "content-stream-order";
  runs: PdfTextRun[];
  size: [number, number];
  rotate: number;
  geometryComplete: boolean;
}

/** Explicit bytes/resources only. Page APIs use their cumulative document owner. */
export function extractPdfLayout(bytes: Uint8Array, resources: PdfObject | undefined, options: PdfLayoutOptions = {}): PdfLayoutResult {
  const owner = new SyntaxReader(bytes, options, undefined, true);
  validateLayout(owner, options);
  return layoutPdfTextOwned(interpretPdfTextOwned(owner, resources, options), owner, options);
}
export function validateLayout(owner: SyntaxReader, options: PdfLayoutOptions): void {
  owner.charge();
  if (!["logical", "layout", "content"].includes(options.mode ?? "logical")) owner.fail("ARGUMENT", "invalid extraction mode");
  const rotate = options.rotate ?? 0;
  if (!Number.isSafeInteger(rotate) || rotate % 90 !== 0) owner.fail("ARGUMENT", "invalid page rotation");
  const box = options.box ?? [0, 0, 612, 792];
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= box[0]! || box[3]! <= box[1]!) owner.fail("ARGUMENT", "invalid layout box");
  if (!Number.isFinite(box[2]! - box[0]!) || !Number.isFinite(box[3]! - box[1]!)) owner.fail("ARGUMENT", "layout box overflow");
  const tolerance = options.lineTolerance ?? 2;
  if (!Number.isFinite(tolerance) || tolerance <= 0) owner.fail("ARGUMENT", "invalid line tolerance");
  if (!Number.isSafeInteger(options.maxRuns ?? owner.limits.objects) || (options.maxRuns ?? owner.limits.objects) < 0) owner.fail("ARGUMENT", "invalid run limit");
}
/** Internal composition: result and owner originate in the same invocation. */
export function layoutPdfTextOwned(result: PdfTextResult, owner: SyntaxReader, options: PdfLayoutOptions): PdfLayoutResult {
  validateLayout(owner, options);
  const mode = options.mode ?? "logical", box = options.box ?? [0, 0, 612, 792];
  const rotate = ((options.rotate ?? 0) % 360 + 360) % 360;
  const width = box[2] - box[0], height = box[3] - box[1];
  const transform = (point: [number, number]): [number, number] => {
    owner.charge();
    const x = point[0] - box[0], y = point[1] - box[1];
    const p: [number, number] = rotate === 90 ? [y, x] : rotate === 180 ? [width - x, y] : rotate === 270 ? [height - y, width - x] : [x, height - y];
    if (!p.every(Number.isFinite)) owner.fail("SYNTAX", "display coordinate overflow");
    return p;
  };
  const runs: PdfTextRun[] = [];
  let geometryComplete = true;
  for (let i = 0; i < result.glyphs.length;) {
    owner.charge();
    if (runs.length >= (options.maxRuns ?? owner.limits.objects)) owner.fail("LIMIT", "layout run limit");
    owner.reserve(256);
    const first = result.glyphs[i]!, start = i;
    const parts: string[] = [];
    do {
      owner.charge();
      const glyph = result.glyphs[i]!;
      const text = glyph.unicode ?? "";
      owner.charge(text.length); owner.reserve(32 + text.length * 6);
      parts.push(text);
      if (!glyph.origin || !glyph.advance) geometryComplete = false;
      i++;
    } while (i < result.glyphs.length && result.glyphs[i]!.source.string === first.source.string && result.glyphs[i]!.source.start === first.source.start);
    const last = result.glyphs[i - 1]!;
    const origin = first.origin && transform(first.origin);
    const end = last.origin && last.advance && transform([last.origin[0] + last.advance[0], last.origin[1] + last.advance[1]]);
    let direction: [number, number] | undefined;
    if (first.origin && first.advance && origin) {
      const p = transform([first.origin[0] + first.advance[0], first.origin[1] + first.advance[1]]);
      const dx = p[0] - origin[0], dy = p[1] - origin[1], magnitude = Math.hypot(dx, dy);
      if (!Number.isFinite(magnitude)) owner.fail("SYNTAX", "display direction overflow");
      if (magnitude) direction = [dx / magnitude, dy / magnitude];
    }
    runs.push({ text: parts.join(""), glyphStart: start, glyphEnd: i, origin, end, direction });
  }
  if (mode === "layout") {
    const tolerance = options.lineTolerance ?? 2;
    for (const run of runs) {
      owner.charge();
      if (run.origin && !Number.isSafeInteger(Math.floor(run.origin[1] / tolerance))) owner.fail("ARGUMENT", "row band outside safe range");
    }
    runs.sort((a, b) => {
      owner.charge();
      if (!a.origin || !b.origin) return a.origin ? -1 : b.origin ? 1 : a.glyphStart - b.glyphStart;
      return Math.floor(a.origin[1] / tolerance) - Math.floor(b.origin[1] / tolerance) || a.origin[0] - b.origin[0] || a.glyphStart - b.glyphStart;
    });
  }
  let text = result.text;
  if (mode !== "logical") {
    const parts: string[] = [];
    for (let i = 0; i < runs.length; i++) {
      owner.charge();
      const run = runs[i]!, previous = runs[i - 1];
      let separator = "";
      if (mode === "layout" && previous) {
        if (!run.origin || !previous.origin) separator = "\n";
        else if (Math.floor(run.origin[1] / (options.lineTolerance ?? 2)) !== Math.floor(previous.origin[1] / (options.lineTolerance ?? 2))) separator = "\n";
        else if (previous.end && run.origin[0] - previous.end[0] > (options.lineTolerance ?? 2) && !previous.text.endsWith(" ") && !run.text.startsWith(" ")) separator = " ";
      }
      owner.charge(run.text.length); owner.reserve(32 + (separator.length + run.text.length) * 6);
      parts.push(separator, run.text);
    }
    text = parts.join("");
    if (result.normalization !== "preserve") {
      owner.charge(text.length); owner.reserve(text.length * 36);
      text = text.normalize(result.normalization);
    }
  }
  owner.reserve(256);
  return { ...result, text, runs, mode, ordering: mode === "layout" ? "display-row-bands" : mode === "logical" ? "semantic-content-order" : "content-stream-order", size: rotate === 90 || rotate === 270 ? [height, width] : [width, height], rotate, geometryComplete };
}
