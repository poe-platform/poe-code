import assert from 'node:assert/strict';

export function replaceOne(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  return source.replace(before, after);
}
export function instrument(original) {
  let source = original;
  source = replaceOne(source, 'function parseNumeric(bytes: Uint8Array): NumericValue {', 'function parseNumeric(bytes: Uint8Array): NumericValue { keyAuditCount("parses");');
  source = replaceOne(source, 'function compareNumericValues(first: NumericValue, second: NumericValue): number {', 'function compareNumericValues(first: NumericValue, second: NumericValue): number { keyAuditCount("numericComparisons");');
  source = replaceOne(source, 'function keyBytes(line: Uint8Array, key: SortKey, separator: number | undefined, blanks: boolean): Uint8Array {', 'function keyBytes(line: Uint8Array, key: SortKey, separator: number | undefined, blanks: boolean): Uint8Array { keyAuditCount("extractions");');
  assert.equal(source.split('fields.push(').length - 1, 2);
  source = source.replaceAll('fields.push(', 'keyAuditCount("fieldObjects"); fields.push(');
  source = replaceOne(source, 'records.sort(compare);', 'records.sort((left, right) => { keyAuditCount("sortComparisons"); return compare(left, right); });');
  source = replaceOne(source, 'const numericValues = new Map<Uint8Array, NumericValue>();', 'keyAuditCount("unkeyedConstructions"); const numericValues = new Map<Uint8Array, NumericValue>();');
  source = replaceOne(source, 'numericValues.set(bytes, parsedValue);', 'numericValues.set(bytes, parsedValue); keyAuditCount("unkeyedAdmissions");');
  if (source.includes('const keyedNumericValues = new Map<Uint8Array, NumericValue>();')) {
    source = replaceOne(source, 'const keyedNumericValues = new Map<Uint8Array, NumericValue>();', 'keyAuditCount("keyedConstructions"); const keyedNumericValues = new Map<Uint8Array, NumericValue>();');
    source = replaceOne(source, 'const cached = keyedNumericValues.get(record);\n          if (cached !== undefined) return cached;', 'keyAuditCount("keyedRequests"); const cached = keyedNumericValues.get(record);\n          if (cached !== undefined) { keyAuditCount("keyedHits"); return cached; }');
    source = replaceOne(source, 'if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) return parseNumeric(bytes);', 'if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) { keyAuditCount("fallback"); if (keyedNumericValues.size >= 16_384) keyAuditCount("entryFallback"); if (charge > 1_048_576 - retainedKeyBytes) keyAuditCount("byteFallback"); return parseNumeric(bytes); }');
    source = replaceOne(source, 'keyedNumericValues.set(record, parsedValue);\n          retainedKeyBytes += charge;', 'keyedNumericValues.set(record, parsedValue);\n          retainedKeyBytes += charge; keyAuditCount("keyedAdmissions"); keyAuditCount("charged", charge); keyAuditCount("independentBackingCharge", 6 * bytes.length + 2); keyAuditCount("existingRecordBytes", record.length); keyAuditPeak("entriesPeak", keyedNumericValues.size); keyAuditPeak("retainedPeak", retainedKeyBytes); if (Object.keys(parsedValue).sort().join(",") !== "fraction,negative,whole" || typeof parsedValue.whole !== "string" || typeof parsedValue.fraction !== "string" || typeof parsedValue.negative !== "boolean") keyAuditCount("unexpectedDescriptor");');
  }
  const prefix = `const keyAuditGlobal = globalThis as typeof globalThis & { __sortAudit?: Record<string, number>; __sortAuditReset?: () => void };
keyAuditGlobal.__sortAuditReset = () => { keyAuditGlobal.__sortAudit = {}; };
keyAuditGlobal.__sortAuditReset();
function keyAuditCount(name: string, amount = 1): void { const counters = keyAuditGlobal.__sortAudit!; counters[name] = (counters[name] ?? 0) + amount; }
function keyAuditPeak(name: string, value: number): void { const counters = keyAuditGlobal.__sortAudit!; counters[name] = Math.max(counters[name] ?? 0, value); }
`;
  return prefix + source;
}
