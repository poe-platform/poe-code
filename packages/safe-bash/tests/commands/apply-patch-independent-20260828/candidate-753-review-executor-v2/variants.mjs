import assert from 'node:assert/strict';
import { sha } from './common.mjs';

export function replaceOnce(body, needle, replacement) {
  assert.equal(body.split(needle).length - 1, 1, `unique frozen mutation site ${needle}`);
  return body.replace(needle, replacement);
}
export function variants(files) {
  const output = [];
  const original = name => files.get(`dist/commands/apply-patch/${name}`).toString('utf8');
  const witness = marker => `(globalThis.reviewMarkers.includes(${JSON.stringify(marker)}) || globalThis.reviewMarkers.push(${JSON.stringify(marker)}))`;
  const definitions = [
    ['M01', 'apply.js', 'const text = context.args[0];', marker => `const text = (${marker}, context.args[0]);`, marker => `const text = (${marker}, context.stdin[Symbol.asyncIterator](), context.args[0]);`, 'P02'],
    ['M03', 'matcher.js', 'work.equal(lines[candidate + offset].text, pattern[offset])', marker => `(${marker}, work.equal(lines[candidate + offset].text, pattern[offset]))`, marker => `(${marker}, work.equal(lines[candidate + offset].text.trim(), pattern[offset].trim()))`, 'P18'],
    ['M04', 'matcher.js', 'const first = eof ? last : start;', marker => `const first = (${marker}, eof ? last : start);`, marker => `const first = (${marker}, start);`, 'P16'],
    ['M09', 'apply.js', 'flag: "wx"', marker => `flag: (${marker}, "wx")`, marker => `flag: (${marker}, "w")`, 'S40'],
    ['M12', 'apply.js', 'chunks.push(await work.copy(chunk));', marker => `chunks.push((${marker}, await work.copy(chunk)));`, marker => `chunks.push((${marker}, chunk));`, 'S49'],
    ['M18', 'apply.js', 'work.count("maxInputChunks", 1);', marker => `(${marker}, work.count("maxInputChunks", 1));`, marker => `(${marker}, chunk.byteLength && work.count("maxInputChunks", 1));`, 'L10'],
  ];
  for (const [id, name, needle, positive, mutant, caseId] of definitions) for (const phase of ['before', 'mutant', 'restored']) {
    const marker = `AP753:${id}:${phase}`;
    const body = replaceOnce(original(name), needle, (phase === 'mutant' ? mutant : positive)(witness(marker)));
    output.push({ id: `${id}-${phase}`, phase, family: id, marker, caseId, changes: { [`dist/commands/apply-patch/${name}`]: body },
      migration: id === 'M12' ? 'v2 applicability-only: old new Uint8Array(chunk) site became await work.copy(chunk); unchanged S49 borrowing challenge, retained-view mutant and phase semantics' : 'original mutation operation and fixture unchanged' });
  }
  const instrument = (marker, mutation, family) => {
    let shared = original('shared.js'); let matcher = original('matcher.js');
    shared = replaceOnce(shared, 'target.set(bytes.subarray(offset, offset + count), start + offset);', 'globalThis.s54Hooks.record({ kind: "copy", count, units: this.units, nextYield: this.nextYield });\n            target.set(bytes.subarray(offset, offset + count), start + offset);');
    shared = replaceOnce(shared, 'const encoded = encoder.encodeInto(chunk, target.subarray(offset, offset + bytes));', 'globalThis.s54Hooks.record({ kind: "encode", units: chunk.length, danglingHigh: chunk.charCodeAt(chunk.length - 1) >= 0xd800 && chunk.charCodeAt(chunk.length - 1) <= 0xdbff });\n            const encoded = encoder.encodeInto(chunk, target.subarray(offset, offset + bytes));');
    matcher = replaceOnce(matcher, 'work.admit(units * 2 + bytes);', 'globalThis.s54Hooks.record({ kind: "stage-admit", bytes, units });\n    work.admit(units * 2 + bytes);');
    matcher = replaceOnce(matcher, 'const result = new Uint8Array(bytes);', 'globalThis.s54Hooks.record({ kind: "stage-allocation", bytes });\n    const result = new Uint8Array(bytes);');
    if (mutation === 'bulk-copy') shared = replaceOnce(shared, 'const count = Math.min(bytes.length - offset, this.nextYield - this.units);', 'const count = bytes.length - offset;');
    if (mutation === 'skip-interval') shared = replaceOnce(shared, 'this.nextYield += 4096;', 'this.nextYield = this.units + 4096;');
    if (mutation === 'bulk-encode') shared = replaceOnce(shared, 'let end = Math.min(text.length, index + 1024);', 'let end = text.length;');
    if (mutation === 'stage-admit') matcher = replaceOnce(matcher, 'work.admit(units * 2 + bytes);', 'void 0;');
    if (family === 'bulk-copy') shared = replaceOnce(shared, 'let offset = 0;\n        while (offset < bytes.length)', `${witness(marker)};\n        let offset = 0;\n        while (offset < bytes.length)`);
    if (family === 'skip-interval') shared = replaceOnce(shared, 'if (this.units >= this.nextYield) {', `if (this.units >= this.nextYield) {\n            ${witness(marker)};`);
    if (family === 'bulk-encode') shared = replaceOnce(shared, 'const encoder = new TextEncoder();', `${witness(marker)};\n        const encoder = new TextEncoder();`);
    if (family === 'stage-admit') matcher = replaceOnce(matcher, 'globalThis.s54Hooks.record({ kind: "stage-admit", bytes, units });', `${witness(marker)};\n    globalThis.s54Hooks.record({ kind: "stage-admit", bytes, units });`);
    return { 'dist/commands/apply-patch/shared.js': shared, 'dist/commands/apply-patch/matcher.js': matcher };
  };
  const families = [['bulk-copy', 'I01'], ['skip-interval', 'I02'], ['bulk-encode', 'I03'], ['stage-admit', 'I04']];
  for (const [family, killedBy] of families) for (const phase of ['before', 'mutant', 'restored']) {
    const id = `S54-${family}-${phase}`; const marker = `AP753:${id}`;
    output.push({ id, phase, family, instrumented: true, mutant: phase === 'mutant' ? family : null, killedBy, marker, changes: instrument(marker, phase === 'mutant' ? family : null, family) });
  }
  return output.map(entry => ({ ...entry, bindings: Object.fromEntries(Object.entries(entry.changes).map(([name, body]) => [name, { bytes: Buffer.byteLength(body), mode: 0o644, sha256: sha(body) }])) }));
}
