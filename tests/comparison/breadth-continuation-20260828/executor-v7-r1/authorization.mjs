import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { identity, hash, requireThat, relativeName } from '../executor-v4/safety.mjs';
import { boundFile } from './projection.mjs';
import { bindGrantPlan } from '../executor-v4/operations.mjs';
import { profile } from './bootstrap.mjs';
import { dataObject, hashString } from './schema.mjs';
import { readRegular } from '../executor-v3/regular-read.mjs';

export function readAuthorization(filename, expectedSha256, root) {
  requireThat(typeof filename === 'string' && path.isAbsolute(filename) && filename.startsWith(`${root}/runs/`) && path.basename(filename) === 'AUTH.json' && hashString(expectedSha256), 'AUTH_FILE_BINDING', null);
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 65536 && (info.mode & 0o7777) === 0o644, 'AUTH_FILE_METADATA', filename);
  const bytes = readRegular(filename, info.size);
  requireThat(hash(bytes) === expectedSha256, 'AUTH_FILE_HASH', filename);
  const value = dataObject(JSON.parse(bytes), ['review', 'grant']);
  requireThat(value, 'AUTH_FILE_SCHEMA', null);
  for (const key of ['review', 'grant']) {
    const binding = dataObject(value[key], ['commit', 'path', 'sha256']);
    requireThat(binding && /^[0-9a-f]{40}$/.test(binding.commit) && typeof binding.path === 'string' && hashString(binding.sha256), 'AUTH_REFERENCE_SCHEMA', key);
    relativeName(binding.path);
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

export function authority({ root, repository, phase, runId, outputRoot, review, grant, projection, metadataChildren = [] }) {
  const recipe = authenticatePacket(root);
  for (const tool of projection.tools) boundFile(tool.path, tool);
  requireThat(['admission', 'cohort'].includes(phase), 'PHASE', phase);
  const git = projection.tools.find(tool => tool.role === 'git').path;
  function load(binding) {
    requireThat(binding && /^[0-9a-f]{40}$/.test(binding.commit) && /^[0-9a-f]{64}$/.test(binding.sha256), 'AUTHORIZATION_BINDING', binding);
    relativeName(binding.path);
    const child = spawnSync(git, ['show', `${binding.commit}:${binding.path}`], { cwd: repository, timeout: 10000, maxBuffer: 65536, detached: true, env: { PATH: '', LANG: 'C', HOME: root } });
    const stdout = child.stdout ?? Buffer.alloc(0), stderr = child.stderr ?? Buffer.alloc(0);
    const receipt = { role: 'git-authority-metadata', pid: child.pid, status: child.status, signal: child.signal, errorCode: child.error?.code ?? null, stdoutBytes: stdout.length, stdoutSha256: hash(stdout), stderrBase64: stderr.toString('base64'), reaped: Boolean(child.pid) && absent(child.pid) && absent(-child.pid) };
    metadataChildren.push(receipt);
    requireThat(receipt.status === 0 && receipt.signal === null && !receipt.errorCode && receipt.reaped && stdout.length <= 65536 && stderr.length === 0, 'AUTHORITY_METADATA_CHILD', receipt);
    requireThat(hash(stdout) === binding.sha256, 'AUTHORIZATION_HASH', binding.path);
    return JSON.parse(stdout);
  }
  const different = load(review);
  requireThat(different.role === 'different-reviewer' && different.verdict === 'PREEXECUTION_ACCEPTED' && different.recipeSha256 === recipe, 'DIFFERENT_FREEZE', different);
  const approved = load(grant);
  identity(approved);
  requireThat(approved.role === 'root' && approved.phase === phase && approved.recipeSha256 === recipe && approved.reviewSha256 === review.sha256 && approved.attempts === 1 && approved.bootstrapProfile === profile.name && approved.reportProtocol === 'BOUNDED_TERMINAL_V2', 'ROOT_GRANT', approved);
  if (phase === 'cohort') requireThat(approved.acceptedAdmission?.sha256 && approved.acceptedAdmission?.path, 'ADMISSION_REQUIRED', approved);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')));
  const context = { root, phase, runId, outputRoot };
  bindGrantPlan(approved, context, plan);
  return { phase, recipe, review, grant, approved, plan, context, metadataChildren };
}
