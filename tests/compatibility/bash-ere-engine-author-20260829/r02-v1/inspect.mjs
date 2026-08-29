import { open, lstat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../../..');
const outer = await open(join(own, 'PREP.outer.jsonl'), 'wx');
await outer.write(JSON.stringify({ start: new Date().toISOString(), pid: process.pid, productExecution: false }) + '\n');
try {
  const paths = [
    'tests/compatibility/bash-ere-engine-independent-20260829/HANDOFF.md',
    'tests/compatibility/bash-ere-engine-independent-20260829/authority-v1/ROUTING.md',
    'src/commands/regex-execution/ere/matcher.ts',
    'src/commands/regex-execution/ere/syntax.ts',
    'src/commands/regex-execution/ere/limits.ts',
  ];
  const records = [];
  for (const path of paths) {
    const absolute = join(root, path); const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('text admission refused');
    const bytes = await readFile(absolute);
    records.push({ path, size: bytes.length, mode: stat.mode & 0o777, sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`--- ${path} ---\n${bytes.toString('utf8')}`);
  }
  await writeFile(join(own, 'INSPECTION.json'), JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
  await outer.write(JSON.stringify({ complete: new Date().toISOString(), files: records.length }) + '\n');
} catch (error) { await outer.write(JSON.stringify({ failure: String(error?.stack ?? error) }) + '\n'); process.exitCode = 1; }
finally { await outer.close(); }
