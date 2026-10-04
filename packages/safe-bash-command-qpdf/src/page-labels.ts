import type { RetainedPageLabel } from "@poe-code/pdf-ast";

export function* parseQpdfPageLabels(specs: readonly string[]): Generator<RetainedPageLabel> {
  for (const spec of specs) {
    const colon = spec.indexOf(":"); if (colon <= 0) continue;
    const index = Math.max(1, Number.parseInt(spec.slice(0, colon), 10) || 1) - 1;
    const parts = spec.slice(colon + 1).split("/"), style = parts[0] ?? "D";
    const parsed = parts[1] !== undefined && parts[1].length > 0 ? Number.parseInt(parts[1], 10) : Number.NaN;
    const start = Number.isFinite(parsed) ? parsed || 1 : 1;
    const prefix = parts.length >= 3 ? parts[2] ?? "" : !Number.isFinite(parsed) ? parts[1] ?? "" : "";
    yield { index, start, prefix, ...(style === "n" ? {} : { style }) };
  }
}
