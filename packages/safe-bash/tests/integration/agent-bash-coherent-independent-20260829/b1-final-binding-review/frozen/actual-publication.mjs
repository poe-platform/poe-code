import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scope = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-final-binding';
const expectedIds = ['C10', 'C11', 'C15', 'C16', 'C18'];
const layouts = ['source-built', 'installed', 'physically-moved'];
const hashBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const streamHash = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
export function completeWrite(write, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = write(bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw Error('Incomplete publication write');
    offset += count;
  }
}
export function checkWindow(binding, authorization, now) {
  const start = Date.parse(authorization.startedUTC);
  if (authorization.action !== 'ROOT_B1_PUBLIC15_ACTUAL' || typeof authorization.authorization !== 'string' || !authorization.authorization.trim()) throw Error('Fresh ROOT actual authority required');
  if (!Number.isFinite(start) || start < Date.parse(binding.issuedUTC) || start > Date.parse(binding.latestStartUTC) || now < start || now >= Math.min(start + 1800000, Date.parse(binding.expiresUTC))) throw Error('Inclusive publication deadline');
  if (!Number.isSafeInteger(authorization.knownStartsBeforePublication) || authorization.knownStartsBeforePublication < 7 || authorization.knownStartsBeforePublication + 5 > 32) throw Error('Known-start publication reservation');
}
export function matrix(aggregate) {
  if (!Array.isArray(aggregate) || aggregate.length !== 3) throw Error('Incomplete layout matrix');
  return layouts.flatMap(layout => {
    const matches = aggregate.filter(entry => entry.layout === layout);
    if (matches.length !== 1) throw Error('Layout identity');
    const report = matches[0].report;
    if (!report || !Array.isArray(report.rows) || report.rows.length !== 5) throw Error('Missing actual rows');
    const ids = report.rows.map(row => row.id);
    if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(expectedIds)) throw Error('Case identity');
    return report.rows.map(row => ({ layout, observed: row }));
  });
}
export function safeRelative(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === 'agents.md')) throw Error('Publication path refusal');
  return relative;
}
export function sameInventory(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Owned work changed during publication');
}
function admitted(file, expectedHash, expectedSize, ceiling) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(expectedSize) || stat.size !== expectedSize || stat.size > ceiling) throw Error(`Typed size admission: ${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== expectedSize || hashBytes(bytes) !== expectedHash) throw Error(`Hash admission: ${file}`);
  return bytes;
}
async function publish(args) {
  const [bindingFile, bindingHash, bindingSize, authorizationFile, authorizationHash, authorizationSize] = args;
  const binding = JSON.parse(admitted(bindingFile, bindingHash, Number(bindingSize), 131072));
  const authorization = JSON.parse(admitted(authorizationFile, authorizationHash, Number(authorizationSize), 32768));
  const check = () => checkWindow(binding, authorization, Date.now());
  check();
  if (authorization.bindingSha256 !== bindingHash) throw Error('Authority/binding mismatch');
  for (const entry of binding.publicationFiles) admitted(entry.path, entry.sha256, entry.bytes, 131072);
  const seal = JSON.parse(admitted(binding.preseal.path, binding.preseal.sha256, binding.preseal.bytes, 32768));
  for (const entry of seal.files) admitted(entry.path, entry.sha256, entry.bytes, 8388608);
  const packageStat = fs.lstatSync(binding.package.path);
  if (!packageStat.isFile() || packageStat.size !== binding.package.bytes || await streamHash(binding.package.path) !== binding.package.sha256) throw Error('Package changed');
  const evidence = path.resolve(scope, 'actual-evidence');
  fs.mkdirSync(evidence);
  const write = (name, value) => {
    check();
    const descriptor = fs.openSync(path.join(evidence, safeRelative(name)), 'wx');
    try { completeWrite((bytes, offset, length) => fs.writeSync(descriptor, bytes, offset, length), Buffer.from(`${JSON.stringify(value, null, 2)}\n`)); }
    finally { fs.closeSync(descriptor); }
  };
  const inventory = async () => {
    const entries = [];
    let bytes = 0;
    const visit = async (directory, relative = '') => {
      for (const name of fs.readdirSync(directory).sort()) {
        check();
        const key = safeRelative(relative ? `${relative}/${name}` : name);
        const file = path.join(directory, name);
        const stat = fs.lstatSync(file);
        if (entries.length >= 20000) throw Error('Inventory entry cap');
        if (stat.isSymbolicLink()) entries.push({ path: key, type: 'link', target: fs.readlinkSync(file) });
        else if (stat.isDirectory()) { entries.push({ path: key, type: 'directory' }); await visit(file, key); }
        else if (stat.isFile()) {
          bytes += stat.size;
          if (bytes > 805306368) throw Error('Owned work byte cap');
          entries.push({ path: key, type: 'file', bytes: stat.size, sha256: await streamHash(file) });
        } else throw Error('Unknown owned entry');
      }
    };
    await visit(binding.workRoot);
    return { bytes, entries };
  };
  const before = await inventory();
  write('WORK-INVENTORY.json', before);
  let copied = 0;
  const raw = [];
  const copy = async (source, relative, expected) => {
    check();
    copied += expected.bytes;
    if (copied > 67108864) throw Error('Aggregate raw capture cap');
    const destination = path.join(evidence, 'raw', safeRelative(relative));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (await streamHash(destination) !== expected.sha256) throw Error('Raw copy integrity');
    raw.push({ path: relative, ...expected });
  };
  for (const entry of before.entries) {
    if (entry.type !== 'file' || entry.path.includes('/node_modules/') || entry.path.includes('/dist/') || entry.path.includes('/engine/')) continue;
    if (/(?:^|\/)(?:RESULT|STOP)\.json$/.test(entry.path) || /(?:stdout|stderr|events|capture|supervisor|retirement)/i.test(entry.path)) await copy(path.join(binding.workRoot, entry.path), entry.path, entry);
  }
  for (const file of binding.captures.slice(0, 2)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 67108864) throw Error('Outer capture admission');
    await copy(file, `outer/${path.basename(file)}`, { bytes: stat.size, sha256: await streamHash(file) });
  }
  const resultEntry = before.entries.find(entry => entry.path === 'RESULT.json' && entry.type === 'file');
  let result;
  let rows = [];
  if (resultEntry) {
    result = JSON.parse(admitted(path.join(binding.workRoot, resultEntry.path), resultEntry.sha256, resultEntry.bytes, 2097152));
    rows = matrix(result.aggregate);
  }
  write('OBSERVATIONS.json', { result: result ?? null, rows, observedRows: rows.length, expectedRows: 15, raw, coherentAcceptance: false, B2: 'UNRUN', profile: 'known-role-only; no process-group absence/full-census or nested-loader proof', authorization });
  sameInventory(before, await inventory());
  write('PUBLICATION.json', { time: new Date().toISOString(), workUnchanged: true, copiedBytes: copied, knownStartsAtFinalReceipt: authorization.knownStartsBeforePublication + 5, publicationChildren: ['git-add', 'git-commit', 'git-rev-parse'], noRetry: true });
  const git = (name, args) => {
    check();
    const child = spawnSync('/usr/bin/git', args, { cwd: process.cwd(), encoding: 'buffer', timeout: Math.min(30000, Math.max(1, Math.min(Date.parse(binding.expiresUTC), Date.parse(authorization.startedUTC) + 1800000) - Date.now())), maxBuffer: 1048576, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GIT_OPTIONAL_LOCKS: '0' } });
    process.stdout.write(JSON.stringify({ role: name, pid: child.pid, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout?.toString(), stderr: child.stderr?.toString() }) + '\n');
    if (child.error || child.signal || child.status !== 0) throw Error(`Publication metadata failure ${name}`);
    return child.stdout.toString().trim();
  };
  const relativeEvidence = `${scope}/actual-evidence`;
  git('git-add', ['add', '--', relativeEvidence]);
  git('git-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record one bounded B1 PUBLIC15 attempt', '--', relativeEvidence]);
  const commit = git('git-rev-parse', ['rev-parse', 'HEAD']);
  check();
  const receiptFile = `${binding.captures[2]}.git-receipt.json`;
  const descriptor = fs.openSync(receiptFile, 'wx');
  try { completeWrite((bytes, offset, length) => fs.writeSync(descriptor, bytes, offset, length), Buffer.from(JSON.stringify({ commit, bindingHash, observedRows: rows.length, timestamp: new Date().toISOString(), knownStarts: authorization.knownStartsBeforePublication + 5, finalReceiptOutsideCommit: true }) + '\n')); }
  finally { fs.closeSync(descriptor); }
  console.log(JSON.stringify({ commit, receiptFile, observedRows: rows.length, coherentAcceptance: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--publish' || process.argv.length !== 9) { console.error('Explicit --publish binding/hash/size authorization/hash/size required'); process.exitCode = 78; }
  else try { await publish(process.argv.slice(3)); } catch (error) { console.error(error); process.exitCode = 78; }
}
