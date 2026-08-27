import assert from 'node:assert/strict';
import { Shell, MemoryFileSystem, standardCommands, searchCommands } from 'virtual-bash';

assert.ok(import.meta.resolve('virtual-bash').startsWith(new URL('./node_modules/virtual-bash/', import.meta.url).href), 'must resolve moved packed product, not repository self-reference');
const fs = new MemoryFileSystem();
await fs.writeFile('/input', Buffer.from('ab\ncd\n'));
const shell = new Shell({ fs }).use(standardCommands({ regex: { requestTimeoutMs: 1000 } })).use(searchCommands({ regex: { requestTimeoutMs: 1000 } }));
try {
  const result = await shell.exec("grep -E '^a' /input | rg 'b$'");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'ab\n'); assert.equal(result.stderr, '');
  console.log(JSON.stringify({ pass: true, stdout: result.stdout, node: process.version, packageLocation: import.meta.resolve('virtual-bash') }));
} finally { await shell.dispose(); }
