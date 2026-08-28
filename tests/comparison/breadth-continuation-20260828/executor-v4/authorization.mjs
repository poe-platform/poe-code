import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { identity, hash, requireThat, relativeName } from './safety.mjs';
import { boundFile } from '../executor-v3/projection.mjs';
import { bindGrantPlan } from './operations.mjs';

export function authenticatePacket(root) {
  const bytes = fs.readFileSync(path.join(root, 'SEAL.json'));
  const seal = JSON.parse(bytes);
  for (const entry of seal.files) boundFile(path.resolve(root, entry.path), entry);
  for (const prefix of ['', '../executor-preparation-v1', '../executor-overlay-v2', '../executor-v3']) {
    const base = path.resolve(root, prefix);
    const allowed = new Set();
    for (const entry of seal.files) {
      const relative = path.relative(base, path.resolve(root, entry.path));
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      allowed.add(relative);
      let parent = path.dirname(relative);
      while (parent !== '.') { allowed.add(parent); parent = path.dirname(parent); }
    }
    if (prefix === '') { allowed.add('SEAL.json'); allowed.add('runs'); }
    let visited = 0;
    const visit = relative => {
      for (const name of fs.readdirSync(path.join(base, relative))) {
        const member = path.join(relative, name);
        requireThat(++visited <= allowed.size && allowed.has(member), 'UNSEALED_RECIPE_ENTRY', member);
        const info = fs.lstatSync(path.join(base, member));
        requireThat(!info.isSymbolicLink(), 'RECIPE_SYMLINK', member);
        if (info.isDirectory() && !(prefix === '' && member === 'runs')) visit(member);
      }
    };
    visit('');
  }
  return hash(bytes);
}
export function authority({ root, repository, phase, runId, outputRoot, review, grant, projection }) {
  const recipe = authenticatePacket(root);
  for (const tool of projection.tools) boundFile(tool.path, tool);
  requireThat(['admission', 'cohort'].includes(phase), 'PHASE', phase);
  const git = projection.tools.find(tool => tool.role === 'git').path;
  const load = binding => {
    requireThat(binding && /^[0-9a-f]{40}$/.test(binding.commit) && /^[0-9a-f]{64}$/.test(binding.sha256), 'AUTHORIZATION_BINDING', binding);
    relativeName(binding.path);
    const bytes = execFileSync(git, ['show', `${binding.commit}:${binding.path}`], { cwd: repository, timeout: 10000, maxBuffer: 65536, env: { PATH: '', LANG: 'C', HOME: root } });
    requireThat(hash(bytes) === binding.sha256, 'AUTHORIZATION_HASH', binding.path);
    return JSON.parse(bytes);
  };
  const different = load(review);
  requireThat(different.role === 'different-reviewer' && different.verdict === 'PREEXECUTION_ACCEPTED' && different.recipeSha256 === recipe, 'DIFFERENT_FREEZE', different);
  const approved = load(grant);
  identity(approved);
  requireThat(approved.role === 'root' && approved.phase === phase && approved.recipeSha256 === recipe && approved.reviewSha256 === review.sha256 && approved.attempts === 1, 'ROOT_GRANT', approved);
  if (phase === 'cohort') requireThat(approved.acceptedAdmission?.sha256 && approved.acceptedAdmission?.path, 'ADMISSION_REQUIRED', approved);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')));
  const context = { root, phase, runId, outputRoot };
  bindGrantPlan(approved, context, plan);
  return { phase, recipe, review, grant, approved, plan, context };
}
