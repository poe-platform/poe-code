import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { admitCandidate, relativePath, requireReady, sha256 } from './binding.mjs';

export function preparePackageConsumer(packetBytes, go, files, preparationSha256) {
  const packet = admitCandidate(packetBytes, go, files, preparationSha256);
  requireReady(packet.kind === 'installed' || packet.kind === 'moved', 'installed/moved route only');
  const resolution = packet.resolution;
  requireReady(resolution && packet.packageFiles.includes(resolution.manifest), 'exact installed package manifest');
  const manifest = JSON.parse(files.get(resolution.manifest));
  assert.equal(manifest.name, 'virtual-bash'); assert.equal(manifest.type, 'module');
  requireReady(typeof resolution.exportKey === 'string' && (resolution.exportKey === '.' || resolution.exportKey.startsWith('./')), 'explicit package export key');
  const target = manifest.exports?.[resolution.exportKey];
  const selected = typeof target === 'string' ? target : target?.import;
  requireReady(typeof selected === 'string' && selected.startsWith('./'), 'finite direct import export target; complex conditions HOLD');
  if (typeof target === 'object') requireReady(Object.keys(target).every(key => ['types', 'import'].includes(key)), 'unqualified export conditions');
  const entry = relativePath(posix.join(posix.dirname(resolution.manifest), selected));
  assert.equal(entry, packet.entry);
  assert.equal(packet.moduleSpecifier, `virtual-bash${resolution.exportKey === '.' ? '' : resolution.exportKey.slice(1)}`);
  requireReady(typeof resolution.frozenRoot === 'string' && resolution.frozenRoot.startsWith('/') && typeof resolution.consumerPath === 'string' && resolution.consumerPath.startsWith(`${resolution.frozenRoot}/`), 'exclusive installed/moved consumer root');
  requireReady(resolution.resolvedURL === `file://${resolution.frozenRoot}/${entry}`, 'exact no-alias resolved import URL');
  requireReady(resolution.adapterURL && resolution.recordsURL && resolution.helperClosureSha256 && resolution.recipeSha256, 'bound external consumer/helper/data closure');
  if (packet.kind === 'moved') {
    requireReady(typeof resolution.originalRoot === 'string' && resolution.originalRoot !== resolution.frozenRoot && resolution.originalRootInaccessible === true, 'old root denied during moved execution');
    assert.equal(resolution.originalEntrySha256, sha256(files.get(packet.entry)), 'same bytes after move');
  }
  const source = [
    `import assert from 'node:assert/strict';`,
    `import { readFileSync } from 'node:fs';`,
    `import { exerciseSix } from ${JSON.stringify(resolution.adapterURL)};`,
    `const specifier = ${JSON.stringify(packet.moduleSpecifier)};`,
    `assert.equal(import.meta.resolve(specifier), ${JSON.stringify(resolution.resolvedURL)});`,
    `const recordsBytes = readFileSync(new URL(${JSON.stringify(resolution.recordsURL)}));`,
    `const records = JSON.parse(recordsBytes);`,
    `const namespace = await import(specifier);`,
    `assert.deepEqual(Object.keys(namespace).sort(), ${JSON.stringify([...packet.api].sort())});`,
    `const observations = await exerciseSix(namespace, records);`,
    `process.stdout.write(JSON.stringify({ route: ${JSON.stringify(packet.kind)}, observations }) + '\\n');`,
    '',
  ].join('\n');
  requireReady(sha256(source) === resolution.recipeSha256, 'consumer source must be precomputed and separately ROOT-bound');
  return { source, executable: packet.node.path, executableSha256: packet.node.sha256, argv: [resolution.consumerPath], expectedObservations: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'], execution: 'HOLD_PARENT_MUST_AUTHENTICATE_ALL_FILES_AND_FENCE_BEFORE_NODE_START' };
}
