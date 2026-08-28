import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { identity, hash, requireThat, relativeName } from '../executor-v4/safety.mjs';
import { boundFile } from './projection.mjs';
import { bindGrantPlan } from '../executor-v4/operations.mjs';
import { profile } from './bootstrap.mjs';
import { dataObject, hashString } from './schema.mjs';
import { readRegular } from '../executor-v3/regular-read.mjs';
import { referenceData, envelopeData, reviewData, grantData, authorityReceiptData, runIdentifier } from './contracts.mjs';
import { denseArray } from './schema.mjs';
import { fileURLToPath } from 'node:url';

export function readAuthorization(filename, expectedSha256, root) {
  requireThat(typeof root === 'string' && typeof filename === 'string' && path.isAbsolute(filename) && filename.startsWith(`${root}/runs/`) && path.basename(filename) === 'AUTH.json' && hashString(expectedSha256), 'AUTH_FILE_BINDING', null);
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 65536 && (info.mode & 0o7777) === 0o644, 'AUTH_FILE_METADATA', filename);
  const bytes = readRegular(filename, info.size);
  requireThat(hash(bytes) === expectedSha256, 'AUTH_FILE_HASH', filename);
  const value = dataObject(JSON.parse(bytes), ['review', 'grant']);
  requireThat(value, 'AUTH_FILE_SCHEMA', null);
  for (const key of ['review', 'grant']) {
    requireThat(referenceData(value[key]), 'AUTH_REFERENCE_SCHEMA', key);
  }
  return value;
}

export function authenticatePacket(root) {
  const bytes = fs.readFileSync(path.join(root, 'SEAL.json'));
  requireThat(bytes.length <= 262144, 'SEAL_CAP', bytes.length);
  const seal = JSON.parse(bytes);
  for (const entry of seal.files) boundFile(path.resolve(root, entry.path), entry);
  for (const namespace of seal.namespaces) {
    const base = path.resolve(root, namespace.path);
    const expected = new Map(namespace.entries.map(entry => [entry.path, entry]));
    let visited = 0;
    const walk = relative => {
      for (const name of fs.readdirSync(path.join(base, relative)).sort()) {
        const member = path.join(relative, name), entry = expected.get(member);
        requireThat(++visited <= expected.size && entry, 'UNSEALED_RECIPE_ENTRY', member);
        const info = fs.lstatSync(path.join(base, member));
        requireThat(!info.isSymbolicLink() && info.isDirectory() === entry.directory, 'RECIPE_ENTRY_TYPE', member);
        if (info.isDirectory() && !namespace.excludedDescendants.includes(member)) walk(member);
      }
    };
    walk(''); requireThat(visited === expected.size, 'MISSING_RECIPE_ENTRY', namespace.path);
  }
  return hash(bytes);
}
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };

export function loadAuthorityReference(binding, { read, observe, receipts, ordinal, syntheticOnly = false }) {
  const reference = referenceData(binding);
  requireThat(reference, 'AUTHORIZATION_BINDING', null);
  requireThat(typeof read === 'function' && typeof observe === 'function' && denseArray(receipts, 2) && [1, 2].includes(ordinal) && receipts.length === ordinal - 1, 'AUTHORITY_OBSERVER', null);
  const child = dataObject(read(reference), ['pid', 'status', 'signal', 'errorCode', 'stdout', 'stderr', 'reaped']);
  requireThat(child && Buffer.isBuffer(child.stdout) && Buffer.isBuffer(child.stderr), 'AUTHORITY_READ_SCHEMA', null);
  requireThat((child.pid === null || (Number.isSafeInteger(child.pid) && child.pid > 0)) && (child.status === null || (Number.isSafeInteger(child.status) && child.status >= 0 && child.status <= 255)) && (child.signal === null || (typeof child.signal === 'string' && /^SIG[A-Z0-9]{1,61}$/.test(child.signal))) && (child.errorCode === null || (typeof child.errorCode === 'string' && child.errorCode.length <= 128)) && typeof child.reaped === 'boolean', 'AUTHORITY_READ_SCHEMA', null);
  const receipt = { role: syntheticOnly ? 'synthetic-authority-metadata' : 'git-authority-metadata', ordinal, reference, pid: child.pid, group: Number.isSafeInteger(child.pid) ? -child.pid : null, status: child.status, signal: child.signal, errorCode: child.errorCode, stdoutBytes: child.stdout.length, stdoutSha256: hash(child.stdout), stderrBase64: child.stderr.toString('base64'), reaped: child.reaped };
  receipts.push(receipt);
  observe({ kind: 'authority-observed', receipt });
  requireThat(authorityReceiptData(receipt, ordinal, reference, syntheticOnly), 'AUTHORITY_METADATA_CHILD', null);
  return JSON.parse(child.stdout);
}

export function authority(input) {
  const header = dataObject(input, ['root', 'repository', 'phase', 'runId', 'outputRoot', 'review', 'grant', 'observe'], ['metadataChildren']);
  requireThat(header && referenceData(header.review) && referenceData(header.grant), 'AUTHORIZATION_BINDING', null);
  const { root, repository, phase, runId, outputRoot, review, grant, observe, metadataChildren = [] } = header;
  requireThat(typeof root === 'string' && root === path.dirname(fileURLToPath(import.meta.url)) && typeof repository === 'string' && repository === path.resolve(root, '../../../..') && ['admission', 'cohort'].includes(phase) && runIdentifier(runId) && typeof outputRoot === 'string' && outputRoot === path.join(root, 'runs', runId) && typeof observe === 'function' && denseArray(metadataChildren, 0), 'AUTH_CONTEXT_SCHEMA', null);
  const recipe = authenticatePacket(root);
  const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
  for (const tool of projection.tools) boundFile(tool.path, tool);
  requireThat(['admission', 'cohort'].includes(phase), 'PHASE', phase);
  const git = projection.tools.find(tool => tool.role === 'git').path;
  function read(binding) {
    const child = spawnSync(git, ['show', `${binding.commit}:${binding.path}`], { cwd: repository, timeout: 10000, maxBuffer: 65536, detached: true, env: { PATH: '', LANG: 'C', HOME: root } });
    const stdout = child.stdout ?? Buffer.alloc(0), stderr = child.stderr ?? Buffer.alloc(0);
    return { pid: child.pid ?? null, status: child.status, signal: child.signal, errorCode: child.error?.code ?? null, stdout, stderr, reaped: Boolean(child.pid) && absent(child.pid) && absent(-child.pid) };
  }
  const different = reviewData(loadAuthorityReference(review, { read, observe, receipts: metadataChildren, ordinal: 1 }));
  requireThat(different && different.recipeSha256 === recipe, 'DIFFERENT_FREEZE', null);
  const approved = grantData(loadAuthorityReference(grant, { read, observe, receipts: metadataChildren, ordinal: 2 }));
  requireThat(approved, 'ROOT_GRANT_SCHEMA', null);
  identity(approved);
  requireThat(approved.role === 'root' && approved.phase === phase && approved.recipeSha256 === recipe && approved.reviewSha256 === review.sha256 && approved.attempts === 1 && approved.bootstrapProfile === profile.name && approved.reportProtocol === 'BOUNDED_TERMINAL_V3', 'ROOT_GRANT', approved);
  if (phase === 'cohort') requireThat(approved.acceptedAdmission?.sha256 && approved.acceptedAdmission?.path, 'ADMISSION_REQUIRED', approved);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')));
  const context = { root, phase, runId, outputRoot };
  bindGrantPlan(approved, context, plan);
  return { phase, recipe, review, grant, approved, plan, context, metadataChildren };
}
