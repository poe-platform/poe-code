import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v5-f05-local-esm/cli-launcher.mjs';

const root = '/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v5-f05-local-esm';
try {
  assert.equal(fileURLToPath(import.meta.url), root + '/cli-entry.mjs');
  assert.equal(fs.realpathSync(process.execPath), '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node');
  assert.equal(process.version, 'v22.22.2');
  assert.equal(process.versions.node, '22.22.2');
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.ok(Number.isSafeInteger(process.pid) && process.pid > 0);
  assert.equal(process.cwd(), root);
  assert.equal(process.argv.length, 6);
  assert.equal(process.argv[1], root + '/cli-entry.mjs');
  assert.deepEqual(Object.keys(process.env).sort(), ['LC_ALL', 'PATH', 'TZ']);
  assert.equal(process.env.PATH, '/usr/bin:/bin');
  assert.equal(process.env.LC_ALL, 'C');
  assert.equal(process.env.TZ, 'UTC');
  const [executionCommit, expectedSeal, grantSha256, activationToken] = process.argv.slice(2);
  const result = await launch(executionCommit, expectedSeal, grantSha256, activationToken);
  process.stdout.write(JSON.stringify({ allPass: result.allPass, executionCommit, activationToken, closeObserved: result.closeObserved, unsafe: result.unsafe, elapsedMs: result.elapsedMs }) + '\n');
  process.exitCode = result.allPass === true ? 0 : 1;
} catch (reason) {
  process.stderr.write(JSON.stringify({ classification: 'CLI_ADMISSION_STOP', name: reason?.name ?? null, message: String(reason?.message ?? reason).slice(0, 4096), stack: typeof reason?.stack === 'string' ? reason.stack.slice(0, 8192) : null }) + '\n');
  process.exitCode = 1;
}
