import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const directory = 'tests/fs/s3/http/author';
const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]+$/);
const isolated = `${directory}/.isolated/${label}`;
const output = `${directory}/public-build-${label}.json`;
assert.equal(existsSync(isolated), false);
assert.equal(existsSync(output), false);
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const sources = walk('src').filter(name => name.endsWith('.ts')).sort();
const inputs = [...sources, 'package.json', 'tsconfig.json', 'tsconfig.build.json', `${directory}/public-consumer.mts`];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contents = Object.fromEntries(inputs.map(name => [name, readFileSync(name, 'utf8')]));
const hashes = Object.fromEntries(Object.entries(contents).map(([name, content]) => [name, hash(content)]));
const snapshots = Object.fromEntries([...sources, 'package.json', 'tsconfig.json', 'tsconfig.build.json'].map(name => [`${isolated}/${name}`, contents[name]]));
snapshots[`${isolated}/example/public-consumer.mts`] = contents[`${directory}/public-consumer.mts`];
const addFiles = files => {
  const patch = Object.entries(files).map(([name, content]) => {
    assert.ok(content.endsWith('\n'), name);
    return `*** Add File: ${name}\n${content.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n`;
  }).join('');
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n${patch}*** End Patch\n`, maxBuffer: 16 * 1024 * 1024 });
};
addFiles(snapshots);
for (const [name, content] of Object.entries(snapshots)) assert.equal(readFileSync(name, 'utf8'), content);
const compiler = path.resolve('node_modules/typescript/bin/tsc');
const strict = ['--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', '--noEmitOnError'];
const commands = [
  ['real-package-build', [compiler, '--project', `${isolated}/tsconfig.build.json`, '--noEmitOnError']],
  ['public-consumer-compile', [compiler, ...strict, '--declaration', '--rootDir', `${isolated}/example`, '--outDir', `${isolated}/example-dist`, `${isolated}/example/public-consumer.mts`]],
  ['public-consumer-import', ['--unhandled-rejections=strict', '--input-type=module', '--eval',
    `const module = await import(${JSON.stringify(new URL(`file://${path.resolve(isolated)}/example-dist/public-consumer.mjs`).href)}); if (typeof module.runPublicS3Example !== 'function') throw new Error('missing public example function'); console.log('public consumer imported');`]],
];
const results = [];
for (const [name, args] of commands) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  results.push({ name, executable: process.execPath, args, cwd: process.cwd(), started, finished: new Date().toISOString(),
    status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
  console.log(name, result.status, result.stdout || result.stderr || '');
  if (result.status !== 0) break;
}
const changed = inputs.filter(name => hash(readFileSync(name)) !== hashes[name]);
const built = Object.fromEntries([`${isolated}/dist`, `${isolated}/example-dist`].flatMap(directory => existsSync(directory) ? walk(directory) : [])
  .map(name => [name, hash(readFileSync(name))]));
const record = { classification: 'Author isolated public-package build; actual service execution separate',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version,
  isolated, compiledExample: `${isolated}/example-dist/public-consumer.mjs`, packageManifest: JSON.parse(contents['package.json']),
  inputHashes: hashes, changedDuringBuild: changed, builtHashes: built, results };
addFiles({ [output]: JSON.stringify(record, null, 2) + '\n' });
console.log(JSON.stringify({ output, compiledExample: record.compiledExample, statuses: results.map(result => result.status), changed }));
assert.deepEqual(changed, []);
for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr);
