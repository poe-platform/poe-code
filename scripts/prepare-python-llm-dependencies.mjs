import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [consumerRoot, destination] = process.argv.slice(2);
if (!consumerRoot || !destination) throw new Error('Usage: prepare-python-llm-dependencies.mjs CONSUMER_ROOT DESTINATION');
const packageRoot = resolve(consumerRoot, 'node_modules/@poe-platform/safe-bash');
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const pythonEntry = resolve(packageRoot, manifest.exports['./commands/python'].import);
const { pythonLlmDependencies } = await import(pathToFileURL(pythonEntry).href);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(destination, {recursive:true});
for (const archive of pythonLlmDependencies.archives) {
  const response = await fetch(new URL(archive.fileName, pythonLlmDependencies.baseUrl), {signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error('Dependency download failed: ' + archive.fileName + ' (' + response.status + ')');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== archive.byteLength || digest(bytes) !== archive.sha256) {
    throw new Error('Dependency authentication failed: ' + archive.fileName);
  }
  await writeFile(resolve(destination, archive.fileName), bytes);
}
for (const native of pythonLlmDependencies.nativeModules) {
  const output = resolve(destination, native.path);
  await mkdir(dirname(output), {recursive:true});
  const result = spawnSync('python3', ['-c',
    'import sys,zipfile; archive,member,output=sys.argv[1:]; data=zipfile.ZipFile(archive).read(member); open(output,"wb").write(data)',
    resolve(destination, native.archive), native.path, output], {encoding:'utf8',timeout:30_000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Native dependency extraction failed');
  if (digest(await readFile(output)) !== native.sha256) throw new Error('Native dependency authentication failed: ' + native.path);
}
