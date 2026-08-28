import { readFileSync, readdirSync, lstatSync, openSync, writeSync, closeSync, fsyncSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(readFileSync(`${directory}/PRESEAL.json`));
const guard = () => {
  const allowed = [...seal.sources.map(row => row.path), 'PRESEAL.json', 'rendered.json', 'syntax-01.stdout.txt', 'syntax-01.stderr.txt', 'syntax-01.status.txt', ...seal.cohort.capture];
  if (readdirSync(directory).some(name => !allowed.includes(name))) throw new Error('unexpected preparation entry');
  for (const row of [...seal.sources, ...seal.protectedInputs, seal.rendered]) {
    const path = resolve(directory, row.path), stat = lstatSync(path), bytes = readFileSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== row.mode || bytes.length !== row.bytes || digest(bytes) !== row.sha256) throw new Error(`source/data guard: ${row.path}`);
    if (row.path.endsWith('.mjs') && !row.path.startsWith('../')) {
      const source = bytes.toString('utf8');
      const imports = [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
      const allowedBuiltins = row.path === 'run-synthetic.mjs' || row.path === 'seal.mjs' ? ['node:fs', 'node:crypto', 'node:url', 'node:path'] : ['node:crypto', 'node:vm', 'node:assert/strict', 'node:events', 'node:path'];
      for (const name of imports) if (!allowedBuiltins.includes(name) && !(name.startsWith('./') && seal.sources.some(file => file.path === name.slice(2)))) throw new Error('unapproved import before subject loading');
      if (source.includes('import(') && row.path !== 'run-synthetic.mjs') throw new Error('dynamic fallback before subject loading');
    }
  }
};
guard();
const opened = [];
const reserve = name => {
  const descriptor = openSync(`${directory}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  opened.push(descriptor); return descriptor;
};
let status = 1, written = 0;
const started = Date.now();
try {
  const stdout = reserve('synthetic-01.stdout.jsonl'), stderr = reserve('synthetic-01.stderr.txt'), exit = reserve('synthetic-01.status.txt');
  const report = row => {
    const bytes = Buffer.from(JSON.stringify(row) + '\n'); written += bytes.length;
    if (written > 65536 || Date.now() - started > 120000) throw new Error('synthetic resource bound');
    writeSync(stdout, bytes);
  };
  try {
    const { run, CASES } = await import('./synthetic.mjs');
    if (CASES.length !== seal.cohort.count || CASES.some((name, index) => !name.startsWith(seal.cohort.ids[index] + '-'))) throw new Error('sealed cohort mismatch');
    const records = JSON.parse(readFileSync(`${directory}/../preparation-v3/records.json`));
    const result = await run(records, JSON.parse(readFileSync(`${directory}/rendered.json`)), report);
    guard(); report({ summary: result }); status = result.failed ? 1 : 0;
  } catch (reason) {
    const bytes = Buffer.from(String(reason?.stack ?? reason));
    writeSync(stderr, bytes.subarray(0, 65536)); status = 1;
  }
  writeSync(exit, `${status}\n`);
} finally {
  for (const descriptor of opened) { fsyncSync(descriptor); closeSync(descriptor); }
  process.exitCode = status;
}
