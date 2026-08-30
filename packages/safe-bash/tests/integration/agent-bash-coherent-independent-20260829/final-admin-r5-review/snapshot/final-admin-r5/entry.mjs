import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const initialPID = process.pid, initialUTC = new Date().toISOString(), initialClock = performance.now();
function read(entry, maximum = 131072) {
  assert(entry && typeof entry.path === 'string' && path.isAbsolute(entry.path) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= maximum && /^[a-f0-9]{64}$/.test(entry.sha256));
  const stat = fs.lstatSync(entry.path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.bytes);
  const bytes = fs.readFileSync(entry.path); assert.equal(bytes.length, entry.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256); return bytes;
}
function producerJSON(filename, maximum) {
  const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  return { identity: { path: filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, value: JSON.parse(bytes) };
}
let owner, packet;
try {
  const [filename, digest, size, authorization] = process.argv.slice(2); assert.equal(process.argv.length, 6);
  assert.equal(process.env.B1_ADMIN_ROOT_GO, 'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION');
  assert(typeof authorization === 'string' && authorization.trim() && authorization.length <= 4096);
  packet = JSON.parse(read({ path: filename, bytes: Number(size), sha256: digest }));
  assert.equal(packet.schema, 'B1-final-admin-r5'); assert.equal(packet.maxKnownOS, 36);
  const started = Date.parse(initialUTC); assert(started >= Date.parse(packet.issuedUTC) && started <= Date.parse(packet.latestStartUTC) && started + 1800000 <= Date.parse(packet.expiresUTC));
  for (const entry of [...packet.adminFiles, ...packet.preimportFiles, ...packet.publisherFiles]) read(entry);
  assert.equal(packet.adminOwner.path, process.argv[1]); read(packet.adminOwner);
  const { Owner, identity } = await import(pathToFileURL(packet.ownerKernel.path).href);
  for (const tool of packet.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool);
  for (const filename of packet.absentSlots) assert.equal(fs.existsSync(filename), false, 'FRESH_OUTPUT_REQUIRED');
  fs.mkdirSync(packet.adminRoot); fs.mkdirSync(packet.captureRoot); fs.mkdirSync(packet.metadataHome);
  owner = new Owner({ raw: packet.captureRoot, cwd: packet.repo, env: { PATH: '/usr/bin:/bin', HOME: packet.metadataHome, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', B1_ROOT_GO: 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION' }, tools: packet.tools, wallMs: 1800000 - (performance.now() - initialClock), reserveMs: 180000, cleanupMs: 5000, maxStarts: 36, peak: 3, captureLimit: 67108864, metadataLimit: 8388608, tailBytes: 1048576 });
  owner.self = Object.freeze({ ...owner.self, pid: initialPID, startUTC: initialUTC });
  owner.persist(packet.slots.startReceipt, { self: owner.self, observation: 'Own process PID/start only; exit pending external observation.' });
  const grant = { action: 'ROOT_B1_PUBLIC15_ACTUAL', authorization, finalPacketSha256: digest, startedUTC: initialUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, metadataHome: packet.metadataHome };
  const rootGrant = owner.persist(packet.slots.rootGrantFile, grant);
  read(packet.runtimePreseal, 1048576); read(packet.publisherBinding); read(packet.publisherPreseal);
  const runtime = await owner.run('runtime-coordinator', packet.runtimeCommand.executable, packet.runtimeCommand.argv, 1620000);
  assert.equal(runtime.faults.primaryPresent, false, 'RUNTIME_CAPTURE_OR_RETIREMENT');
  const eventFile = path.join(packet.runtimeRoot, 'capture/events.jsonl');
  const stat = fs.lstatSync(eventFile); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4194304);
  const bytes = fs.readFileSync(eventFile); assert.equal(bytes.length, stat.size);
  const events = bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const children = events.filter(event => event.spawned === true), roles = new Set(), pids = new Set(owner.rows.map(row => row.pid));
  for (const child of children) {
    assert(packet.runtimeRoles.includes(child.role) && !roles.has(child.role) && Number.isSafeInteger(child.pid) && child.pid > 0 && !pids.has(child.pid)); roles.add(child.role); pids.add(child.pid);
    const exit = events.find(event => event.role === child.role && event.pid === child.pid && event.event === 'exit');
    const close = events.find(event => event.role === child.role && event.pid === child.pid && event.event === 'close');
    const retirement = events.find(event => event.role === child.role && event.pid === child.pid && Object.hasOwn(event, 'unknown'));
    assert(exit && close && retirement && retirement.exited && retirement.closed && retirement.unknown === false, 'RUNTIME_CHILD_RETIREMENT_UNKNOWN');
    owner.rows.push({ id: `runtime-child-${child.pid}`, role: child.role, pid: child.pid, startUTC: new Date(Date.parse(runtime.row.startUTC) + child.elapsedMs).toISOString(), startObserved: true, exitObserved: true, closeObserved: true, stdoutEnd: null, stderrEnd: null, qualification: 'Runtime events report exit/close. Stream EOF not separately observed. Start wallclock derived from recorded elapsed time.', exitCode: exit.status, closeCode: close.status });
  }
  owner.terminal = true;
  packet.preimportCommand.argv = [packet.preimportEntry.path, filename, digest, String(size)];
  const { publicationSequence } = await import(pathToFileURL(packet.dispatch.path).href);
  const result = await publicationSequence(owner, packet, grant, { authorization, rootGrant });
  assert.equal(result.publication.faults.primaryPresent, false, 'PUBLISHER_CAPTURE_OR_RETIREMENT');
  const published = producerJSON(path.join(packet.publicationRoot, 'FINAL.json'), 1048576);
  assert.equal(published.value.knownChildRetirement, 'OBSERVED_FOR_RECORDED_CHILDREN_ONLY');
  for (const child of published.value.terminal.children) {
    assert(child.pid && child.exitObserved && child.closeObserved && !owner.rows.some(row => row.pid === child.pid));
    owner.rows.push({ id: `publisher-child-${child.pid}`, role: child.role, pid: child.pid, startUTC: child.startedUTC, startObserved: true, exitObserved: true, closeObserved: true, stdoutEnd: null, stderrEnd: null, qualification: 'Publisher exit/close records; no inferred stream EOF.' });
  }
  assert.equal(published.value.knownStartsThroughReceipt, owner.snapshot().knownStarts);
  owner.persist(packet.slots.finalReceipt, { outcome: 'REPORTED_NOT_COHERENT_ACCEPTANCE', runtimeStatus: runtime.row.exitCode, publisherStatus: result.publication.row.exitCode, published: published.identity, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', qualification: 'Direct tool return may externally qualify owner exit, not self-certified full census.' });
  process.exitCode = result.publication.row.exitCode;
} catch (reason) {
  if (owner) { owner.terminal = true; try { owner.persist(packet.slots.failureReceipt, { primaryPresent: true, primary: { type: reason === null ? 'null' : typeof reason, value: ['string', 'number', 'boolean'].includes(typeof reason) ? reason : undefined }, detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', result: 'UNKNOWN_OR_STOP_NO_RETRY' }); } catch {} }
  fs.writeSync(2, JSON.stringify({ status: 'STOP', primaryPresent: true, primaryType: reason === null ? 'null' : typeof reason, message: reason instanceof Error ? reason.message.slice(0, 512) : undefined }) + '\n'); process.exitCode = 78;
}
