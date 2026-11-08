import assert from 'node:assert/strict';

export function instrument(original, candidate) {
  let source = original;
  const edits = [];
  const replace = (name, before, after) => {
    assert.equal(source.split(before).length - 1, 1, name);
    source = source.replace(before, after);
    edits.push({ name, before, after });
  };
  const count = (name, amount = '1') => `(globalThis as any).__unkeyedReview?.count("${name}", ${amount});`;
  const peak = (name, value) => `(globalThis as any).__unkeyedReview?.peak("${name}", ${value});`;
  const parser = candidate ? 'function parseNumeric(bytes: Uint8Array): NumericValue {' : 'const parse = (bytes: Uint8Array) => {';
  replace('parse-call', parser, parser + count('parses') + count('parseInputBytes', 'bytes.length'));
  const returned = 'return { whole, fraction, negative: match[1] === "-" && (whole !== "0" || fraction !== "") };';
  replace('normalized-characters', returned, count('normalizedCharacters', 'whole.length + fraction.length') + returned);
  const compare = candidate ? 'function compareNumericValues(first: NumericValue, second: NumericValue): number {' : 'function numericCompare(left: Uint8Array, right: Uint8Array): number {';
  replace('numeric-comparisons', compare, compare + count('numericComparisons'));
  replace('fraction-padding', 'const width = Math.max(first.fraction.length, second.fraction.length);', count('fractionPadEndCalls', '2') + 'const width = Math.max(first.fraction.length, second.fraction.length);');
  replace('key-extractions', 'const fields: { start: number; end: number }[] = [];', count('keyExtractions') + count('keyInputBytes', 'line.length') + 'const fields: { start: number; end: number }[] = [];');
  replace('sort-comparisons', 'records.sort(compare);', 'records.sort((left, right) => { ' + count('sortComparisons') + ' return compare(left, right); });');
  replace('collector-records', 'await collectSortRecords(input(context, name), delimiter, bytes => {', 'await collectSortRecords(input(context, name), delimiter, bytes => {' + count('records') + count('recordPayloadBytes', 'bytes.length'));
  if (candidate) {
    replace('cache-construction', 'const numericValues = new Map<Uint8Array, NumericValue>();', count('cacheCreated') + 'const numericValues = new Map<Uint8Array, NumericValue>();');
    replace('cache-lookup', 'const cached = numericValues.get(bytes);', count('cacheLookups') + 'const cached = numericValues.get(bytes);');
    replace('cache-hit', 'if (cached !== undefined) return cached;', 'if (cached !== undefined) { ' + count('cacheHits') + ' return cached; }');
    replace('fallback', 'if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) return parseNumeric(bytes);', 'if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) { ' + count('fallbacks') + ' if (numericValues.size >= 16_384) { ' + count('entryFallbacks') + ' } if (charge > 1_048_576 - retainedBytes) { ' + count('characterFallbacks') + ' } return parseNumeric(bytes); }');
    replace('admission', 'retainedBytes += charge;', 'retainedBytes += charge; ' + count('admissions') + count('admittedNormalizedCharacters', 'parsedValue.whole.length + parsedValue.fraction.length') + peak('peakEntries', 'numericValues.size') + peak('peakRetainedCharge', 'retainedBytes'));
  }
  return { source, edits };
}

export function mutate(source, name) {
  let before;
  let after;
  if (name === 'float-precision') {
    before = 'if (first.negative !== second.negative) return first.negative ? -1 : 1;';
    after = 'return Number((first.negative ? "-" : "") + first.whole + "." + first.fraction) - Number((second.negative ? "-" : "") + second.whole + "." + second.fraction);';
  } else if (name === 'whole-byte-fallback') {
    before = '|| (parsed.flags.has("s") || parsed.flags.has("u") ? 0 : compareBytes(left, right) * (parsed.flags.has("r") ? -1 : 1))';
    after = '|| 0';
  } else if (name === 'stable-fallback') {
    before = 'parsed.flags.has("s") || parsed.flags.has("u") ? 0 : compareBytes(left, right)';
    after = 'false ? 0 : compareBytes(left, right)';
  } else if (name === 'guard-bypass') {
    before = 'if (!keys.length && parsed.flags.has("n") && !["b", "f", "c"].some(flag => parsed.flags.has(flag)))';
    after = 'if (true)';
  } else if (name === 'entry-cap') {
    before = 'numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes';
    after = 'charge > 1_048_576 - retainedBytes';
  } else if (name === 'character-cap') {
    before = 'numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes';
    after = 'numericValues.size >= 16_384';
  } else if (name === 'fallback-rejection') {
    before = 'return parseNumeric(bytes); }';
    after = 'throw new Error("mutant rejected uncached fallback"); }';
  } else if (name === 'owned-copy') {
    before = 'else accept(new Uint8Array(part));';
    after = 'else accept(part);';
  } else throw new Error(name);
  assert.equal(source.split(before).length - 1, 1, name);
  return { source: source.replace(before, after), edits: [{ name, before, after }] };
}
