import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const recipe = dirname(fileURLToPath(import.meta.url));
export const scope = resolve(recipe, '..');
export const parent = resolve(scope, '..');
export const repository = resolve(parent, '../../..');
export const author = join(repository, 'tests/integration/html-public-independent-20260827/admission-v3.2');
export const freeze = 'e27a62c40a317deae83fc1ef9d41d57f38d7d51d';
export const manifestSha = '968c52402f4c10507fb7c5410b33086bba33e7209b7030b42e7859b4c85c1980';
export const raw = join(scope, 'raw');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = target => JSON.parse(fs.readFileSync(target, 'utf8'));
export const fileHash = target => hash(fs.readFileSync(target));
export const errorRecord = error => ({ name: error.name, code: error.code, message: error.message, stack: error.stack });
export function save(target, value) {
  const descriptor = fs.openSync(target, 'wx');
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
export function inventory(root) {
  const files = {}, directories = [];
  function visit(relative) {
    for (const name of fs.readdirSync(join(root, relative)).sort()) {
      assert.notEqual(name.toUpperCase(), 'AGENTS.MD');
      const entry = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(join(root, entry));
      assert.equal(stat.isSymbolicLink(), false, entry);
      if (stat.isDirectory()) { directories.push(entry); visit(entry); }
      else { assert.ok(stat.isFile(), entry); files[entry] = { sha256: fileHash(join(root, entry)), bytes: stat.size }; }
    }
  }
  visit('');
  return { files, directories };
}
export function authenticateRecipe(commit) {
  const manifest = read(join(recipe, 'MANIFEST.json'));
  const current = inventory(recipe);
  delete current.files['MANIFEST.json'];
  assert.deepEqual(current, manifest.inventory);
  const prefix = 'tests/integration/html-public-admission-resource-v32-independent-20260827/prerequisites-01/recipe';
  const args = ['--no-replace-objects', '-C', repository, 'show', `${commit}:${prefix}/MANIFEST.json`];
  const env = { PATH: '/usr/bin:/bin', HOME: scope, TMPDIR: scope, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
  const bytes = execFileSync('/usr/bin/git', args, { timeout: 10000, maxBuffer: 1024 * 1024, env });
  assert.equal(hash(bytes), fileHash(join(recipe, 'MANIFEST.json')));
  for (const [name, identity] of Object.entries(manifest.inventory.files)) {
    const committed = execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, 'show', `${commit}:${prefix}/${name}`], { timeout: 10000, maxBuffer: 1024 * 1024, env });
    assert.equal(hash(committed), identity.sha256, name);
  }
  return { commit, manifestSha256: hash(bytes), inventory: current };
}
export async function authenticateProtected() {
  const bindings = read(join(recipe, 'BINDINGS.json'));
  for (const [target, identity] of Object.entries(bindings.protectedFiles)) assert.equal(fileHash(target), identity.sha256, target);
  for (const [name, tool] of Object.entries(bindings.tools)) {
    assert.equal(fs.realpathSync(tool.path), tool.realpath, name);
    assert.equal(fileHash(tool.path), tool.sha256, name);
  }
  const existing = await import('../../recipe/authenticate.mjs');
  const result = await existing.authenticate();
  assert.deepEqual(result.tools, bindings.tools);
  return { at: new Date().toISOString(), protectedIndependentFiles: Object.keys(bindings.protectedFiles).length, authorFiles: result.protectedFiles, priorFiles: result.priorFiles, tools: result.tools, authorAuthentication: result.authentication };
}
export function probe(pids, groups) {
  const bindings = read(join(recipe, 'BINDINGS.json'));
  const table = execFileSync(bindings.tools.ps.path, ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { timeout: 10000, maxBuffer: 4 * 1024 ** 2, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  return {
    at: new Date().toISOString(),
    pids: [...new Set(pids)].map(pid => {
      try { process.kill(pid, 0); return { pid, state: 'present' }; }
      catch (error) { return { pid, state: error.code === 'ESRCH' ? 'absent' : error.code }; }
    }),
    groups: [...new Set(groups)].map(pgid => ({ pgid, members: table.split('\n').filter(line => Number(line.trim().split(/\s+/u)[2]) === pgid) })),
  };
}
