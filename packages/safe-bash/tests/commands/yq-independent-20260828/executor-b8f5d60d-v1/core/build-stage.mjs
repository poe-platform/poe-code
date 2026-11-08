import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assertTree, canonical, newDirectory, readRegular, requireFact, sha256, snapshot } from './primitives.mjs';

function packageHeader(name, size) {
  requireFact(Buffer.byteLength(name) <= 100 && /^[\x20-\x7e]+$/u.test(name), 'PACKAGE_HEADER_NAME');
  const bytes = Buffer.alloc(512);
  bytes.write(name, 0, 'ascii');
  const octal = (offset, width, value) => bytes.write(`${value.toString(8).padStart(width - 2, '0')} \0`, offset, width, 'ascii');
  octal(100, 8, 420);
  octal(124, 12, size);
  octal(136, 12, 499162500);
  bytes.fill(32, 148, 156);
  bytes.write('0', 156, 'ascii');
  bytes.write('ustar\0' + '00', 257, 'ascii');
  octal(329, 8, 0);
  octal(337, 8, 0);
  octal(148, 8, bytes.reduce((sum, byte) => sum + byte, 0));
  return bytes;
}
export async function runWorker(api) {
  await api.phase('admission', { independentCompiler: true, priorBuildProofInherited: false });
  const plan = await api.readBoundJson('buildPlan');
  requireFact(plan.candidate === api.bindings.candidate && plan.sourceFiles.length === 217, 'SCOPED_BUILD_BINDING');
  assertTree(api.bindings.sourceRoot, api.bindings.sourceManifest);
  const output = newDirectory(join(api.request.scratchRoot, 'compiler-output'), 0o755);
  const configPath = join(api.request.scratchRoot, 'tsconfig.build.json');
  const compilerOptions = { ...plan.baseCompilerOptions, ...plan.buildCompilerOptions, rootDir: join(api.bindings.sourceRoot, 'src'), outDir: join(output, 'dist'), typeRoots: [dirname(api.bindings.nodeTypesRoot)] };
  const config = { compilerOptions, files: plan.sourceFiles.map(name => join(api.bindings.sourceRoot, name)) };
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, { flag: 'wx', mode: 0o600 });
  await api.note('build-config', { path: configPath, sha256: sha256(readRegular(configPath)), files: config.files.length, skipLibCheck: compilerOptions.skipLibCheck, sourceSelectionOnly: true });
  await api.phase('operation', { operation: 'independent-scoped-compiler', maximumMs: 120000 });
  const compiler = await api.runTool({ kind: 'compiler', configPath, timeoutMs: 120000 });
  await api.phase('capture', { compilerRawDurable: true });
  await api.writeJson('compiler-outcome.json', compiler);
  requireFact(compiler.code === 0 && compiler.signal === null && !compiler.timedOut && compiler.reaped && !compiler.overflow && !compiler.spawnError, 'INDEPENDENT_COMPILER_FAILURE');
  const raw = snapshot(output);
  await api.writeJson('raw-compiler-map.json', raw);
  requireFact(canonical(Object.keys(raw.files).sort()) === canonical(plan.expectedOutputPaths), 'BUILD_OUTPUT_MEMBERSHIP');
  const independent = new Map();
  const comparisons = [];
  for (const name of plan.expectedOutputPaths) {
    let bytes = readRegular(join(output, name));
    let relocation = null;
    if (name.endsWith('.map')) {
      const parsed = JSON.parse(bytes);
      const suffix = bytes.at(-1) === 10 ? '\n' : '';
      requireFact(JSON.stringify(parsed) + suffix === bytes.toString('utf8') && Array.isArray(parsed.sources) && parsed.sources.length === 1 && parsed.sourceRoot === '', 'RAW_SOURCE_MAP_SHAPE');
      const sourcePath = name.replace(/^dist\//u, 'src/').replace(/(?:\.d\.ts|\.js)\.map$/u, '.ts');
      requireFact(api.bindings.sourceManifest.files[sourcePath] && resolve(dirname(join(output, name)), parsed.sources[0]) === join(api.bindings.sourceRoot, sourcePath), 'RAW_SOURCE_MAP_ORIGIN');
      const before = parsed.sources[0];
      parsed.sources = [posix.relative(posix.dirname(name), sourcePath)];
      bytes = Buffer.from(JSON.stringify(parsed) + suffix);
      relocation = { before, after: parsed.sources[0], changedFieldOnly: 'sources[0]', sourcePath };
    }
    const expected = api.bindings.packageManifest.files[name];
    const matches = expected && expected.sha256 === sha256(bytes) && expected.bytes === bytes.length && raw.files[name].mode === expected.mode;
    comparisons.push({ path: name, raw: raw.files[name], normalizedSha256: sha256(bytes), relocation, matches });
    independent.set(name, bytes);
  }
  await api.writeJson('compiler-comparisons.json', comparisons);
  requireFact(comparisons.every(row => row.matches), 'INDEPENDENT_OUTPUT_MISMATCH');
  for (const name of ['README.md', 'package.json']) {
    const bytes = readRegular(join(api.bindings.sourceRoot, name));
    requireFact(sha256(bytes) === api.bindings.packageManifest.files[name].sha256, 'FULL_PACKAGE_METADATA');
    independent.set(name, bytes);
  }
  requireFact(independent.size === 870, 'FULL_PACKAGE_870');
  const sourceBuiltRoot = newDirectory(join(api.request.scratchRoot, 'source-built-package'), 0o755);
  for (const [name, mode] of Object.entries(api.bindings.packageManifest.directories).filter(([name]) => name).sort(([left], [right]) => left.split('/').length - right.split('/').length || left.localeCompare(right))) { mkdirSync(join(sourceBuiltRoot, name), { mode }); chmodSync(join(sourceBuiltRoot, name), mode); }
  for (const [name, bytes] of independent) { writeFileSync(join(sourceBuiltRoot, name), bytes, { flag: 'wx', mode: 0o644 }); chmodSync(join(sourceBuiltRoot, name), 0o644); }
  assertTree(sourceBuiltRoot, api.bindings.packageManifest);
  const tarParts = [];
  let packedBytes = 1024;
  for (const entry of plan.packageEntries) {
    const bytes = independent.get(entry.path);
    requireFact(bytes && entry.name === `package/${entry.path}`, 'PACKAGE_ORDER_BINDING');
    const padding = Buffer.alloc((512 - bytes.length % 512) % 512);
    packedBytes += 512 + bytes.length + padding.length;
    requireFact(packedBytes <= 67108864, 'INDEPENDENT_TAR_BOUND');
    tarParts.push(packageHeader(entry.name, bytes.length), bytes, padding);
  }
  tarParts.push(Buffer.alloc(1024));
  const tar = Buffer.concat(tarParts);
  const packed = gzipSync(tar, { level: 9, strategy: 0, memLevel: 8, windowBits: 15 });
  packed[9] = 255;
  const packedArtifact = await api.writeBytes('independent-package.tgz', packed);
  const packing = { expected: plan.serialization.expectedRawArchiveSha256, actual: packedArtifact.sha256, matches: packedArtifact.sha256 === plan.serialization.expectedRawArchiveSha256, attempts: 1, serialization: 'INDEPENDENT_HEADER_AND_GZIP_FROM_NEW_COMPILER_OUTPUTS', zlib: process.versions.zlib };
  await api.writeJson('independent-packing.json', packing);
  requireFact(packing.matches, 'INDEPENDENT_SERIALIZATION_MISMATCH');
  assertTree(output, raw);
  await api.phase('cleanup');
  await api.guard();
  await api.phase('complete');
  const independentBuild = { candidate: api.bindings.candidate, independentlyCompiled: true, compilerCode: compiler.code, compilerProcess: compiler, sourceMapSha256: sha256(canonical(api.bindings.sourceManifest.files)), packageMapSha256: sha256(canonical(api.bindings.packageManifest)), rawOutputMapSha256: sha256(canonical(raw)), serialization: packing, rootGoSha256: api.request.rootGoSha256, recipeSha256: api.request.recipeSha256 };
  return { status: 'PASS', proofRole: 'independent-build-and-serialization-only', details: { fullFiles: 870, semanticPasses: 0, metadataReadmeIncluded: true }, stageOutput: { sourceBuiltRoot, independentBuild } };
}
