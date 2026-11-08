import * as fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { DATA_MAX, DEADLINE, read, hash, digest, verify, inventory } from './io.mjs';
import { recomputeLogicalBound } from '../recipe.mjs';

export async function materializeBindings({ own, parent, output, composition, receipt, committedProducer, frozenReceiptSha, write, staticInventory }) {
  assert(Date.now() + 180000 < DEADLINE, 'DATA materialization plus publication admission');
  const archiveBuffer = read(receipt.archive.path);
  assert.equal(archiveBuffer.length, receipt.archive.size); assert.equal(hash(archiveBuffer), receipt.archive.sha256);
  const decoded = gunzipSync(archiveBuffer, { maxOutputLength: DATA_MAX });
  const members = new Map(); let offset = 0;
  const text = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
  while (offset + 512 <= decoded.length) {
    const header = decoded.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const declaredChecksum = Number.parseInt(text(header.subarray(148, 156)).trim(), 8);
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(checksum, declaredChecksum);
    const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100)), full = prefix ? prefix + '/' + name : name;
    assert(full.startsWith('package/') && !full.split('/').includes('..') && !full.includes('\\'));
    assert(header[156] === 0 || header[156] === 48, 'only regular package members');
    const size = Number.parseInt(text(header.subarray(124, 136)).trim(), 8), mode = Number.parseInt(text(header.subarray(100, 108)).trim(), 8) & 511;
    assert(Number.isSafeInteger(size) && size >= 0 && size <= DATA_MAX);
    const bytes = decoded.subarray(offset + 512, offset + 512 + size); assert.equal(bytes.length, size);
    const relative = full.slice(8); assert(relative && !members.has(relative)); members.set(relative, { bytes, mode, size, sha256: hash(bytes) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(offset + 1024 <= decoded.length && decoded.subarray(offset).every(byte => byte === 0));
  verify(receipt.shipping); verify(receipt.compiledInventory); verify(receipt.emitDiff);
  const shipping = JSON.parse(read(receipt.shipping.path)), compiled = JSON.parse(read(receipt.compiledInventory.path));
  assert.equal(members.size, shipping.rows.length);
  for (const row of shipping.rows) { const member = members.get(row.path); assert(member); assert.equal(member.size, row.size); assert.equal(member.sha256, row.sha256); }
  write.json(path.join(output, 'DECODE-RECEIPT.json'), { at: new Date().toISOString(), committedProducer, frozenReceiptSha, archiveSha256: hash(archiveBuffer), sameAuthenticatedBufferDecoded: true, compressedBytes: archiveBuffer.length, decodedBytes: decoded.length, regularMembers: members.size, memberBytes: [...members.values()].reduce((sum, row) => sum + row.size, 0), productImported: false });
  const author = path.resolve(parent, '../bash-ere-runtime-integration-author-20260829/runtime-preflight-v1');
  const oldSealRaw = read(path.join(author, 'v4/EXECUTION-SEAL.json')); assert.equal(hash(oldSealRaw), composition.writer.recipe.frozenExecutionSealSha256);
  const oldSeal = JSON.parse(oldSealRaw);
  const definitionBytes = read(composition.writer.recipe.definitions.path); assert.equal(hash(definitionBytes), composition.writer.recipe.definitions.sha256);
  const definitions = JSON.parse(definitionBytes);
  for (const row of composition.writer.files) verify(row);
  const controller = path.join(output, 'controller'); fs.mkdirSync(controller);
  const oldOwner = oldSeal.controller.find(row => row.path.endsWith('/owner.mjs')); verify(oldOwner);
  const replaceOnce = (source, before, after) => { assert.equal(source.split(before).length, 2, 'exact versioned source anchor'); return source.replace(before, after); };
  const layoutRoot = path.join(output, 'layouts'); fs.mkdirSync(layoutRoot);
  let ownerSource = read(oldOwner.path).toString();
  ownerSource = replaceOnce(ownerSource, "path.startsWith('/private/tmp/')", 'path.startsWith(' + JSON.stringify(layoutRoot + '/') + ')');
  write.bytes(path.join(controller, 'owner.mjs'), Buffer.from(ownerSource));
  const guardBytes = read(path.join(parent, 'core-guard-v8.mjs')); write.bytes(path.join(controller, 'core-guard-v8.mjs'), guardBytes);
  const v7Dispatch = composition.writer.files.find(row => row.path.endsWith('/dispatch.mjs'));
  let dispatcher = read(v7Dispatch.path).toString();
  dispatcher = replaceOnce(dispatcher, "import { ownProcess } from './owner.mjs';", "import { ownProcess } from './owner.mjs';\nimport { createCoreClock } from './core-guard-v8.mjs';");
  dispatcher = replaceOnce(dispatcher, 'const [sealPath, expectedSeal, grantPath, expectedGrant, collector] = process.argv.slice(2);', "const [sealPath, expectedSeal, grantPath, expectedGrant, collector, outerStartedMilliseconds] = process.argv.slice(2);\nconst monotonicNow = () => Number(process.hrtime.bigint() / 1000000n);\nconst outerStarted = Number(outerStartedMilliseconds);\nif (!Number.isSafeInteger(outerStarted) || outerStarted < 0 || outerStarted > monotonicNow()) throw new Error('outer monotonic start binding');\nconst clock = createCoreClock({ started: outerStarted, now: monotonicNow });");
  dispatcher = replaceOnce(dispatcher, "grant.action !== 'execute-core70-v7'", "grant.action !== 'execute-core70-v8'");
  dispatcher = replaceOnce(dispatcher, 'seal.futureCaps.totalMilliseconds !== 7500000', 'seal.futureCaps.totalMilliseconds !== 1800000');
  dispatcher = replaceOnce(dispatcher, 'const deadline = started + seal.futureCaps.totalMilliseconds;', 'const deadline = Date.now() + Math.max(0, clock.remaining() - 180000);');
  dispatcher = replaceOnce(dispatcher, 'const outcomes = []; let workers = 0;', "const outcomes = []; let workers = 0;\nconst remainingUnrun = () => { const seen = new Set(outcomes.map(row => row.id)); for (const cell of seal.layouts.flatMap(layout => layout.cells)) if (!seen.has(cell.id)) outcomes.push({ id: cell.id, status: 'UNRUN', reason: 'case+cleanup+180s-publication-do-not-fit' }); };");
  dispatcher = replaceOnce(dispatcher, 'for (const layout of seal.layouts) {', 'layoutLoop: for (const layout of seal.layouts) {');
  dispatcher = replaceOnce(dispatcher, '    verify(); const receipt = await ownProcess(cell, state, emit);', "    const reserve = { requiredCaseMilliseconds: cell.caseMs, cleanupMilliseconds: cell.retireMs };\n    if (!clock.admit(reserve).admitted) { remainingUnrun(); break layoutLoop; }\n    verify();\n    if (!clock.admit(reserve).admitted) { remainingUnrun(); break layoutLoop; }\n    const receipt = await ownProcess(cell, state, emit);");
  dispatcher = replaceOnce(dispatcher, "if (Date.now() >= deadline) throw new Error('final publication deadline');", 'clock.assertBeforeDeadline();');
  dispatcher = replaceOnce(dispatcher, "if (Date.now() >= deadline) throw new Error('publication exceeded deadline');", 'clock.assertBeforeDeadline();');
  dispatcher = replaceOnce(dispatcher, "process.exitCode = outcomes.some(row => row.status === 'FAIL') ? 1 : 0;", "process.exitCode = outcomes.some(row => row.status === 'UNRUN') ? 2 : outcomes.some(row => row.status === 'FAIL') ? 1 : 0;");
  write.bytes(path.join(controller, 'dispatch.mjs'), Buffer.from(dispatcher));
  const layouts = [];
  for (const old of oldSeal.layouts) {
    verify(old.manifest); const oldManifest = JSON.parse(read(old.manifest.path));
    const layoutDirectory = path.join(layoutRoot, old.name); fs.mkdirSync(layoutDirectory);
    const app = path.join(layoutDirectory, 'app'), staging = old.name === 'moved' ? path.join(layoutDirectory, 'staging-app') : app; fs.mkdirSync(staging);
    const packageRelative = path.relative(old.app, old.packageRoot);
    const pendingCells = [];
    for (const row of oldManifest.rows) {
      const original = path.join(old.app, row.path); verify(row, original);
      if (row.path === packageRelative || row.path.startsWith(packageRelative + '/')) continue;
      if (row.path.startsWith('cells/') && row.path.endsWith('.json')) { pendingCells.push({ row, bytes: read(original) }); continue; }
      if (row.path === 'harness/cell.mjs') continue;
      write.bytes(path.join(staging, row.path), read(original), row.mode);
    }
    const productRows = old.name === 'source-built' ? compiled.rows : shipping.rows;
    for (const row of productRows) {
      const bytes = old.name === 'source-built' ? read(path.join(output, 'source', row.path)) : members.get(row.path).bytes;
      assert.equal(hash(bytes), row.sha256);
      write.bytes(path.join(staging, packageRelative, row.path), bytes, row.mode);
    }
    for (const name of ['cell.mjs', 'event-writer.mjs', 'finalize-cell.mjs']) {
      const row = composition.writer.files.find(value => value.path.endsWith('/' + name)); assert(row);
      write.bytes(path.join(staging, 'harness', name), read(row.path), row.mode);
    }
    for (const directory of oldManifest.directories) fs.mkdirSync(path.join(staging, directory), { recursive: true });
    if (staging !== app) fs.renameSync(staging, app);
    const replacePaths = value => {
      if (typeof value === 'string') return value.replaceAll(old.app, app);
      if (Array.isArray(value)) return value.map(replacePaths);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replacePaths(entry)]));
      return value;
    };
    const refresh = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const entry of value) refresh(entry); return; }
      for (const entry of Object.values(value)) refresh(entry);
      if (typeof value.path === 'string' && value.path.startsWith(app + '/') && typeof value.sha256 === 'string' && typeof value.size === 'number') { const row = digest(value.path); value.size = row.size; value.sha256 = row.sha256; value.mode = row.mode; }
    };
    for (const pending of pendingCells) {
      const before = JSON.parse(pending.bytes), next = replacePaths(before);
      assert.equal(JSON.stringify(next.definition), JSON.stringify(before.definition)); refresh(next);
      write.json(path.join(app, pending.row.path), next, pending.row.mode);
    }
    assert.equal(pendingCells.length, 70);
    const manifest = inventory(app), manifestPath = path.join(layoutDirectory, 'LAYOUT.json'); const manifestRow = write.json(manifestPath, manifest);
    const next = replacePaths(old); next.manifest = manifestRow; next.packageMembers = productRows.length; next.privateAssets = shipping.privateAssetCount; refresh(next.wrapperRoles);
    next.physicalMove = { performed: staging !== app, from: staging, to: app };
    layouts.push(next);
  }
  const definitionRow = write.bytes(path.join(output, 'CASES-v4.json'), definitionBytes);
  const newLayoutBytes = layouts.reduce((sum, layout) => sum + JSON.parse(read(layout.manifest.path)).bytes, 0);
  const logicalBound = recomputeLogicalBound({ freshLayoutBytes: newLayoutBytes, archiveBytes: receipt.archive.size });
  const controlRows = inventory(controller).rows.map(row => ({ ...row, path: path.join(controller, row.path) }));
  const newSeal = { ...oldSeal, status: 'DATA_REBOUND_NOT_RUNTIME_ACCEPTED', sourceTree: composition.derivedTree, sourceInputs: composition.sources, archive: receipt.archive, node: composition.tools.node, layouts, controller: controlRows, definitions: definitionRow, futureCaps: { ...oldSeal.futureCaps, totalMilliseconds: 1800000, publicationMilliseconds: 180000, totalKnownOSMaximum: 242, peakOS: 4, knownAdministrativeAllowance: 30, workerStartsMaximum: 309, workerLiveMaximum: 1, captureBytes: 134217728, workingBytes: 536870912 }, producerCommit: committedProducer, producerReceiptSha256: frozenReceiptSha, sourcePureAcceptance: 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf', actualPrivateT1: 'PENDING', writerAcceptance: composition.writer.acceptance, logicalBound, actualRuntimeAuthority: false, authorityRequired: 'fresh ROOT CORE grant plus independent actual producer/binding review; actual private T1 pending', outerStartContract: 'sixth dispatcher argument is trusted outer-owner process.hrtime.bigint milliseconds captured before all runtime admission; never reset per layout/case' };
  assert.equal(layouts.flatMap(layout => layout.cells).length, 210);
  const sealRow = write.json(path.join(output, 'CORE-GUARD-PRESEAL.json'), newSeal, 0o444);
  for (const layout of layouts) { const saved = JSON.parse(read(layout.manifest.path)); const actual = inventory(layout.app); assert.equal(hash(Buffer.from(JSON.stringify(saved))), hash(Buffer.from(JSON.stringify(actual)))); }
  const final = { at: new Date().toISOString(), producerCommit: committedProducer, producerReceiptSha256: frozenReceiptSha, archiveSha256: receipt.archive.sha256, shippingMembers: members.size, privateAssets: shipping.privateAssetCount, literalStaticEdges: shipping.literalStaticEdgeCount, definitionsSha256: definitionRow.sha256, definitionCount: composition.writer.recipe.definitions.count, layoutCells: 210, layouts: layouts.map(layout => ({ name: layout.name, app: layout.app, manifest: layout.manifest, packageMembers: layout.packageMembers, privateAssets: layout.privateAssets, physicalMove: layout.physicalMove })), guardPreseal: sealRow, logicalBound, resource: write.snapshot(), product: 0, Workers: 0, Shell: 0, installation: 0, noRuntimeAcceptance: true };
  const finalRow = write.json(path.join(output, 'FINAL-BINDINGS.json'), final, 0o444);
  console.log(JSON.stringify({ phase: 'DATA_BINDINGS_COMPLETE', final: finalRow, guardPreseal: sealRow, archiveSha256: receipt.archive.sha256, members: members.size, privateAssets: shipping.privateAssetCount, staticEdges: shipping.literalStaticEdgeCount, layouts: final.layouts.map(layout => ({ name: layout.name, packageMembers: layout.packageMembers, privateAssets: layout.privateAssets })), logicalBound: logicalBound.logicalBytes, actualRetainedLogicalBytes: final.resource.fresh.bytes }));
}
