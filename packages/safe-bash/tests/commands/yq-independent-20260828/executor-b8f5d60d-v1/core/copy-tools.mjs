import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertTree, atomicJson, canonical, canonicalPath, fileDigest, inside, newDirectory, readBoundJson, requireFact } from './primitives.mjs';

export function materializeToolData({ sourceSealPath, sourceSealSha256, destination, preparationPath, preparationSha256 }) {
  const permission = readBoundJson(preparationPath, preparationSha256);
  requireFact(permission.purpose === 'STATIC_TOOL_DATA_COPY_ONLY' && permission.authorized === true && permission.destination === destination && permission.sourceSealSha256 === sourceSealSha256 && permission.RootGO === false, 'TOOL_DATA_COPY_NOT_AUTHORIZED');
  const source = readBoundJson(sourceSealPath, sourceSealSha256);
  canonicalPath(dirname(destination));
  for (const item of Object.values(source.tools)) requireFact(!inside(item.path, destination) && !inside(destination, item.path), 'TOOL_COPY_OVERLAP');
  for (const [name, item] of Object.entries(source.tools)) {
    if (item.files) assertTree(item.path, { files: item.files, directories: item.directories });
    else requireFact(canonical(fileDigest(item.path, 134217728)) === canonical({ sha256: item.sha256, bytes: item.bytes, mode: item.mode }), 'TOOL_SOURCE_FILE', name);
  }
  const manifest = source.expectedCopyManifest;
  newDirectory(destination, manifest.directories['']);
  chmodSync(destination, manifest.directories['']);
  for (const [name, mode] of Object.entries(manifest.directories).filter(([name]) => name).sort(([left], [right]) => left.split('/').length - right.split('/').length || left.localeCompare(right))) { mkdirSync(join(destination, name), { mode }); chmodSync(join(destination, name), mode); }
  for (const [name, item] of Object.entries(source.tools)) {
    const base = source.copiedRelative[name];
    if (item.files) for (const [suffix, descriptor] of Object.entries(item.files)) { copyFileSync(join(item.path, suffix), join(destination, base, suffix), 1); chmodSync(join(destination, base, suffix), descriptor.mode); }
    else { copyFileSync(item.path, join(destination, base), 1); chmodSync(join(destination, base), item.mode); }
  }
  assertTree(destination, manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
  return { toolchain: { root: destination, manifest, ...source.copiedRelative, versions: { node: 'v22.22.2', typescript: '5.9.3' } }, proofRole: 'COPIED_REGULAR_TOOL_DATA_ONLY', sourceSealSha256, RootGO: false, candidateExecution: false };
}
