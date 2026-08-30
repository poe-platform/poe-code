import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const destination = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Supply a new verifier-owned /tmp directory');
assert(destination.startsWith('/tmp/') || destination.startsWith('/private/tmp/'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'PRESEAL.json')));
const catalogBytes = await readFile(join(root, 'sealed/catalog.json'));
assert.equal(hash(catalogBytes), manifest.privateCatalogSha256);
const catalog = JSON.parse(catalogBytes);
await mkdir(destination, { mode: 0o700 });
for (const entry of catalog.artifacts) {
  const bytes = await readFile(join(root, 'sealed/artifacts', entry.id));
  assert.equal(hash(bytes), entry.sha256, entry.relativePath);
  assert.equal(bytes.length, entry.bytes);
  const target = resolve(destination, entry.relativePath);
  assert(target.startsWith(`${destination}/`));
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if (entry.type === 'symlink-target') {
    const link = bytes.toString();
    assert(resolve(dirname(target), link).startsWith(`${destination}/`));
    await symlink(link, target);
  } else await writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
}
await writeFile(join(destination, 'seal-catalog.json'), catalogBytes, { flag: 'wx', mode: 0o400 });
console.log(JSON.stringify({ restoredArtifacts: catalog.artifacts.length, originalArtifactRoot: manifest.artifactRootSha256, destination, productExecutions: 0 }));
