import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const priorCommit = 'd8cbb7d76459e14d20f57e19f7c01ce04fa08702';
export const priorControllerSha256 = '0abda8e112db27b69e514eeb71d5e0ab4ed8d62406330a6c5051b4c4fe107f15';
export const replacements = [
  ["import { readCapture } from './capture-io.mjs';", "import { admitCapturedTree } from '../controller-admission.mjs';"],
  ['const repository = path.resolve(own, \'../../../..\');', 'const repository = path.resolve(own, \'../../../../..\');'],
  ['  checkHarness(); checkTools();\n  fs.mkdirSync(work);', "  checkHarness(); checkTools();\n  const admittedCandidateCapture = admitCapturedTree(path.resolve(own, '../../path-transport-v2/inventory-v1'), 'candidate', 'future-inventory');\n  fs.mkdirSync(work);"],
  ["  const candidateEntries = parseTree(readCapture(path.join(own, 'inventory-v1'), 'candidate'));", '  const candidateEntries = admittedCandidateCapture.entries;'],
  ['${start.commit}:tests/commands/apply-patch-independent-20260828/path-transport-v2/RUNTIME-SEAL.json', '${start.commit}:tests/commands/apply-patch-independent-20260828/capture-membership-v3/future-v3/RUNTIME-SEAL.json']
];
export function composeFuture(priorBytes) {
  assert.equal(crypto.createHash('sha256').update(priorBytes).digest('hex'), priorControllerSha256);
  let source = priorBytes.toString('utf8');
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length, 2, 'exact single prior callsite');
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
