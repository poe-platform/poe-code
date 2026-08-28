import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2];
if (mode === 'natural') process.stdout.write('NATURAL\n');
else if (mode === 'hold') {
  process.stdout.write('READY\n');
  const held = setInterval(() => {}, 1000);
  setTimeout(() => { clearInterval(held); process.exitCode = 3; }, 4000);
} else if (mode === 'receipt') {
  const raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const output = process.argv[4];
  const rawBytes = Buffer.from(JSON.stringify(raw)+'\n');
  fs.writeFileSync(output+'.raw',rawBytes,{flag:'wx',mode:0o600});
  raw.rawSha256 = sha(rawBytes); delete raw.engineOutcome.stats;
  const bytes = Buffer.from(JSON.stringify(raw)+'\n');
  fs.writeFileSync(output,bytes,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(path.dirname(output),'stub-load.json'),JSON.stringify({kind:'INERT_COMPOSED_LOAD_PORT_FIXTURE',stubSha256:sha(fs.readFileSync(process.argv[1]))})+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({label:raw.label,classification:raw.classification,receiptSha256:sha(bytes)})+'\n');
} else throw new Error('UNKNOWN_STUB_MODE');
