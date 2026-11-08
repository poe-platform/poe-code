import { createHash } from 'node:crypto';
import { prepareFixture as prepareFirstRevision } from './prepare-fixture.mjs';

export function prepareFixture(frozen) {
  const prior = prepareFirstRevision(frozen);
  const before = `      const originalNext = survivor.source.next;
      survivor.source.next = function () {
        survivor.state.next++;
        survivor.state.eof = true;
        survivor.state.closed = true;
        return Promise.resolve({ done: true, value: undefined });
      };
`;
  const restore = '      survivor.source.next = originalNext;\n';
  if (prior.prepared.split(before).length !== 2 || prior.prepared.split(restore).length !== 2) {
    throw new Error('expected exact obsolete next-method swap');
  }
  const prepared = prior.prepared.replace(before, '').replace(restore, '');
  const assertions = text => text.split('\n').filter(line => /\b(?:check|counts|output)\(/.test(line)).join('\n');
  if (assertions(frozen) !== assertions(prepared)) throw new Error('expectations changed during v2 fixture preparation');
  const sha256 = text => createHash('sha256').update(text).digest('hex');
  return { prepared, evidence: { ...prior.evidence, version: 2,
    priorPreparedSha256: prior.evidence.preparedSha256, preparedSha256: sha256(prepared),
    replacements: [...prior.evidence.replacements, [before, ''], [restore, '']],
    schedule: 'Stable next method: first call waits for explicit hit-newline release, second call returns EOF; no post-acquisition method mutation.' } };
}
