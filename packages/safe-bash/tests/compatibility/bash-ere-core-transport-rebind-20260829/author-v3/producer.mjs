import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateAuthorization, SOURCE_COMMIT, SOURCE_REVIEW } from '../author-v2/contract.mjs';
import { DATA_MAX, DEADLINE, read, hash, digest, verify, inventory, writer, createOwner } from './io.mjs';
import { validateComposition, fullEmitDelta } from '../recipe.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), parent = path.dirname(own), repo = path.resolve(parent, '../../..');
const output = path.join(own, 'output');
const composition = JSON.parse(read(path.join(parent, 'COMPOSITION.json')));
const oldSealRaw = read(path.join(parent, 'PRESEAL.json'));
assert.equal(hash(oldSealRaw), '02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17');
for (const row of JSON.parse(oldSealRaw).files) verify(row, path.join(parent, row.path));
const write = writer(parent);
const [mode, expectedSeal, expectedGrant, committedProducer, frozenReceiptSha] = process.argv.slice(2);
const rootDecisionSha256 = hash(read(path.join(own, 'ROOT-DECISION.txt')));
const compiler = composition.tools.typescript.find(row => row.path.endsWith('/lib/tsc.js'));
assert(compiler);
const userConfig = path.join(parent, 'user.npmrc'), globalConfig = path.join(parent, 'global.npmrc');
const env = { PATH: path.dirname(composition.tools.node.path), HOME: path.join(output, 'home'), TMPDIR: path.join(output, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: path.join(output, 'cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };

function toolsSnapshot() {
  const typeManifest = JSON.parse(read(path.join(own, 'TYPE-TOOLS.json')));
  for (const row of typeManifest.rows) { verify(row); verify(row, row.origin); }
  const typeRows = inventory(typeManifest.root).rows;
  assert.equal(typeRows.length, typeManifest.rows.length);
  for (const row of typeRows) { const expected = typeManifest.rows.find(item => item.path === path.join(typeManifest.root, row.path)); assert(expected); assert.equal(row.sha256, expected.sha256); assert.equal(row.size, expected.size); }
  const tools = composition.tools;
  assert.equal(process.execPath, tools.node.path);
  verify(tools.node, tools.node.path, true); verify(tools.git, tools.git.path, true);
  for (const row of tools.typescript) verify(row);
  const expectedRows = tools.npm.rows.map(row => row.kind === 'link' ? { path: row.path, kind: row.kind, mode: row.mode, text: row.text, target: row.target, targetSha256: row.targetSha256, targetSize: row.targetSize } : { path: row.path, kind: 'file', size: row.size, mode: row.mode, sha256: row.sha256 }).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const rows = [], directories = [];
  const walk = directory => { for (const name of fs.readdirSync(directory).sort()) { const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(tools.npmRoot, filename); if (stat.isDirectory()) { directories.push(relative); walk(filename); } else if (stat.isSymbolicLink()) { const resolved = fs.realpathSync(filename); assert(resolved.startsWith(tools.npmRoot + '/')); const target = digest(resolved); rows.push({ path: relative, kind: 'link', mode: stat.mode & 511, text: fs.readlinkSync(filename), target: path.relative(tools.npmRoot, resolved), targetSha256: target.sha256, targetSize: target.size }); } else { const value = digest(filename); rows.push({ path: relative, kind: 'file', size: value.size, mode: value.mode, sha256: value.sha256 }); } } };
  walk(tools.npmRoot); rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))); directories.sort();
  assert.equal(hash(Buffer.from(JSON.stringify(rows))), '63310df0713c0a6d54e153f43f881ca6bd6c4d710f9fc06c756064029c9f9241', 'qualified fixed npm canonical closure');
  assert.equal(hash(Buffer.from(JSON.stringify(expectedRows))), hash(Buffer.from(JSON.stringify(rows))), 'full npm extra/missing/drift');
  assert.equal(directories.length, 517); assert.equal(rows.filter(row => row.kind === 'file').length, 2027); assert.equal(rows.filter(row => row.kind === 'link').length, 12);
  assert.notEqual(fs.realpathSync(userConfig), fs.realpathSync(globalConfig)); assert.equal(read(userConfig).length, 0); assert.equal(read(globalConfig).length, 0);
  return { node: tools.node, git: tools.git, typescriptFiles: tools.typescript.length, npmRoot: tools.npmRoot, canonicalNpmRowsSha256: hash(Buffer.from(JSON.stringify(rows))), regularFiles: 2027, links: 12, directories: 517, configs: [digest(userConfig), digest(globalConfig)] };
}

function parseBatch(bytes, requested) {
  let offset = 0; const result = [];
  for (const row of requested) {
    const newline = bytes.indexOf(10, offset); assert(newline >= offset);
    const [blob, kind, sizeText] = bytes.subarray(offset, newline).toString().split(' '), size = Number(sizeText);
    assert.equal(kind, 'blob'); assert(Number.isSafeInteger(size) && size <= DATA_MAX);
    const body = bytes.subarray(newline + 1, newline + 1 + size); assert.equal(body.length, size); assert.equal(bytes[newline + size + 1], 10);
    assert.equal(crypto.createHash('sha1').update(Buffer.from('blob ' + size + '\0')).update(body).digest('hex'), blob);
    if (row.blob) assert.equal(blob, row.blob);
    if (row.bytes !== undefined) assert.equal(size, row.bytes);
    if (row.sha256) assert.equal(hash(body), row.sha256);
    result.push(body); offset = newline + size + 2;
  }
  assert.equal(offset, bytes.length); return result;
}

function staticInventory(rows, sourceRoot) {
  const privateAssets = rows.filter(row => row.path.startsWith('dist/commands/regex-execution/ere/'));
  const edges = [];
  for (const row of privateAssets.filter(row => row.path.endsWith('.js'))) {
    const text = read(path.join(sourceRoot, row.path)).toString();
    for (const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(row.path), match[2]));
      assert(rows.some(entry => entry.path === target)); edges.push({ from: row.path, specifier: match[2], to: target });
    }
  }
  return { privateAssets, privateAssetCount: privateAssets.length, literalStaticEdges: edges, literalStaticEdgeCount: edges.length, dynamicClosure: false };
}

async function main() {
  if (mode === 'seal') {
    assert.equal(JSON.parse(read(path.join(parent, 'author-v2/CONTRACT-RESULT.json'))).pass, 4);
    const files = ['ROOT-DECISION.txt', 'TYPE-TOOLS.json', 'io.mjs', 'producer.mjs', 'bindings.mjs'].map(name => ({ ...digest(path.join(own, name)), path: name }));
    const inputs = [path.join(parent, 'COMPOSITION.json'), path.join(parent, 'BASELINE-DATA.json'), path.join(parent, 'recipe.mjs'), path.join(parent, 'core-guard-v8.mjs'), userConfig, globalConfig, path.join(parent, 'author-v2/contract.mjs'), path.join(parent, 'author-v2/contract-controls.mjs'), path.join(parent, 'author-v2/CONTRACT-RESULT.json')].map(filename => digest(filename));
    const tools = toolsSnapshot();
    const seal = { schema: 'CORE_ROOT_AUTHOR_BUILD_V3', at: new Date().toISOString(), priorPresealSha256: hash(oldSealRaw), rootDecisionSha256, composition: composition.derivedTree, sourceCommit: SOURCE_COMMIT, sourcePureReview: SOURCE_REVIEW, producerIndependentReview: null, actualIndependentAuditRequiredAfterward: true, files, inputs, tools, commands: { compiler: { executable: composition.tools.node.path, args: [compiler.path, '-p', path.join(output, 'source/tsconfig.build.json'), '--typeRoots', path.join(own, 'type-tools/node_modules/@types')] }, pack: { executable: composition.tools.node.path, args: [path.join(composition.tools.npmRoot, 'bin/npm-cli.js'), 'pack', '--offline', '--ignore-scripts', '--json', '--userconfig=' + userConfig, '--globalconfig=' + globalConfig, '--pack-destination=' + path.join(output, 'package')] } }, env, output, caps: { globalDeadline: new Date(DEADLINE).toISOString(), knownOsMaximum: 48, peak: 3, captureBytes: 100663296, logicalWorkBytes: 536870912, perDataFileBytes: DATA_MAX, builds: 1, packs: 1 }, actualCoreAuthority: false };
    const sealRow = write.json(path.join(own, 'PRESEAL.json'), seal, 0o444);
    const grants = {};
    for (const [name, action] of [['BUILD-GRANT.json', 'BUILD_PACK_FREEZE'], ['DATA-GRANT.json', 'DECODE_BIND_DATA']]) {
      const grant = { authorizationKind: 'ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD', action, presealSha256: sealRow.sha256, composition: composition.derivedTree, outputRoot: output, sourceCommit: SOURCE_COMMIT, sourcePureReview: SOURCE_REVIEW, rootAuthorBuildDecisionSha256: rootDecisionSha256 };
      grants[name] = write.json(path.join(own, name), grant, 0o444);
    }
    console.log(JSON.stringify({ phase: 'FRESH_PRESEAL_BEFORE_COMPILER', preseal: sealRow, grants, tools })); return;
  }
  assert(['build', 'decode-bind'].includes(mode));
  assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile(), 'direct outer file capture');
  const sealRaw = read(path.join(own, 'PRESEAL.json')); assert.equal(hash(sealRaw), expectedSeal);
  const seal = JSON.parse(sealRaw); for (const row of seal.files) verify(row, path.join(own, row.path)); for (const row of seal.inputs) verify(row);
  const grantRaw = read(path.join(own, mode === 'build' ? 'BUILD-GRANT.json' : 'DATA-GRANT.json')); assert.equal(hash(grantRaw), expectedGrant);
  const authorization = validateAuthorization(JSON.parse(grantRaw), { action: mode === 'build' ? 'BUILD_PACK_FREEZE' : 'DECODE_BIND_DATA', presealSha256: expectedSeal, composition: composition.derivedTree, outputRoot: output, rootAuthorBuildDecisionSha256: rootDecisionSha256 });
  if (mode === 'build') { assert(!fs.existsSync(output)); fs.mkdirSync(output); for (const name of ['home', 'tmp', 'cache', 'source', 'empty-types', 'package']) fs.mkdirSync(path.join(output, name)); }
  const owner = createOwner({ root: parent, output, env, write });
  if (mode === 'decode-bind') {
    assert(/^[a-f0-9]{40}$/.test(committedProducer ?? '') && /^[a-f0-9]{64}$/.test(frozenReceiptSha ?? ''));
    const receiptPath = path.join(output, 'PRE-INFLATE-RECEIPT.json'), receiptRaw = read(receiptPath); assert.equal(hash(receiptRaw), frozenReceiptSha);
    const receipt = JSON.parse(receiptRaw); verify(receipt.archive); assert.equal(fs.lstatSync(receiptPath).mode & 0o222, 0); assert.equal(fs.lstatSync(receipt.archive.path).mode & 0o222, 0);
    const committed = await owner.run('commit-barrier', composition.tools.git.path, ['cat-file', '--batch'], { cwd: repo, input: [receiptPath, receipt.archive.path].map(filename => committedProducer + ':' + path.relative(repo, filename)).join('\n') + '\n' });
    parseBatch(committed, [{ bytes: receiptRaw.length, sha256: frozenReceiptSha }, { bytes: receipt.archive.size, sha256: receipt.archive.sha256 }]);
    const { materializeBindings } = await import('./bindings.mjs');
    await materializeBindings({ own, parent, output, composition, receipt, committedProducer, frozenReceiptSha, write, staticInventory }); return;
  }
  const baselineRaw = read(composition.baseSourceManifest.path); assert.equal(hash(baselineRaw), composition.baseSourceManifest.sha256); const selection = validateComposition(composition, JSON.parse(baselineRaw));
  const beforeTools = toolsSnapshot(); write.json(path.join(output, 'TOOL-ADMISSION.json'), beforeTools);
  const batch = await owner.run('source-blobs', composition.tools.git.path, ['cat-file', '--batch'], { cwd: repo, input: composition.sources.map(row => row.blob).join('\n') + '\n' });
  const blobs = parseBatch(batch, composition.sources), sourceRoot = path.join(output, 'source');
  for (let index = 0; index < composition.sources.length; index++) { const row = composition.sources[index]; write.bytes(path.join(sourceRoot, row.path), blobs[index], Number.parseInt(row.mode, 8) & 511); }
  const beforeSource = inventory(sourceRoot); assert.equal(beforeSource.rows.length, 305); write.json(path.join(output, 'SOURCE-ADMISSION.json'), { selection, composition: composition.derivedTree, rows: beforeSource.rows });
  assert.equal(JSON.parse(read(path.join(sourceRoot, 'tsconfig.json'))).compilerOptions.strict, true);
  await owner.run('strict-build', seal.commands.compiler.executable, seal.commands.compiler.args, { cwd: sourceRoot });
  for (const row of composition.sources) verify(row, path.join(sourceRoot, row.path));
  const compiled = inventory(sourceRoot), baselineCompiledRaw = read(composition.compiledManifest.path); assert.equal(hash(baselineCompiledRaw), composition.compiledManifest.sha256);
  const emit = fullEmitDelta(JSON.parse(baselineCompiledRaw).rows, compiled.rows);
  write.json(path.join(output, 'FULL-EMIT-DIFF.json'), { baseline: composition.baseDerivedTree, composition: composition.derivedTree, rows: emit, counts: Object.fromEntries(['unchanged', 'changed', 'added', 'removed'].map(status => [status, emit.filter(row => row.status === status).length])), sourceMapsAndDeclarationsExplicit: true });
  const failed = JSON.parse(read(path.join(parent, 'author-v2/FAILED-EMIT-DIFF.json')));
  const allowed = new Set(composition.sources.filter(row => row.revision === SOURCE_COMMIT).flatMap(row => { const stem = row.path.replace(/^src\//, 'dist/').replace(/\.ts$/, ''); return [stem + '.js', stem + '.js.map', stem + '.d.ts', stem + '.d.ts.map']; }));
  const foreign = emit.filter(row => row.status !== 'unchanged' && !allowed.has(row.path));
  const causes = [...new Set([...failed.rows.filter(row => row.status !== 'unchanged').map(row => row.path), ...emit.filter(row => row.status !== 'unchanged').map(row => row.path)])].sort().map(filename => { const current = emit.find(row => row.path === filename), old = failed.rows.find(row => row.path === filename); return { path: filename, failedStatus: old?.status ?? null, qualifiedStatus: current?.status ?? null, kind: current?.kind ?? null, sourceCause: allowed.has(filename) ? 'Exact accepted owner.ts/root.ts overlay emission; source/maps/declarations enumerated individually' : current?.status === 'unchanged' ? 'Disappears with corrected pinned Node-type resolution; corresponding product source unchanged' : 'UNEXPECTED_FOREIGN_EMIT_CHANGE', failedAfter: old?.after ?? null, qualifiedAfter: current?.after ?? null, baseline: current?.before ?? null }; });
  write.json(path.join(output, 'EMIT-CAUSES.json'), { compilerExit: 0, failedCompilerExit: 2, priorFailureCommit: '58ba544b0c702ff47ff7b623f05afb1229ffe3ca', failedChangedPaths: failed.counts.changed, qualifiedChangedPaths: emit.filter(row => row.status !== 'unchanged').length, foreign, rows: causes });
  assert.equal(foreign.length, 0, 'UNEXPECTED_FOREIGN_EMIT_CHANGE: package blocked');
  write.json(path.join(output, 'COMPILED-INVENTORY.json'), compiled);
  const shipping = compiled.rows.filter(row => row.path === 'README.md' || row.path === 'package.json' || row.path.startsWith('dist/'));
  const closure = staticInventory(shipping, sourceRoot); write.json(path.join(output, 'SHIPPING.json'), { rows: shipping, count: shipping.length, ...closure });
  const packed = JSON.parse((await owner.run('offline-pack', seal.commands.pack.executable, seal.commands.pack.args, { cwd: sourceRoot })).toString()); assert.equal(packed.length, 1); assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const archivePath = path.join(output, 'package', packed[0].filename); const archive = digest(archivePath); assert(archive.size <= DATA_MAX);
  for (const row of compiled.rows) verify(row, path.join(sourceRoot, row.path));
  const afterTools = toolsSnapshot(); write.json(path.join(output, 'TOOL-POSTGUARD.json'), afterTools);
  fs.chmodSync(archivePath, 0o444); archive.mode = 0o444;
  const receipt = { schema: 'CORE_ROOT_AUTHOR_PRODUCER_V3_FROZEN_BEFORE_DECODE', at: new Date().toISOString(), authorization, rootDecisionSha256, presealSha256: expectedSeal, composition: composition.derivedTree, sourceCommit: SOURCE_COMMIT, sourcePureReview: SOURCE_REVIEW, selection, typeTools: digest(path.join(own, 'TYPE-TOOLS.json')), emitCauses: digest(path.join(output, 'EMIT-CAUSES.json')), compilerInvocations: 1, packInvocations: 1, archive, compiledInventory: digest(path.join(output, 'COMPILED-INVENTORY.json')), emitDiff: digest(path.join(output, 'FULL-EMIT-DIFF.json')), shipping: digest(path.join(output, 'SHIPPING.json')), shippingMembers: shipping.length, privateAssetCount: closure.privateAssetCount, literalStaticEdgeCount: closure.literalStaticEdgeCount, receipts: owner.receipts, decodeInvocations: 0, product: 0, Workers: 0, resource: write.snapshot(), independentActualAudit: 'REQUIRED' };
  const receiptRow = write.json(path.join(output, 'PRE-INFLATE-RECEIPT.json'), receipt, 0o444);
  write.json(path.join(output, 'FROZEN.json'), { archive, receipt: receiptRow, firstDecodeForbiddenUntilBothCommitted: true }, 0o444);
  console.log(JSON.stringify({ phase: 'FROZEN_COMMIT_REQUIRED_BEFORE_DECODE', archive, receipt: receiptRow, shippingMembers: shipping.length, privateAssets: closure.privateAssetCount, staticEdges: closure.literalStaticEdgeCount, emitCounts: Object.fromEntries(['unchanged', 'changed', 'added', 'removed'].map(status => [status, emit.filter(row => row.status === status).length])) }));
}

try { await main(); } catch (reason) {
  const filename = path.join(own, 'STOP-' + mode + '.json');
  if (!fs.existsSync(filename)) write.json(filename, { at: new Date().toISOString(), mode, reason: String(reason), stack: reason?.stack, compilerMayHaveRun: mode === 'build', noAutomaticRetry: true, product: 0, Workers: 0 });
  console.error(reason); process.exitCode = 1;
}
