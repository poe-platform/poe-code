import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { traceNative, probe } from './native-trace.mjs';
import { replaceOnce } from './prototype.mjs';
const nativeRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7';
if (process.argv.length !== 3 || !/^[a-z][a-z0-9-]*$/.test(process.argv[2])) throw new Error('usage: node native-followup.mjs UNIQUE-OUTPUT-NAME');
const output = await open(new URL(`./${process.argv[2]}.json`, import.meta.url), 'wx');
const temporary = await mkdtemp(join(tmpdir(), 'expr-nullable-design-native-'));
const cases = JSON.parse(await readFile(new URL('./capture-third/cases.json', import.meta.url))).filter(row => ['empty', 'a', 'aa', 'aaa', 'mandatory-empty'].includes(row.id));
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' };
const records = [];
async function run(binary, argv) {
  const result = await new Promise(resolve => {
    const child = spawn(binary, argv, { cwd: temporary, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error = null, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 2000);
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 65536) child.kill('SIGKILL'); });
    child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 65536) child.kill('SIGKILL'); });
    child.on('error', failure => { error = failure.message; });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, error, timedOut, stdout, stderr }); });
  });
  records.push({ binary, argv, ...result });
  assert.equal(result.timedOut, false); assert.equal(result.status, 0, result.stderr);
  return result;
}
try {
  const source = await readFile(join(nativeRoot, 'lib/regexec.c'), 'utf8');
  await writeFile(join(temporary, 'probe.c'), probe, { flag: 'wx' });
  await writeFile(join(temporary, 'regexec-trace.c'), traceNative(source), { flag: 'wx' });
  await writeFile(join(temporary, 'regex-trace.c'), replaceOnce(await readFile(join(nativeRoot, 'lib/regex.c'), 'utf8'), '#include "regexec.c"', '#include "regexec-trace.c"'), { flag: 'wx' });
  await run('/usr/bin/clang', ['-I', nativeRoot, '-I', join(nativeRoot, 'lib'), '-include', 'config.h', '-include', 'stdio.h', join(temporary, 'probe.c'), join(temporary, 'regex-trace.c'), join(nativeRoot, 'lib/libcoreutils.a'), '-o', join(temporary, 'trace')]);
  for (const specimen of cases) {
    const result = await run(join(temporary, 'trace'), [specimen.argv[1], specimen.argv[3]]);
    const original = JSON.parse(await readFile(new URL('./capture-third/native.json', import.meta.url))).find(row => row.id === specimen.id);
    assert.equal(result.stdout, original.registers.stdout);
  }
  records.push({ inputRegexecSha256: createHash('sha256').update(source).digest('hex'), environment, cohort: cases.map(row => row.id), note: 'Focused diagnostic rebuild, not pinned oracle; register outputs equal prior independently linked native probe. Edge destination /1 means retained in sifted state, /0 removed.' });
} finally {
  await rm(temporary, { recursive: true, force: true });
  records.push({ removed: temporary, activeChildren: 0 });
  await output.writeFile(JSON.stringify(records, null, 2) + '\n');
  await output.close();
}
