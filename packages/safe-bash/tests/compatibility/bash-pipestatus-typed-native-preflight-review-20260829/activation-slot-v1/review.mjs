import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.dirname(new URL(import.meta.url).pathname);
const repo = '/Users/kjopek/Workspace/safe-bash';
const author = repo + '/tests/compatibility/bash-pipestatus-typed-native-reference-20260829';
const activation = author + '/activation-v1';
const deadline = fs.statSync('/tmp/pipestatus-typed-slot-bootstrap-20260829.stdout').birthtimeMs - 10000 + 360000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let checks = 0;
const rows = [];
function check(value, label) { assert(value, label); checks++; }
function read(file, pin) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576, 'regular/bounded ' + file);
  if (pin) {
    check(stat.size === pin.bytes, 'size ' + file);
    check((stat.mode & 0o777) === pin.mode, 'mode ' + file);
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    check(before.ino === stat.ino && before.dev === stat.dev, 'opened identity');
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    check(bytes.length === stat.size && after.size === before.size && after.mtimeMs === before.mtimeMs, 'read stability');
    if (pin) check(hash(bytes) === pin.sha256, 'hash ' + file);
    rows.push({path: file, bytes: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes)});
    return bytes;
  } finally { fs.closeSync(fd); }
}
function json(file, pin) { return JSON.parse(read(file, pin)); }
function write(name, value) { fs.writeFileSync(root + '/' + name, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}); }
try {
  check(Date.now() < deadline, 'review deadline');
  check(read(activation + '/HANDOFF.md').equals(read('/tmp/pipestatus-typed-slot-committed-handoff-20260829.stdout')), 'committed packet handoff');
  const binding = json(activation + '/BINDING.json');
  check(binding.source === 'e10e371dc9c70583681add9c1747c85a710b1f59', 'source');
  const executableHash = 'ade56f23358e284df533f7e57e462ba927fb0386899061e90699977746424b6e';
  const readyBytes = read(author + '/READY-SEAL.json');
  check(hash(readyBytes) === '798c191fdad35bdf6c1592afda1954764da2209ad18984d966e5488c5e80bdd0', 'READY unchanged');
  const ready = JSON.parse(readyBytes);
  for (const pin of ready.files) read(author + '/' + pin.path, pin);
  const executableBytes = read(author + '/materialized/PRESEAL.json');
  check(hash(executableBytes) === executableHash, 'executable unchanged');
  const executable = JSON.parse(executableBytes);
  check(executable.files.length === 19, '19 executable entries');
  for (const pin of executable.files) read(author + '/materialized/' + pin.path, pin);
  const expected = {
    runtimeReview: [460, 'f5fe14c176e1c276a370cd0a2aec61c16669c4eaecd6f679cecf54c16497fc0f'],
    preprovision: [719, '6531c303526c676f0a6a696c7d78349e95d767e45f569227a685f028bd5a8f4f'],
    rootProposal: [1865, '9d971fe4c4546fa9a90d1184af9d05c573fb6e343f6dcea6546cfef762383772'],
    resolvedApproval: [1350, 'ad70f95598e5d13de49184034b350be21e15a6af8c035a3212e35cf9ffcd8591'],
    command: [847, 'fdc96c5fb856284fa79287a1ff30869fa82c2d90e96f0ce34426acfac430a464']
  };
  const values = {};
  for (const [name, [bytes, sha256]] of Object.entries(expected)) {
    const pin = binding[name];
    check(pin.bytes === bytes && pin.sha256 === sha256 && pin.mode === 0o600 && path.isAbsolute(pin.path), name + ' authority');
    check(fs.lstatSync(pin.path).uid === process.getuid(), name + ' owner');
    values[name] = read(pin.path, pin);
  }
  const grant = JSON.parse(values.rootProposal), approval = JSON.parse(values.resolvedApproval);
  const template = json(author + '/APPROVAL-PROPOSAL.template.json').parameters;
  check(template.cmd.split('ROOT_APPROVED_GRANT_SHA256').length === 2, 'sole template slot');
  assert.deepEqual(approval, {...template, cmd: template.cmd.replace('ROOT_APPROVED_GRANT_SHA256', expected.rootProposal[1])}); checks++;
  check(approval.cmd === values.command.toString() && !values.command.toString().endsWith('\n'), 'exact command no LF');
  check(approval.sandbox_permissions === 'require_escalated' && approval.login === false && !Object.hasOwn(approval, 'prefix_rule'), 'approval route');
  check(grant.preseal.sha256 === executableHash, 'grant executable');
  assert.deepEqual(grant.independentReviewReceipt, binding.runtimeReview); checks++;
  assert.deepEqual(grant.preprovision, binding.preprovision); checks++;
  check(grant.issuedEpochMs === Date.parse('2026-08-29T14:18:40.912Z') && grant.deadlineEpochMs === Date.parse('2026-08-29T15:03:40.912Z'), 'exact window');
  check(grant.issuedEpochMs <= Date.now() && Date.now() + 600000 <= grant.deadlineEpochMs, 'full residual600s');
  const inherited = json(path.dirname(root) + '/RECEIPT.json');
  assert.deepEqual(grant.limits, inherited.limits); checks++;
  assert.deepEqual(grant.failedLookupNames, []); checks++;
  const provision = JSON.parse(values.preprovision);
  check(provision.parents.length === 4, 'four physical parents');
  const actualRoot = '/private/tmp/safe-bash-pipestatus-typed-observations-20260829-v1';
  assert.deepEqual(provision.parents.map(row => row.path).sort(), [actualRoot, actualRoot + '/outer', actualRoot + '/cases', actualRoot + '/captures'].sort()); checks++;
  for (const pin of provision.parents) {
    const stat = fs.lstatSync(pin.path);
    check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700 && String(stat.dev) === pin.device && String(stat.ino) === pin.inode, 'parent binding');
    check(fs.realpathSync(pin.path) === pin.path, 'physical parent');
    if (pin.path !== actualRoot) check(fs.readdirSync(pin.path).length === 0, 'empty unused directory');
  }
  assert.deepEqual(fs.readdirSync(actualRoot).sort(), ['JOURNAL.jsonl', 'captures', 'cases', 'outer'].sort()); checks++;
  read(binding.journal.path, binding.journal);
  check(fs.lstatSync(binding.journal.path).uid === process.getuid(), 'journal owner');
  const tools = json(author + '/materialized/TOOLS.json');
  const pins = [...tools.toolPins, tools.environmentLauncher, tools.wrapperTool];
  check(pins.length === 4, 'four tools');
  for (const pin of pins) {
    const stat = fs.lstatSync(pin.path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size === pin.bytes && (stat.mode & 0o777) === pin.mode, 'tool type/size/mode');
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(pin.path, {highWaterMark: 65536})) digest.update(chunk);
    check(digest.digest('hex') === pin.sha256, 'stream tool identity');
    const after = fs.lstatSync(pin.path);
    check(after.ino === stat.ino && after.size === stat.size && after.mtimeMs === stat.mtimeMs, 'tool stability');
  }
  for (const pin of executable.files) read(author + '/materialized/' + pin.path, pin);
  check(Date.now() < deadline && Date.now() + 600000 < grant.deadlineEpochMs, 'final window');
  const receipt = {verdict: 'ACCEPT_SLOT_DATA_ONLY', at: new Date().toISOString(), packet: '32ceae3a52c52e9cb23f327801c1d1b80238143c', checks, executableHash, readyHash: hash(readyBytes), executableMembers: 19, readyFiles: ready.files.length, tools: 4, approvalPath: binding.resolvedApproval.path, approvalSha256: expected.resolvedApproval[1], commandSha256: expected.command[1], window: binding.window, capturesAbsent: true, unusedProvision: true, actualFDValidation: 'DEFERRED', nativeAuthority: false, limits: grant.limits, qualifications: ['ROOT actual GO and exact escalated tool approval still required', 'four fork reservations UNOBSERVED, not census/OS quota', 'initial tool-shell trusted host boundary remains', 'NUL preexec API failure transcript-only retained; no historical rescore'], rows};
  write('RECEIPT.json', receipt);
  fs.writeFileSync(root + '/REPORT.md', '# Typed6 sole-slot review\n\nACCEPT, DATA/source binding only; no native authority.\n\n' + `${checks} admission checks;19 executable members, READY seal and four stream-hashed tools unchanged. Exact command differs from accepted template only by its single grant hash slot. Mode0600/current owner and physical provision identities match; journal empty and bootstrap captures absent.\n\nChecked ${receipt.at}; latest complete600s start ${binding.window.latestFull600sStart}; expiry ${binding.window.expires}. Fresh ROOT actual GO and exact require_escalated/login:false/no-prefix approval remain mandatory. Actual FD/inode/one-byte-read checks deferred.\n\n` + '29 proposed slots=7 managed+4 UNOBSERVED fork reservations+18admin, peak5 proposal; not OS quota/census. All six observations UNRUN. Prior transcript-only NUL failure and historical records unchanged.\n', {flag: 'wx', mode: 0o600});
  const output = JSON.stringify({verdict: receipt.verdict, at: receipt.at, checks, receiptSha256: hash(fs.readFileSync(root + '/RECEIPT.json')), approvalPath: receipt.approvalPath, approvalSha256: receipt.approvalSha256}) + '\n';
  fs.writeSync(1, output); fs.writeSync(3, output);
} catch (reason) {
  write('FAILURE.json', {present: true, type: typeof reason, message: String(reason), stack: reason?.stack, at: new Date().toISOString(), checks});
  console.error(reason); process.exitCode = 1;
}
