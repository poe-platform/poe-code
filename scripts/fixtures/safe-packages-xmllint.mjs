import assert from 'node:assert/strict';
import { Shell, createMemoryFileSystem, standardCommands } from '@poe-platform/safe-bash';
import { xmlCommands, createXmlCommands, defaultXmlQueryLimits } from '@poe-platform/safe-bash/commands/xml';
import { FsError } from '@poe-platform/safe-bash/contracts/errors';
import { FsError as CanonicalFsError } from '@poe-platform/safe-fs/core';

assert.equal(FsError, CanonicalFsError);
assert.equal(defaultXmlQueryLimits.maxNodes, 10_000);
for (const name of ['safe-bash-command-xmllint', 'safe-bash-xml-engine']) {
  assert.throws(() => import.meta.resolve(name), { code: 'ERR_MODULE_NOT_FOUND' });
}
const fs = createMemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('<root><item/><item/></root>'));
await fs.writeFile('/run.sh', new TextEncoder().encode("cat /input | xmllint --xpath 'count(/root/item)'\n"));
const shell = new Shell({ fs }).use(standardCommands()).use(xmlCommands());
try {
  assert.equal((await shell.exec('sh /run.sh')).stdout, '2\n');
  assert.equal((await shell.exec('xmllint --noout /input')).exitCode, 0);
  assert.equal((await shell.exec("xmllint --xpath $'\\xff' /input")).exitCode, 2);
  assert.equal((await shell.exec("xq '.root.item | length' /input")).stdout.trim(), '2');
  assert.throws(() => xmlCommands().setup({ commands: shell.commands }), /already registered/);
  xmlCommands({ replace: true, limits: { maxOutputBytes: 1 } }).setup({ commands: shell.commands });
  assert.equal((await shell.exec('xmllint --c14n /input')).exitCode, 5);
  assert.deepEqual(createXmlCommands().map(command => command.name), ['xq', 'xmllint']);
  const reason = new Error('packed cancellation');
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(shell.exec('xmllint --noout /input', { signal: controller.signal }), error => error === reason);
} finally { await shell.dispose(); }
console.log('Packed xmllint/XML boundary verified');
