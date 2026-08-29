import { openSync, closeSync, fstatSync, readSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = '/Users/kjopek/Workspace/safe-bash';
const scope = resolve(root, 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-r3');
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 13) throw new Error('bounded inspection arguments required');
const [label, ...inputs] = args;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid label');
let total = 0;
const receipts = [];
for (const input of inputs) {
  const selection = /^(.*)#([0-9]+):([0-9]+)$/.exec(input);
  const file = resolve(root, selection ? selection[1] : input);
  if ((!file.startsWith(`${root}/tests/`) && !file.startsWith('/private/tmp/safe-bash-coherent-b1-public15-20260829-r2/') && !file.startsWith('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source/')) || file.endsWith('/AGENTS.md')) throw new Error('outside inspection scope');
  if (!/\.(mjs|ts|json|stdout|stderr|md|sh)$/.test(file)) throw new Error('unrecognized text type');
  const descriptor = openSync(file, 'r');
  let bytes;
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 262144 || total + stat.size > 1048576) throw new Error('inspection size refused');
    bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('short read');
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('changed inspection input');
  } finally { closeSync(descriptor); }
  total += bytes.length;
  const receipt = { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  receipts.push(receipt);
  writeFileSync(resolve(scope, `${label}-${receipts.length}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(receipt));
  const lines = bytes.toString('utf8').split('\n');
  const start = selection ? Number(selection[2]) : 1;
  const end = selection ? Number(selection[3]) : lines.length;
  console.log(lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n'));
}
writeFileSync(resolve(scope, `${label}-inspection.json`), `${JSON.stringify({ utc: new Date().toISOString(), pid: process.pid, receipts, total }, null, 2)}\n`, { flag: 'wx' });
