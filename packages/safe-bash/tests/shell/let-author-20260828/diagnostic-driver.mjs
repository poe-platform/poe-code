import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const evidence = join(own, 'evidence-diagnosis-v1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sealBytes = readFileSync(join(evidence, 'SEAL.json')); assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
for (const [filename, expected] of Object.entries(seal.files)) assert.equal(hash(readFileSync(join(own, filename))), expected, filename);
assert.equal(hash(readFileSync(process.execPath)), seal.nodeSHA256);
const results = [];
for (const layout of ['accepted464', 'candidate-moved']) {
  const bindingPath = join(evidence, `${layout}.binding.json`); const binding = JSON.parse(readFileSync(bindingPath));
  const receipt = await new Promise(resolveRun => {
    const stdout = []; const stderr = []; let failure; let count = 0; let escalation;
    const child = spawn(process.execPath, ['--unhandled-rejections=strict', '--import', join(own, 'load-hook.mjs'), join(own, 'diagnose.mjs')], { cwd: own, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: join(own, 'work/home'), TMPDIR: join(own, 'work/tmp'), LET_BINDING: bindingPath, LET_BINDING_SHA256: hash(readFileSync(bindingPath)), LET_LOAD_RECEIPT: join(evidence, `${layout}.loads.jsonl`), LET_DIAG_LAYOUT: layout } });
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const stop = reason => { if (failure) return; failure = reason; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 250); };
    const collect = target => chunk => { count += chunk.length; if (count <= 1024 * 1024) target.push(chunk); else stop('OUTPUT_LIMIT'); };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr)); child.on('error', error => { failure = String(error); });
    const timeout = setTimeout(() => stop('TIMEOUT'), 30000);
    child.on('close', (code, signal) => {
      clearTimeout(timeout); clearTimeout(escalation); let groupAbsent = false;
      try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') groupAbsent = true; else throw error; }
      const output = Buffer.concat(stdout); const diagnostic = Buffer.concat(stderr);
      writeFileSync(join(evidence, `${layout}.stdout.data`), output, { flag: 'wx' }); writeFileSync(join(evidence, `${layout}.stderr.data`), diagnostic, { flag: 'wx' });
      resolveRun({ layout, pid: child.pid, code, signal, groupAbsent, failure: failure ?? null, stdoutSHA256: hash(output), stderrSHA256: hash(diagnostic), stdoutBytes: output.length, stderrBytes: diagnostic.length });
    });
  });
  results.push(receipt); writeFileSync(join(evidence, `${layout}.receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  assert.equal(receipt.signal, null); assert.equal(receipt.failure, null); assert.equal(receipt.groupAbsent, true);
  for (const [filename, expected] of Object.entries(binding.files)) assert.equal(hash(readFileSync(join(binding.root, filename))), expected, filename);
}
for (const [filename, expected] of Object.entries(seal.files)) assert.equal(hash(readFileSync(join(own, filename))), expected, filename);
writeFileSync(join(evidence, 'REPORT.json'), JSON.stringify({ results, postGuards: 'passed', originalCasesRescored: 0, nativeExecutions: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(results));
if (results.some(row => row.code !== 0)) process.exitCode = 1;
