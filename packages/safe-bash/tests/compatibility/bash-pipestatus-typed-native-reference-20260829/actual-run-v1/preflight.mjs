import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const base = path.resolve('tests/compatibility/bash-pipestatus-typed-native-reference-20260829');
const own = `${base}/actual-run-v1`;
const directory = `${base}/materialized`;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const records = [];
function small(file, expected, max = 1048576) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || fs.realpathSync(file) !== file) throw Error(`TYPE:${file}`);
    const bytes = fs.readFileSync(descriptor);
    const digest = hash(bytes);
    if (bytes.length !== stat.size || (expected && digest !== expected)) throw Error(`HASH:${file}`);
    const after = fs.fstatSync(descriptor);
    if (after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw Error(`RACE:${file}`);
    records.push({ path: file, bytes: bytes.length, mode: stat.mode & 511, sha256: digest });
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function write(name, value) {
  const descriptor = fs.openSync(`${own}/${name}`, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
try {
  const now = Date.now();
  if (now >= Date.parse('2026-08-29T14:53:40.912Z')) throw Error('LATEST_START');
  const approval = JSON.parse(small(`${base}/activation-v1/APPROVAL-REQUEST.json`, 'ad70f95598e5d13de49184034b350be21e15a6af8c035a3212e35cf9ffcd8591'));
  if (hash(Buffer.from(approval.cmd)) !== 'fdc96c5fb856284fa79287a1ff30869fa82c2d90e96f0ce34426acfac430a464' || approval.login !== false || approval.sandbox_permissions !== 'require_escalated' || Object.hasOwn(approval, 'prefix_rule')) throw Error('COMMAND_DRIFT');
  const seal = JSON.parse(small(`${directory}/PRESEAL.json`, 'ade56f23358e284df533f7e57e462ba927fb0386899061e90699977746424b6e'));
  for (const member of seal.files) {
    const bytes = small(`${directory}/${member.path}`, member.sha256);
    if (bytes.length !== member.bytes || (fs.lstatSync(`${directory}/${member.path}`).mode & 511) !== member.mode) throw Error('MEMBER_MODE_SIZE');
  }
  const tree = small(`${own}/raw/slot-review-tree.nul`, null, 16777216).toString().split('\0').filter(Boolean);
  let slotReceipt = null;
  for (const row of tree) {
    const [meta, file] = row.split('\t');
    if (!file?.endsWith('/RECEIPT.json') || !file.includes('resolved')) continue;
    const absolute = path.resolve(file);
    const bytes = small(absolute);
    if (hash(bytes) !== 'fd1a6b994c79a0f9346d1458d5fa29ee1f44808cca76d0e87abf0d63bf7d40a2') continue;
    const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    if (meta.split(' ')[2] !== blob || slotReceipt) throw Error('SLOT_BLOB');
    slotReceipt = { path: absolute, sha256: hash(bytes), blob };
  }
  if (!slotReceipt) throw Error('MISSING_SLOT_ACCEPTANCE');
  const admission = await import(pathToFileURL(`${directory}/admission.mjs`).href);
  const accepted = admission.admit(directory, `${directory}/GO.json`, '9d971fe4c4546fa9a90d1184af9d05c573fb6e343f6dcea6546cfef762383772');
  const tools = JSON.parse(small(`${directory}/TOOLS.json`, seal.files.find(item => item.path === 'TOOLS.json').sha256));
  for (const tool of [...tools.toolPins, tools.environmentLauncher, tools.wrapperTool]) admission.pinned(tool.path, tool);
  const root = '/private/tmp/safe-bash-pipestatus-typed-observations-20260829-v1';
  admission.validateProvision(accepted.provision, root);
  for (const child of ['outer', 'cases', 'captures']) if (fs.readdirSync(`${root}/${child}`).length !== 0) throw Error('PREEXISTING_CAPTURE_OR_CASE');
  const journal = fs.lstatSync(`${root}/JOURNAL.jsonl`);
  if (!journal.isFile() || journal.size !== 0 || (journal.mode & 511) !== 384 || journal.uid !== process.getuid()) throw Error('JOURNAL');
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(['JOURNAL.jsonl', 'captures', 'cases', 'outer'])) throw Error('ROOT_MEMBERSHIP');
  const cohort = JSON.parse(small(`${directory}/COHORT.json`, seal.files.find(item => item.path === 'COHORT.json').sha256));
  admission.validateCohort(cohort, accepted.requests, root);
  const template = JSON.parse(small(`${base}/APPROVAL-PROPOSAL.template.json`, '8f14ef69db395a8dffd4bcd573e6944bc03bddf324ac204846c6b1c6412e6f4e'));
  admission.resolveApproval(template, approval, '9d971fe4c4546fa9a90d1184af9d05c573fb6e343f6dcea6546cfef762383772');
  if (Date.now() >= Date.parse('2026-08-29T14:53:40.912Z')) throw Error('LATEST_START_FINAL');
  const result = { status: 'PASS', at: new Date().toISOString(), slotReceipt, sourceMembers: seal.files.length, tools: 4, records, bootstrapCaptures: 'ABSENT', actualFDAdmission: 'DEFERRED', approval };
  write('PREFLIGHT.json', result);
  console.log(JSON.stringify({ status: result.status, at: result.at, approval }, null, 2));
} catch (error) {
  write('PREFLIGHT-HOLD.json', { status: 'HOLD', message: String(error.message), at: new Date().toISOString(), records });
  console.error(error); process.exitCode = 1;
}
