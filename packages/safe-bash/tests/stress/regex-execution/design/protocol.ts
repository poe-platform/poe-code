export const caps = Object.freeze({ patterns: 16, patternBytes: 65536, rows: 128, subjectBytes: 262144, resultBytes: 65536, matches: 4096, calls: 1024, inputBytes: 8388608, outputBytes: 4194304, batchMs: 75, workMs: 3000, startupMs: 1000 });
export interface Descriptor { source: string; flags: "g" | "gi" | "gu" | "gui" }
export interface Row { text: string; all: boolean }
export interface Hit { pattern: number; start: number; end: number; captures: (string | null)[] }
export interface Result { hits: Hit[][]; bytes: number; execCalls: number }
export const size = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function descriptors(value: unknown): asserts value is Descriptor[] {
  if (!Array.isArray(value) || value.length > caps.patterns || value.some(item => !item || typeof item.source !== "string" || !["g", "gi", "gu", "gui"].includes(item.flags) || Object.keys(item).sort().join() !== "flags,source") || size(value) > caps.patternBytes) throw new Error("PATTERN_CAP_OR_PROTOCOL");
}
export function rows(value: unknown): asserts value is Row[] {
  if (!Array.isArray(value) || value.length > caps.rows || value.some(item => !item || typeof item.text !== "string" || typeof item.all !== "boolean" || Object.keys(item).sort().join() !== "all,text") || value.reduce((sum, item) => sum + item.text.length * 2, 0) > caps.subjectBytes) throw new Error("INPUT_CAP_OR_PROTOCOL");
}
export function result(value: unknown, input: readonly Row[], patternCount: number): asserts value is Result {
  const candidate = value as Result;
  if (!candidate || Object.keys(candidate).sort().join() !== "bytes,execCalls,hits" || !Array.isArray(candidate.hits) || candidate.hits.length !== input.length || !Number.isSafeInteger(candidate.execCalls) || candidate.execCalls < 0 || !Number.isSafeInteger(candidate.bytes) || candidate.bytes !== size(candidate.hits) || candidate.bytes > caps.resultBytes) throw new Error("RESULT_PROTOCOL");
  let count = 0;
  for (const [index, hits] of candidate.hits.entries()) {
    if (!Array.isArray(hits)) throw new Error("RESULT_PROTOCOL");
    for (const hit of hits) {
      if (++count > caps.matches || !hit || Object.keys(hit).sort().join() !== "captures,end,pattern,start" || !Number.isSafeInteger(hit.pattern) || hit.pattern < 0 || hit.pattern >= patternCount || !Number.isSafeInteger(hit.start) || !Number.isSafeInteger(hit.end) || hit.start < 0 || hit.end < hit.start || hit.end > input[index]!.text.length || !Array.isArray(hit.captures) || hit.captures.some(capture => capture !== null && typeof capture !== "string")) throw new Error("RESULT_PROTOCOL");
    }
  }
}
