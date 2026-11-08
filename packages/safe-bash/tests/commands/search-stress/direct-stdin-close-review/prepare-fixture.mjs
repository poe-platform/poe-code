import { createHash } from 'node:crypto';

export function prepareFixture(frozen) {
  const expected = '629054ab31c89d6c85d7e9aad7ec19808d5990aeef147aabfa61f96d650aa8c0';
  const sha256 = text => createHash('sha256').update(text).digest('hex');
  if (sha256(frozen) !== expected) throw new Error('original holdout bytes changed');
  const replacements = [
    ['if (options.pending) { entered.resolve();',
      'if (options.pending && !(options.endAfterPending && state.next > chunks.length + 1)) { entered.resolve();'],
    ['const survivor = source([], { pending: true });',
      'const survivor = source([], { pending: true, endAfterPending: true });'],
  ];
  let prepared = frozen;
  for (const [before, after] of replacements) {
    if (prepared.split(before).length !== 2) throw new Error('fixture correction requires one exact occurrence');
    prepared = prepared.replace(before, after);
  }
  const assertions = text => text.split('\n').filter(line => /\b(?:check|counts|output)\(/.test(line)).join('\n');
  if (assertions(frozen) !== assertions(prepared)) throw new Error('expectations changed during fixture preparation');
  return { prepared, evidence: { originalSha256: expected, preparedSha256: sha256(prepared),
    assertionsSha256: sha256(assertions(frozen)), assertionsUnchanged: true, replacements } };
}
