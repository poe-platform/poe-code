import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const root = JSON.parse(fs.readFileSync(path.join(own, 'PREP.json'))).root;
const log = { role: 'VERSIONED_AUTHOR_FIXTURE_CORRECTION', started: new Date().toISOString(), files: [] };
const save = () => fs.writeFileSync(path.join(root, 'version3.json'), JSON.stringify(log, null, 2)); save();
try {
  let patch = '*** Begin Patch\n';
  for (const name of ['prepare.mjs', 'run.mjs', 'launch.mjs']) {
    const before = fs.readFileSync(path.join(own, name), 'utf8');
    let after = before.replaceAll('PRESEAL-v2.json', 'PRESEAL-v3.json').replaceAll('EXECUTOR-v2.json', 'EXECUTOR-v3.json').replaceAll('SOURCE-v2.json', 'SOURCE-v3.json').replaceAll('SOURCE-COMMIT-v2.txt', 'SOURCE-COMMIT-v3.txt').replace('version2-seal','version3-seal');
    if (name === 'prepare.mjs') {
      after = after.replace('totalSeconds: 3000, children: 105, captureBytes: 262144000, scratchBytes: 943718400', 'totalSeconds: 2700, children: 90, captureBytes: 251658240, scratchBytes: 838860800');
      after = after.replace('"VERSIONS.md"]', '"VERSIONS.md", "version3.mjs", "redirections-v3.mjs"]');
    }
    if (name === 'run.mjs') {
      after = after.replace('from "virtual-bash/shell"', 'from "virtual-bash"');
      after = after.replace('tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs', 'tests/compatibility/bash-conditional-author-20260829/redirections-v3.mjs');
      after = after.replaceAll('-redirections-v2', '-redirections-v3');
    }
    if (name === 'launch.mjs') after = after.replace('Math.min(3000000', 'Math.min(2700000');
    assert.notEqual(before, after);
    patch += `*** Update File: ${path.join(own, name)}\n@@\n${before.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${after.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n`;
    log.files.push({ name, before: createHash('sha256').update(before).digest('hex'), after: createHash('sha256').update(after).digest('hex') });
  }
  const originalPath = 'tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs';
  const original = fs.readFileSync(path.join(repo, originalPath), 'utf8');
  const expected = JSON.parse(fs.readFileSync(path.join(own, 'EXECUTOR-v2.json'))).files.find(row => row.path === originalPath);
  assert.equal(createHash('sha256').update(original).digest('hex'), expected.sha256);
  const clause = '    assert.notEqual(result.exitCode, 0, script);\n    assert.notEqual(result.stderr, "", script);'; assert.equal(original.split(clause).length, 2);
  const corrected = original.replace('C02-unsupported-stays-unsupported', 'C02-versioned-conditional-support').replace(clause, '    if (script === "[[ x ]]") { assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); }\n    else { assert.notEqual(result.exitCode, 0, script); assert.notEqual(result.stderr, "", script); }');
  patch += `*** Add File: ${path.join(own, 'redirections-v3.mjs')}\n${corrected.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  save(); const result = spawnSync('apply_patch', [patch], { cwd: repo, timeout: 10000, maxBuffer: 1024 * 1024 });
  fs.writeFileSync(path.join(root, 'version3.stdout'), result.stdout ?? ''); fs.writeFileSync(path.join(root, 'version3.stderr'), result.stderr ?? ''); log.status = result.status; log.signal = result.signal; save(); assert.equal(result.status, 0); assert.equal(result.signal, null); console.log(result.stdout.toString());
} catch (error) { log.error = String(error?.stack ?? error); save(); throw error; }
