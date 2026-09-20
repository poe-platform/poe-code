import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const consumer = process.argv[2];
if (!consumer) throw new Error('Usage: node scripts/verify-safe-cloudflare.mjs <installed-consumer-directory>');
const installed = resolve(consumer, 'node_modules/@poe-platform/safe-bash');
const manifest = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
const entry = manifest.exports['./playwright/cloudflare'];
assert.equal(manifest.peerDependencies['@cloudflare/playwright'], '1.3.6');
assert.equal(manifest.peerDependenciesMeta['@cloudflare/playwright'].optional, true);
assert.equal(manifest.dependencies['@cloudflare/playwright'], undefined);
assert.ok(entry?.types && entry?.import);
const directory = dirname(resolve(installed, entry.import));
async function text(filename) {
  const metadata = await lstat(filename);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 8 * 1024 * 1024);
  return readFile(filename, 'utf8');
}
assert.ok((await text(resolve(installed, entry.types))).includes('createCloudflarePlaywrightAdapter'));
const guest = await text(resolve(directory, 'browser-run-code-guest.generated.js'));
assert.ok(guest.includes('cloudflare:workers') && guest.includes('browser-user-code.js'));
assert.ok((await text(resolve(directory, 'browser-codegen.generated.js'))).includes('@cloudflare/playwright@1.3.6'));
const attribution = resolve(installed, 'third-party/safe-playwright-cloudflare/third-party/playwright');
assert.ok((await text(resolve(attribution, 'LICENSE'))).includes('Apache License'));
assert.ok((await text(resolve(attribution, 'NOTICE'))).includes('Microsoft Corporation'));
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn('npm', ['run', 'test:native', '--workspace=@poe-code/safe-playwright-cloudflare'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, SAFE_PLAYWRIGHT_INSTALLED_ROOT: installed },
});
child.on('error', error => { throw error; });
const result = await new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
if (result.code !== 0) throw new Error('Installed Cloudflare conformance failed: ' + (result.signal ?? result.code));
console.log('Installed Cloudflare exports, bundled assets, licenses, and native conformance verified');
