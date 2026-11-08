import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { directory, loadInputs, regular, requireValue, hash, json, canonical, nativeRequest, validateReceipt, compare, snapshot, admitGrant } from './harness.mjs';
export function materializePackage(destination) {
  const { bindings } = loadInputs();
  const encoded = regular(bindings.package.path, { sha256: bindings.package.encodedSha256, bytes: bindings.package.encodedBytes });
  const archive = Buffer.from(encoded.toString().trim(), 'base64'); requireValue(hash(archive) === bindings.package.sha256, 'PACKAGE_HASH');
  const tar = gunzipSync(archive, { maxOutputLength: 16777216 });
  const expected = new Map(json('PACKAGE-MEMBERS.json').map(row => [row.path, row]));
  let offset = 0; let count = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString().split(String.fromCharCode(0))[0];
    const name = field(0, 100), size = parseInt(field(124, 12).trim(), 8), kind = field(156, 1);
    requireValue(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length && ['0', '', '5'].includes(kind), 'TAR_STRUCTURE');
    if (kind !== '5') {
      requireValue(name.startsWith('package/'), 'TAR_PREFIX'); const relative = name.slice(8);
      requireValue(!relative.split('/').some(part => ['', '.', '..'].includes(part)), 'TAR_PATH');
      const member = expected.get(relative), bytes = tar.subarray(offset + 512, offset + 512 + size);
      requireValue(member && member.bytes === size && hash(bytes) === member.sha256, 'TAR_MEMBER');
      const filename = path.join(destination, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: member.mode }); expected.delete(relative); count++;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  requireValue(count === 950 && expected.size === 0, 'FULL950');
}
function setupCase(caseRoot, fixtures, qualification) {
  fs.mkdirSync(caseRoot, { mode: 448 });
  for (const name of ['work', 'home', 'tmp', 'empty-path']) fs.mkdirSync(path.join(caseRoot, name), { mode: 448 });
  for (const [name, text] of Object.entries(fixtures)) fs.writeFileSync(path.join(caseRoot, 'work', name), Buffer.from(text), { flag: 'wx', mode: 384 });
  if (qualification) {
    fs.mkdirSync(path.join(caseRoot, 'forbidden'), { mode: 448 });
    fs.writeFileSync(path.join(caseRoot, 'work/input'), qualification.input, { flag: 'wx', mode: 384 });
    fs.writeFileSync(path.join(caseRoot, 'forbidden/read-sentinel'), qualification.forbiddenRead, { flag: 'wx', mode: 384 });
    fs.writeFileSync(path.join(caseRoot, 'forbidden/write-sentinel'), qualification.forbiddenWrite, { flag: 'wx', mode: 384 });
    fs.symlinkSync(qualification.symlinkTarget, path.join(caseRoot, 'work/blocked-link'));
  }
}
export async function execute(phase, grantFile, root) {
  const output = path.join(root, 'OUTER.jsonl'); fs.writeFileSync(output, JSON.stringify({ event: 'RAW_START', at: Date.now(), phase }) + '\n', { flag: 'wx', mode: 384 });
  const publish = row => fs.appendFileSync(output, JSON.stringify(row) + '\n');
  let provider; const observations = [];
  try {
    const sealRaw = fs.readFileSync(path.join(directory, 'PRESEAL.json')), seal = JSON.parse(sealRaw);
    for (const row of seal.files) regular(path.join(directory, row.path), row);
    const grant = JSON.parse(fs.readFileSync(grantFile));
    const inputs = admitGrant(grant, phase, hash(sealRaw), Date.now());
    requireValue(root === inputs.protocol.phases[phase].root, 'EXACT_ROOT');
    const providerManifestBytes = regular(grant.provider.fullClosureManifest.path, grant.provider.fullClosureManifest);
    const providerManifest = JSON.parse(providerManifestBytes);
    for (const row of providerManifest.files) regular(row.path, row);
    requireValue(providerManifest.files.some(row => row.path === grant.provider.modulePath && row.sha256 === grant.provider.moduleSha256), 'PROVIDER_ENTRY_BINDING');
    regular(grant.oracle.path, grant.oracle);
    provider = await import(pathToFileURL(grant.provider.modulePath).href);
    requireValue(typeof provider.begin === 'function' && typeof provider.run === 'function' && typeof provider.close === 'function', 'PROVIDER_INTERFACE');
    await provider.begin({ grant, root, capture: output });
    const bounds = inputs.protocol.phases[phase], rows = phase === 'qualification' ? inputs.qualification.cases : inputs.cases.cases;
    const productRoot = path.join(root, 'package');
    if (phase === 'semantics') materializePackage(productRoot);
    for (const row of rows) {
      const caseRoot = path.join(root, row.id); setupCase(caseRoot, phase === 'semantics' ? inputs.cases.fixtures : {}, phase === 'qualification' ? inputs.qualification.fixture : null);
      const request = nativeRequest({ ...row, stdin: row.stdin ?? inputs.cases.defaultStdin }, caseRoot, grant.oracle, bounds);
      publish({ event: 'REQUEST_ENROLLED', request });
      const receipt = validateReceipt(await provider.run(request), request);
      const native = { ...receipt, files: snapshot(caseRoot) };
      fs.writeFileSync(path.join(root, row.id + '.native.json'), JSON.stringify(native) + '\n', { flag: 'wx' });
      if (phase === 'qualification') { observations.push({ id: row.id, predicate: row.predicate, native, disposition: 'OBSERVATION_REQUIRES_ROOT_REVIEW_NOT_AUTOMATIC_QUALIFICATION' }); continue; }
      const configPath = path.join(root, row.id + '.virtual.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ id: row.id, phase, rootQualifiedExecution: true, productRoot }) + '\n', { flag: 'wx' });
      const files = {};
      for (const member of json('PACKAGE-MEMBERS.json')) if (member.path.endsWith('.js')) files[path.join(productRoot, member.path)] = { sha256: member.sha256, role: 'product' };
      for (const name of ['virtual-case.mjs', 'harness.mjs']) files[path.join(directory, name)] = { sha256: hash(fs.readFileSync(path.join(directory, name))), role: 'harness' };
      const admissionPath = path.join(root, row.id + '.admission.json'); fs.writeFileSync(admissionPath, JSON.stringify({ files }) + '\n', { flag: 'wx' });
      const virtualRequest = { role: 'virtual', id: row.id, executable: inputs.protocol.node, argv: ['--import', path.join(directory, 'virtual-guard.mjs'), path.join(directory, 'virtual-case.mjs'), '--config', configPath], environment: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: path.join(caseRoot, 'home'), TMPDIR: path.join(caseRoot, 'tmp'), PATH: path.join(caseRoot, 'empty-path'), SURFACE_ADMISSION: admissionPath, SURFACE_LOAD_LOG: path.join(root, row.id + '.loads.jsonl') }, cwd: path.join(caseRoot, 'work'), stdinBase64: '', bounds, filesystemRoot: caseRoot, workersAllowed: 0, networkAllowed: false, externalExecAllowed: [] };
      publish({ event: 'REQUEST_ENROLLED', request: virtualRequest });
      const virtualReceipt = validateReceipt(await provider.run(virtualRequest), virtualRequest);
      requireValue(virtualReceipt.status === 0 && virtualReceipt.workerStarts === 0, 'VIRTUAL_DRIVER_OR_WORKER_STOP');
      const virtual = JSON.parse(Buffer.from(virtualReceipt.stdoutBase64, 'base64'));
      requireValue(virtual.id === row.id && virtual.disposed && !virtual.cleanupError && !virtual.callerAborted, 'VIRTUAL_CLEANUP_STOP');
      const result = compare(native, virtual); observations.push(result);
      fs.writeFileSync(path.join(root, row.id + '.comparison.json'), JSON.stringify(result) + '\n', { flag: 'wx' });
    }
    publish({ event: 'FINISHED', role: phase === 'qualification' ? 'OBSERVATIONS_NOT_AUTOMATIC_QUALIFICATION' : 'EXACT_DIFFERENTIAL', completed: observations.length });
  } catch (error) { publish({ event: 'HOLD_OR_STOP', message: String(error), completed: observations.length }); throw error; }
  finally { if (provider) { const receipt = await provider.close(); publish({ event: 'PROVIDER_CLOSE', receipt }); requireValue(receipt.retirement === 'COMPLETE' && receipt.unknownProcesses === 0, 'UNKNOWN_PROVIDER_RETIREMENT'); } }
  fs.writeFileSync(path.join(root, 'OBSERVATIONS.json'), JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  requireValue(process.argv.length === 6 && process.argv[2] === '--phase' && process.argv[4] === '--grant', 'EXACT_ARGUMENTS');
  const phase = process.argv[3]; requireValue(['qualification', 'semantics'].includes(phase), 'PHASE');
  const root = '/private/tmp/safe-bash-surface-' + phase + '-20260829-01';
  const expectedGrant = path.join(directory, phase === 'qualification' ? 'QUALIFICATION-GO.json' : 'SEMANTICS-GO.json');
  requireValue(process.argv[5] === expectedGrant, 'EXACT_GRANT_PATH');
  fs.mkdirSync(root, { mode: 448 });
  await execute(phase, expectedGrant, root);
}
