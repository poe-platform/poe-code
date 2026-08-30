import { readFileSync, readdirSync, lstatSync, openSync, writeSync, closeSync, fsyncSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const opened = [];
const reserve = name => {
  const descriptor = openSync(`${directory}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  opened.push(descriptor); return descriptor;
};
let status = 1, written = 0;
const started = Date.now();
try {
  const stdout = reserve('synthetic-02.stdout.jsonl'), stderr = reserve('synthetic-02.stderr.txt'), exit = reserve('synthetic-02.status.txt');
  const report = row => {
    const bytes = Buffer.from(JSON.stringify(row) + '\n'); written += bytes.length;
    if (written > 65536 || Date.now() - started > 120000) throw new Error('synthetic resource bound');
    writeSync(stdout, bytes);
  };
  try {
    const sealBytes = readFileSync(`${directory}/PRESEAL.json`), seal = JSON.parse(sealBytes);
    const repair = JSON.parse(readFileSync(`${directory}/REPAIR-PRESEAL.json`));
    if (digest(sealBytes) !== repair.originalPresealSha256) throw new Error('original preseal identity');
    const guard = () => {
      const allowed = [...seal.sources.map(row => row.path), 'PRESEAL.json', 'rendered.json', 'syntax-01.stdout.txt', 'syntax-01.stderr.txt', 'syntax-01.status.txt', ...repair.files.map(row => row.path), 'REPAIR-PRESEAL.json', 'syntax-repair-01.stdout.txt', 'syntax-repair-01.stderr.txt', 'syntax-repair-01.status.txt', 'synthetic-02.stdout.jsonl', 'synthetic-02.stderr.txt', 'synthetic-02.status.txt'];
      if (readdirSync(directory).some(name => !allowed.includes(name))) throw new Error('unexpected preparation entry');
      for (const row of [...seal.sources, ...seal.protectedInputs, seal.rendered, ...repair.files]) {
        const path = resolve(directory, row.path), stat = lstatSync(path), bytes = readFileSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== row.mode || bytes.length !== row.bytes || digest(bytes) !== row.sha256) throw new Error(`source/data guard: ${row.path}`);
        if (Object.hasOwn(repair.imports, row.path)) {
          const source = bytes.toString('utf8');
          const imports = [...source.matchAll(/^import\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"\n]+)['"];$/gm)].map(match => match[1]);
          if (JSON.stringify(imports) !== JSON.stringify(repair.imports[row.path])) throw new Error(`exact sealed import edges: ${row.path}`);
        }
      }
    };
    guard();
    const { run, CASES } = await import('./synthetic.mjs');
    if (CASES.length !== 26 || CASES.some((name, index) => !name.startsWith(seal.cohort.ids[index] + '-'))) throw new Error('unchanged sealed cohort');
    const records = JSON.parse(readFileSync(`${directory}/../preparation-v3/records.json`));
    const result = await run(records, JSON.parse(readFileSync(`${directory}/rendered.json`)), report);
    guard(); report({ summary: result, initialPreflightFailure: 'preflight-01.json', scenarioReruns: 0 }); status = result.failed ? 1 : 0;
  } catch (reason) {
    const bytes = Buffer.from(String(reason?.stack ?? reason));
    writeSync(stderr, bytes.subarray(0, Math.max(0, 65536 - written))); status = 1;
  }
  writeSync(exit, `${status}\n`);
} finally {
  for (const descriptor of opened) { fsyncSync(descriptor); closeSync(descriptor); }
  process.exitCode = status;
}
