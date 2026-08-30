import { caps, size, type Descriptor, type Hit, type Result, type Row } from "./protocol.js";

export function compile(patterns: readonly Descriptor[]): RegExp[] {
  return patterns.map(pattern => new RegExp(pattern.source, pattern.flags));
}

export function scan(patterns: readonly RegExp[], input: readonly Row[]): Result {
  const hits: Hit[][] = [];
  let charged = 2;
  let count = 0;
  let execCalls = 0;
  for (const row of input) {
    const found: Hit[] = [];
    hits.push(found);
    charged += 3;
    for (const [pattern, regex] of patterns.entries()) {
      regex.lastIndex = 0;
      while (true) {
        execCalls++;
        const match = regex.exec(row.text);
        if (!match) break;
        const captureUnits = match.reduce((sum, capture) => sum + (capture?.length ?? 0), 0);
        if (captureUnits * 2 > caps.resultBytes || match.length > caps.matches) throw new Error("RESULT_CAP");
        const hit: Hit = { pattern, start: match.index, end: match.index + match[0].length, captures: Array.from(match, capture => capture ?? null) };
        charged += size(hit) + 1;
        if (++count > caps.matches || charged > caps.resultBytes) throw new Error("RESULT_CAP");
        found.push(hit);
        if (!row.all) break;
        if (match[0].length === 0) {
          if (regex.lastIndex === row.text.length) break;
          regex.lastIndex += regex.unicode && row.text.codePointAt(regex.lastIndex)! > 0xffff ? 2 : 1;
        }
      }
      if (!row.all && found.length) break;
    }
  }
  const bytes = size(hits);
  if (bytes > caps.resultBytes) throw new Error("RESULT_CAP");
  return { hits, bytes, execCalls };
}
