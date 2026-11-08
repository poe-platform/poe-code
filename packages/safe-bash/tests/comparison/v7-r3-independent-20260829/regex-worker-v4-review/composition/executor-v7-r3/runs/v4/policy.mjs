import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { own, requireValue } from './common.mjs';

export const candidate = '67eab12e315054907ef4ef435c6bbca2f59e0c36';
export const packSha256 = '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06';
export const eligible = Object.freeze(['case-10','case-12','case-19','case-21','case-70','case-72','case-82','case-84']);
export const closure = Object.freeze({
  'dist/commands/regex-execution/worker.js': ['46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f',1981],
  'dist/commands/regex-execution/protocol.js': ['a38e930b62581a22b23d05087b4f67937accbe157d5f6bb6c9b33e7c35f5c9b6',7869],
  'dist/commands/regex-execution/matching.js': ['2f97a68fce0ab504676afe31b4c4fd5eea1edde87ffb28bea9f55c8422693791',13278],
  'dist/commands/expr/bre-worker.js': ['e744453f4430b6a929cadac4e4b6a8a4e58ac75440ef16006ff4f4dab31f4874',19153],
});
const productImports = {
  'dist/commands/regex-execution/worker.js': ['node:worker_threads','./matching.js','../expr/bre-worker.js','./protocol.js'],
  'dist/commands/regex-execution/protocol.js': [],
  'dist/commands/regex-execution/matching.js': ['node:buffer'],
  'dist/commands/expr/bre-worker.js': ['node:worker_threads','../regex-execution/protocol.js'],
};
export function profileBinding(profile, entry, members, operation, maximumStarts) {
  if (profile.kind === 'HARMLESS') {
    const value = own(profile, ['kind','root','control']);
    requireValue(value.control === operation && /^G(?:0[1-9]|1[0-2])\.[1-7]$/.test(operation), 'STUB_OPERATION');
    const expected = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'runs', 'controls-01', operation);
    requireValue(value.root === expected || value.root === path.join(expected, 'moved'), 'STUB_ROOT');
    requireValue(entry === pathToFileURL(path.join(value.root, 'worker.mjs')).href && members.every(row => fileURLToPath(row.url).startsWith(value.root + path.sep)), 'STUB_ENTRY');
    return;
  }
  const value = own(profile, ['kind','candidate','packSha256','packageRoot','operationId','priorAuthorityRequired']);
  requireValue(value.kind === 'TARGET' && value.candidate === candidate && value.packSha256 === packSha256 && value.operationId === operation && value.priorAuthorityRequired === true, 'TARGET_BINDING');
  requireValue(maximumStarts === (eligible.includes(operation) ? 8 : 0), 'OPERATION_ALLOWANCE');
  requireValue(entry === pathToFileURL(path.join(value.packageRoot, 'dist/commands/regex-execution/worker.js')).href, 'TARGET_ENTRY');
  requireValue(members.length === 4, 'TARGET_CLOSURE_COUNT');
  for (const [relative, [sha256, size]] of Object.entries(closure)) {
    const member = members.find(row => row.url === pathToFileURL(path.join(value.packageRoot, relative)).href);
    requireValue(member && member.sha256 === sha256 && member.bytes === size && member.mode === 0o644, 'TARGET_CLOSURE');
    requireValue(member.role === 'product' && JSON.stringify(member.imports) === JSON.stringify(productImports[relative]), 'TARGET_IMPORT_GRAPH');
  }
}
