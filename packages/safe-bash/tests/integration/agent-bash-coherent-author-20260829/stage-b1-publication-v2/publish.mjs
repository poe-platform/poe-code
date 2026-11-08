import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Ledger, completeWrite, failures, resultProfile, relativeName, inventoryEqual, deadline } from './policy.mjs';

const scope = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-publication-v2';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const streamHash = async file => { const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('hex'); };
function admit(file, size, digest, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== size || size > maximum) throw Error(`Typed size admission ${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== size || hash(bytes) !== digest) throw Error(`Hash admission ${file}`);
  return bytes;
}
async function inventory(root, maximum, onEntry = () => {}) {
  const entries = [];
  let total = 0;
  async function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = relativeName(prefix ? `${prefix}/${name}` : name);
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (entries.length >= 20000) throw Error('Inventory entry cap');
      if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'link', target: fs.readlinkSync(file) });
      else if (stat.isDirectory()) { entries.push({ path: relative, type: 'directory' }); await visit(file, relative); }
      else if (stat.isFile()) {
        total += stat.size;
        if (total > maximum) throw Error('Inventory byte cap');
        const entry = { path: relative, type: 'file', bytes: stat.size, sha256: await streamHash(file) };
        entries.push(entry); onEntry(entry);
      } else throw Error('Unrecognized owned file type');
    }
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Owned root type');
  await visit(root);
  return { total, entries };
}
const state = failures();
let ledger;
let binding;
let auth;
let terminal = { schema: 'b1-publication-terminal-v2', outcome: 'UNKNOWN', result: { kind: 'UNREAD', reportedRows: null }, children: [], knownRetirement: 'UNKNOWN', coherentAcceptance: false };
let evidence;
let output;
let allowedEnd;
let gitAttempts = 0;
let unknownChild = false;
const check = () => { if (Date.now() >= allowedEnd) throw Error('Inclusive publication deadline'); };
function write(file, value, capture = true) {
  check();
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  ledger.charge(bytes.length, capture);
  const descriptor = fs.openSync(file, 'wx');
  try { completeWrite((buffer, offset, length) => fs.writeSync(descriptor, buffer, offset, length), bytes); }
  finally { fs.closeSync(descriptor); }
}
async function git(role, args) {
  check();
  if (++gitAttempts > 3) throw Error('Metadata role cap');
  const stdout = fs.openSync(path.join(output, `${role}.stdout`), 'wx');
  let stderr;
  try { stderr = fs.openSync(path.join(output, `${role}.stderr`), 'wx'); }
  catch (error) { fs.closeSync(stdout); throw error; }
  let child;
  let watchdog;
  let killTimer;
  let drainTimer;
  let localBytes = 0;
  const faults = failures();
  const record = { role, startedUTC: new Date().toISOString(), pid: null, exitObserved: false, closeObserved: false, signals: [], status: null, signal: null };
  const text = [];
  try {
    await new Promise((resolve, reject) => {
      const stop = reason => {
        faults.add(reason);
        if (child && !record.closeObserved && !killTimer) {
          record.signals.push({ signal: 'SIGTERM', sent: child.kill('SIGTERM') });
          killTimer = setTimeout(() => { if (!record.closeObserved) record.signals.push({ signal: 'SIGKILL', sent: child.kill('SIGKILL') }); }, 1000);
          drainTimer = setTimeout(() => { if (!record.closeObserved) { unknownChild = true; reject(Error('Known metadata child retirement UNKNOWN')); } }, 5000);
        }
      };
      child = spawn('/usr/bin/git', args, { cwd: binding.repo, env: { PATH: '/usr/bin:/bin', HOME: auth.metadataHome, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      watchdog = setTimeout(() => stop(Error('Metadata deadline')), Math.min(15000, Math.max(1, allowedEnd - Date.now() - 5000)));
      const capture = (descriptor, chunk, collect) => {
        try {
          localBytes += chunk.length;
          if (localBytes > 131072) throw Error('Metadata output cap');
          ledger.charge(chunk.length);
          completeWrite((buffer, offset, length) => fs.writeSync(descriptor, buffer, offset, length), chunk);
          if (collect) text.push(Buffer.from(chunk));
        } catch (error) { stop(error); }
      };
      child.stdout.on('data', chunk => capture(stdout, chunk, true));
      child.stderr.on('data', chunk => capture(stderr, chunk, false));
      child.on('error', stop);
      child.on('exit', (status, signal) => { record.exitObserved = true; record.status = status; record.signal = signal; });
      child.on('close', () => { record.closeObserved = true; resolve(); });
    });
    if (faults.primaryPresent || !record.exitObserved || !record.closeObserved || record.status !== 0 || record.signal !== null) throw Error(`Metadata ${role} failed; raw child record retained`);
    return Buffer.concat(text).toString().trim();
  } finally {
    clearTimeout(watchdog); clearTimeout(killTimer); clearTimeout(drainTimer);
    fs.closeSync(stdout); fs.closeSync(stderr);
    terminal.children.push({ ...record, faults: { primaryPresent: faults.primaryPresent, primary: faults.primary, secondary: faults.secondary }, finishedUTC: new Date().toISOString() });
  }
}
try {
  const [mode, bindingFile, bindingHash, bindingSize, authorityFile, authorityHash, authoritySize] = process.argv.slice(2);
  if (mode !== '--publish' || process.argv.length !== 9) throw Error('Explicit publication arguments required');
  binding = JSON.parse(admit(bindingFile, Number(bindingSize), bindingHash, 131072));
  auth = JSON.parse(admit(authorityFile, Number(authoritySize), authorityHash, 32768));
  if (auth.action !== 'ROOT_B1_PUBLIC15_ACTUAL' || auth.bindingSha256 !== bindingHash || !auth.authorization || !Number.isSafeInteger(auth.knownStartsBeforePublication) || auth.knownStartsBeforePublication < 7 || auth.knownStartsBeforePublication > 27) throw Error('Fresh root/count authority');
  allowedEnd = deadline(auth, Date.now());
  for (const entry of binding.files) admit(entry.path, entry.bytes, entry.sha256, 131072);
  evidence = binding.outputs.evidence;
  output = binding.outputs.publication;
  if (fs.existsSync(evidence) || fs.existsSync(output)) throw Error('Publication outputs must be absent');
  let runtimeCapture = 0;
  const before = await inventory(binding.outputs.work, 805306368, entry => {
    if (/(?:stdout|stderr|events|capture|supervisor|retirement|RESULT|STOP|\.jsonl?$)/i.test(entry.path) && !entry.path.includes('/node_modules/') && !entry.path.includes('/dist/') && !entry.path.includes('/engine/')) runtimeCapture += entry.bytes;
  });
  const closedCaptures = [];
  for (const file of binding.outputs.launchCaptures) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Launch capture type');
    closedCaptures.push({ path: file, bytes: stat.size, sha256: await streamHash(file) });
  }
  const outerBytes = closedCaptures.reduce((sum, item) => sum + item.bytes, 0);
  let startupBytes = 0;
  for (const file of binding.outputs.startupCaptures) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('Startup capture admission');
    startupBytes += stat.size;
  }
  ledger = new Ledger({ capture: runtimeCapture + outerBytes + Number(authoritySize) + startupBytes, work: before.total + outerBytes + Number(authoritySize) + startupBytes });
  ledger.charge(8192 - startupBytes);
  fs.mkdirSync(evidence); fs.mkdirSync(output);
  terminal.accountingRoots = binding.outputs;
  try {
    const runtimeSeal = JSON.parse(admit(binding.runtimePreseal.path, binding.runtimePreseal.bytes, binding.runtimePreseal.sha256, 32768));
    for (const entry of runtimeSeal.files) admit(entry.path, entry.bytes, entry.sha256, 8388608);
    const packageStat = fs.lstatSync(binding.package.path);
    if (!packageStat.isFile() || packageStat.size !== binding.package.bytes || await streamHash(binding.package.path) !== binding.package.sha256) throw Error('Package changed');
    write(path.join(evidence, 'WORK-INVENTORY.json'), before);
    const result = before.entries.find(entry => entry.path === 'RESULT.json' && entry.type === 'file');
    if (!result) terminal.result = resultProfile(undefined, false);
    else if (result.bytes > 2097152) terminal.result = { kind: 'OVERSIZE_RAW_RETAINED', complete: false, reportedRows: null };
    else terminal.result = resultProfile(admit(path.join(binding.outputs.work, result.path), result.bytes, result.sha256, 2097152));
    for (const entry of before.entries) {
      if (entry.type !== 'file' || entry.path.includes('/node_modules/') || entry.path.includes('/dist/') || entry.path.includes('/engine/')) continue;
      if (!/(?:stdout|stderr|events|capture|supervisor|retirement|RESULT|STOP)/i.test(entry.path)) continue;
      ledger.charge(entry.bytes);
      const destination = path.join(evidence, 'raw', relativeName(entry.path));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(binding.outputs.work, entry.path), destination, fs.constants.COPYFILE_EXCL);
      if (await streamHash(destination) !== entry.sha256) throw Error('Raw copy mismatch');
    }
    for (const entry of closedCaptures) {
      ledger.charge(entry.bytes);
      fs.copyFileSync(entry.path, path.join(evidence, path.basename(entry.path)), fs.constants.COPYFILE_EXCL);
    }
    inventoryEqual(before, await inventory(binding.outputs.work, 805306368));
    terminal.outcome = terminal.result.complete ? 'COMPLETE_REPORTED_MATRIX_NOT_ACCEPTANCE' : 'FAILURE_OR_UNKNOWN_INCOMPLETE_RESULT';
  } catch (error) { state.add(error); terminal.outcome = 'PUBLICATION_FAILURE_OR_UNKNOWN'; }
} catch (error) { state.add(error); }

if (ledger && evidence && output) {
  ledger.beginTail();
  try {
    terminal.faults = { primaryPresent: state.primaryPresent, primary: state.primary, secondary: state.secondary };
    terminal.accountingBeforeTail = ledger.snapshot();
    terminal.afterCensusReservation = { capture: 2097152, work: 8388608, purpose: 'terminal, three Git captures, final receipt and bounded metadata tail; not zero post-census writes' };
    write(path.join(evidence, 'TERMINAL.json'), terminal);
    const existingEvidence = await inventory(evidence, 805306368);
    const gitLogicalAllowance = existingEvidence.total * 2 + 1048576;
    ledger.charge(gitLogicalAllowance, false);
    terminal.gitStorageQualification = { chargedLogicalBytes: gitLogicalAllowance, sharedGitDatabaseExcluded: true, actualNewGitObjectPhysicalBytes: 'UNOBSERVED; not a physical-storage bound' };
    const relativeEvidence = path.relative(binding.repo, evidence);
    relativeName(relativeEvidence);
    await git('git-add', ['add', '--', relativeEvidence]);
    await git('git-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record bounded B1 PUBLIC15 outcome including incomplete failures', '--', relativeEvidence]);
    terminal.commit = await git('git-receipt', ['rev-parse', 'HEAD']);
  } catch (error) { state.add(error); }
  try {
    const startup = binding.outputs.startupCaptures.map(file => {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 4096) throw Error('Startup reserved tail exceeded');
      return { path: file, bytes: stat.size, prechargedCeiling: 4096, liveAfterCensus: true };
    });
    const measured = { evidence: await inventory(evidence, 805306368), publication: await inventory(output, 805306368), startup };
    const value = { schema: 'b1-publication-final-v2', atUTC: new Date().toISOString(), terminal, faults: { primaryPresent: state.primaryPresent, primary: state.primary, secondary: state.secondary }, knownStartsThroughReceipt: auth.knownStartsBeforePublication + 2 + gitAttempts, knownChildRetirement: unknownChild ? 'UNKNOWN' : terminal.children.every(child => child.exitObserved && child.closeObserved) ? 'OBSERVED_FOR_RECORDED_CHILDREN_ONLY' : 'UNKNOWN', accounting: ledger.snapshot(), measuredBeforeFinalWrite: measured, reservedAfterCensusBytes: 1048576, noFullCensus: true, noGuaranteedDurableCapture: true, commitMayBeAbsent: true };
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    if (bytes.length > 1048576) throw Error('Final receipt tail cap');
    write(path.join(output, 'FINAL.json'), bytes);
  } catch (error) { state.add(error); }
}
process.exitCode = state.primaryPresent || !terminal.result.complete || unknownChild ? 78 : terminal.result.reportedStatus === 'PASS' ? 0 : 1;
