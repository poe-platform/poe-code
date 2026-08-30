import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const names = [
  'tests/integration/agent-bash-coherent-design-20260829/WORKFLOWS.md',
  'tests/integration/agent-bash-coherent-design-20260829/VALIDATION-PROPOSAL.md',
  'tests/integration/agent-bash-coherent-design-20260829/compose.mjs',
  'tests/integration/agent-bash-coherent-independent-20260829/PROBES.json',
  'tests/integration/node-public-author-20260829/public-node.mjs',
  'tests/compatibility/bash-strict-extension-author-20260829/n14-v4/n14.mjs'
];
for (const name of names) {
  const filename = path.join(root, name), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
  const bytes = fs.readFileSync(filename);
  console.log('\nFILE', name, stat.size, createHash('sha256').update(bytes).digest('hex'));
  console.log(bytes.toString());
}
for (const name of ['tests/integration/agent-bash-coherent-design-20260829/COMPOSITION.json', 'tests/compatibility/bash-strict-extension-author-20260829/n14-v4/SOURCE.json']) {
  const filename = path.join(root, name), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 524288);
  const data = JSON.parse(fs.readFileSync(filename));
  console.log('\nSTRUCT', name, JSON.stringify({ keys: Object.keys(data), first: data.inputs[0], details: Object.fromEntries(Object.entries(data).filter(([key]) => !['inputs', 'treeWitnesses', 'reconstructedTrees', 'trees', 'overlaps'].includes(key))) }, null, 2));
}
