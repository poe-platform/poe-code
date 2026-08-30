import { gzipSync } from 'node:zlib';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { canonical, directoriesFor, equal, freshDirectory, regularBytes, requireFact, safeRelative, sha256, writeFresh } from './build-fs.mjs';

export function emittedPaths(sourceFiles) {
  return Object.keys(sourceFiles).filter(path => path.startsWith('src/') && path.endsWith('.ts')).flatMap(path => ['.js', '.d.ts', '.js.map', '.d.ts.map'].map(extension => path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension))).sort();
}

export async function relocateMap(path, raw, rawRoot, sourceRoot, sourceFiles, bounds, plan) {
  const text = raw.toString('utf8');
  requireFact(Buffer.from(text).equals(raw), 'MAP_UTF8', false);
  let parsed;
  try { parsed = JSON.parse(text); } catch { requireFact(false, 'MAP_JSON', false); }
  const suffix = raw.at(-1) === 10 ? '\n' : '';
  equal(Object.keys(parsed).sort(), [...plan.mapRelocation.keys].sort(), 'MAP_METADATA_KEYS', false);
  requireFact(JSON.stringify(parsed) + suffix === text, 'MAP_RAW_SERIALIZATION', false);
  requireFact(parsed.version === 3 && parsed.sourceRoot === '' && parsed.file === basename(path.slice(0, -4)) && Array.isArray(parsed.sources) && parsed.sources.length === 1 && typeof parsed.sources[0] === 'string' && Array.isArray(parsed.names) && parsed.names.every(name => typeof name === 'string') && typeof parsed.mappings === 'string', 'MAP_SHAPE', false);
  const sourcePath = path.replace(/^dist\//u, 'src/').replace(/(?:\.d\.ts|\.js)\.map$/u, '.ts');
  requireFact(Object.hasOwn(sourceFiles, sourcePath), 'MAP_SELECTED_SOURCE', false);
  const rawParent = dirname(join(rawRoot, path)), target = join(sourceRoot, sourcePath);
  requireFact(resolve(rawParent, parsed.sources[0]) === target && parsed.sources[0] === relative(rawParent, target).split('\\').join('/'), 'MAP_RAW_SOURCE_OR_ALIAS', false);
  await regularBytes(target, bounds.fileBytes, sourceFiles[sourcePath]);
  const before = parsed.sources[0];
  const after = posix.relative(posix.dirname(path), sourcePath);
  const relocated = { ...parsed, sources: [after] };
  const bytes = Buffer.from(JSON.stringify(relocated) + suffix);
  const restored = { ...relocated, sources: [before] };
  requireFact(Buffer.from(JSON.stringify(restored) + suffix).equals(raw), 'MAP_NON_SOURCE_CHANGE', false);
  return { bytes, relocation: { sourcePath, sourceIdentity: sourceFiles[sourcePath], before, after, changedFieldOnly: 'sources[0]', sourceRoot: '', rawRetained: true } };
}

export async function compareOutputs(paths, rawTree, rawRoot, sourceRoot, sourceFiles, expectedPackage, plan) {
  equal(Object.keys(rawTree.files).sort(), paths, 'OUTPUT_MEMBERSHIP', false);
  equal(rawTree.directories, directoriesFor(Object.fromEntries(paths.map(path => [path, expectedPackage.files[path]]))), 'OUTPUT_DIRECTORY_MODES', false);
  const comparisons = [];
  for (const path of paths) {
    try {
      const raw = await regularBytes(join(rawRoot, path), plan.bounds.fileBytes, rawTree.files[path]);
      requireFact(raw.identity.mode === 420, 'OUTPUT_FILE_MODE', false);
      const transformed = path.endsWith('.map') ? await relocateMap(path, raw.bytes, rawRoot, sourceRoot, sourceFiles, plan.bounds, plan) : { bytes: raw.bytes, relocation: null };
      const final = { sha256: sha256(transformed.bytes), bytes: transformed.bytes.length, mode: raw.identity.mode };
      const expected = expectedPackage.files[path];
      comparisons.push({ path, raw: raw.identity, expected, final, rawByteEqual: canonical(raw.identity) === canonical(expected), finalByteEqual: canonical(final) === canonical(expected), relocation: transformed.relocation });
    } catch (error) { throw Object.assign(error, { outputPath: path, partialComparisons: comparisons }); }
  }
  return comparisons;
}

export async function makePackage(packageRoot, rawRoot, sourceRoot, sourceFiles, expectedPackage, comparisons, plan) {
  requireFact(comparisons.length === plan.counts.compilerOutputs && comparisons.every(entry => entry.finalByteEqual), 'OUTPUTS_NOT_ALL_EQUAL', false);
  await freshDirectory(packageRoot);
  for (const path of Object.keys(expectedPackage.directories).filter(Boolean).sort()) await freshDirectory(join(packageRoot, path));
  for (const comparison of comparisons) {
    const raw = await regularBytes(join(rawRoot, comparison.path), plan.bounds.fileBytes, comparison.raw);
    const transformed = comparison.relocation ? await relocateMap(comparison.path, raw.bytes, rawRoot, sourceRoot, sourceFiles, plan.bounds, plan) : { bytes: raw.bytes };
    await writeFresh(join(packageRoot, comparison.path), transformed.bytes, expectedPackage.files[comparison.path]);
  }
  for (const path of ['README.md', 'package.json']) {
    const source = await regularBytes(join(sourceRoot, path), plan.bounds.fileBytes, sourceFiles[path]);
    equal(source.identity, expectedPackage.files[path], 'BASELINE_METADATA_IDENTITY');
    await writeFresh(join(packageRoot, path), source.bytes, expectedPackage.files[path]);
  }
}

function header(name, size) {
  safeRelative(name);
  requireFact(Buffer.byteLength(name, 'ascii') === Buffer.byteLength(name) && Buffer.byteLength(name) <= 100, 'TAR_NAME');
  const bytes = Buffer.alloc(512);
  bytes.write(name, 0, 100, 'ascii');
  const octal = (offset, width, value) => {
    const encoded = value.toString(8).padStart(width - 2, '0') + ' \0';
    requireFact(encoded.length === width, 'TAR_NUMBER_BOUND');
    bytes.write(encoded, offset, width, 'ascii');
  };
  octal(100, 8, 420); octal(124, 12, size); octal(136, 12, 499162500);
  bytes.fill(32, 148, 156); bytes.write('0', 156, 'ascii'); bytes.write('ustar\0' + '00', 257, 'ascii');
  octal(329, 8, 0); octal(337, 8, 0); octal(148, 8, bytes.reduce((sum, byte) => sum + byte, 0));
  return bytes;
}

export async function serializePackage(root, manifest, plan) {
  const names = plan.packing.entryOrder.map(entry => entry.path);
  equal([...names].sort(), Object.keys(manifest.files).sort(), 'TAR_COMPLETE_MEMBERSHIP');
  requireFact(new Set(names).size === names.length && names.length === 870, 'TAR_UNIQUE_MEMBERSHIP');
  let bytesNeeded = 1024;
  for (const path of names) bytesNeeded += 512 + Math.ceil(manifest.files[path].bytes / 512) * 512;
  requireFact(bytesNeeded === plan.archive.tarBytes && bytesNeeded <= plan.bounds.artifactBytes, 'TAR_BYTES_BOUND');
  const tar = Buffer.alloc(bytesNeeded);
  let offset = 0;
  for (const entry of plan.packing.entryOrder) {
    requireFact(entry.name === `package/${entry.path}`, 'TAR_PACKAGE_NAME');
    const file = await regularBytes(join(root, entry.path), plan.bounds.fileBytes, manifest.files[entry.path]);
    requireFact(file.identity.mode === 420, 'TAR_MODE');
    header(entry.name, file.bytes.length).copy(tar, offset); offset += 512;
    file.bytes.copy(tar, offset); offset += Math.ceil(file.bytes.length / 512) * 512;
  }
  requireFact(offset + 1024 === tar.length, 'TAR_TERMINATOR');
  const packed = gzipSync(tar, { level: 9, strategy: 0, memLevel: 8, windowBits: 15 });
  requireFact(packed.length <= plan.bounds.artifactBytes && packed[0] === 31 && packed[1] === 139 && packed[2] === 8 && packed[3] === 0, 'GZIP_HEADER_BOUND');
  packed[9] = 255;
  return { tar, packed };
}
