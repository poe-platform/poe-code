import assert from 'node:assert/strict';

export function applyDeltas(original, deltas) {
  const row = structuredClone(original);
  for (const delta of deltas) {
    const keys = delta.path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = keys.pop();
    let target = row;
    for (const parent of keys) target = target[parent];
    if (delta.op === 'remove') { assert.ok(Object.hasOwn(target, key)); delete target[key]; }
    else { assert.equal(delta.op, 'set'); target[key] = structuredClone(delta.value); }
  }
  return row;
}
export function noPullInput(counters) {
  return { [Symbol.asyncIterator]() {
    counters.acquired++;
    return {
      async next() { counters.pulls++; throw new Error('V5_FORBIDDEN_STDIN_PULL'); },
      async return() { counters.returns++; return { done: true, value: undefined }; }
    };
  } };
}
export function observeAccess(args, selectedSignal) {
  return { method: 'access', path: args[0], mode: args[1], signalMatches: args[2]?.signal === selectedSignal };
}
export function accessDenied(specification, args) {
  return specification.path === args[0] && specification.mode === args[1];
}
export function exactDiagnostic(row, bytes) {
  const choices = row.expected.stderr.exactUtf8Alternatives ?? [row.expected.stderr.utf8];
  assert.ok(choices.every(value => typeof value === 'string'));
  return choices.some(value => Buffer.from(value).equals(bytes));
}
