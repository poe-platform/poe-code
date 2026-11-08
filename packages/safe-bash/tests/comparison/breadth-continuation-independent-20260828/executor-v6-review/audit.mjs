import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(own, '../../../..');
export const candidate = path.resolve(own, '../../breadth-continuation-20260828/executor-v6');
export const recipeCommit = '931b8e07114b8f69fa50f35e798a7a619f578cdb';
export const evidenceCommit = '5420fa35ffd4a7085f0df0a60b3bfc4608a7acd1';
export const sealSha256 = '937f5551b242c5388febd085aa18905095150f846c9e3005e766db7b39c979a0';
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
export function snapshot() {
  const sealBytes = fs.readFileSync(path.join(candidate, 'SEAL.json'));
  assert.equal(digest(sealBytes), sealSha256);
  const seal = JSON.parse(sealBytes);
  assert.equal(seal.files.length, 245);
  const entries = seal.files.map(entry => ({ ...entry, filename: path.resolve(candidate, entry.path), commit: recipeCommit }));
  entries.push({ filename: path.join(candidate, 'SEAL.json'), sha256: sealSha256, commit: recipeCommit });
  const evidencePaths = git(['ls-tree', '-r', '--name-only', evidenceCommit, `${path.relative(repository, candidate)}/runs`]).toString().trim().split('\n');
  for (const relative of evidencePaths) entries.push({ filename: path.join(repository, relative), commit: evidenceCommit });
  for (const [directory, commit, names] of [
    ['executor-v5-review', 'bfff3dfed06d9144c82652246251f654c8bd26e7', ['EXPECTATIONS.json', 'FIXTURES.json']],
    ['executor-v5-body-review', '8d711d755637351336de718cd180f3e7ef949781', ['EXPECTATIONS.json', 'worker.mjs', 'data.mjs', 'run.mjs', 'README.md', 'ADMISSION-INTERFACE.json', 'capture-01/RESULT.json', 'capture-01/entry-parent-denied.json', 'capture-01/entry-parent-denied/view/unauthorized-parent.mjs']],
  ]) for (const name of names) entries.push({ filename: path.resolve(own, '..', directory, name), commit });
  const files = entries.map(entry => {
    const relative = path.relative(repository, entry.filename);
    assert(!relative.startsWith('..') && !relative.split('/').some(part => part.toUpperCase() === 'AGENTS.MD'));
    const info = fs.lstatSync(entry.filename);
    assert(info.isFile() && !info.isSymbolicLink(), relative);
    const bytes = fs.readFileSync(entry.filename);
    const committed = git(['show', `${entry.commit}:${relative}`]);
    assert(bytes.equals(committed), `GIT_BYTES:${relative}`);
    if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes, relative);
    if (entry.mode !== undefined) assert.equal(info.mode & 0o7777, entry.mode, relative);
    if (entry.sha256 !== undefined) assert.equal(digest(bytes), entry.sha256, relative);
    return { path: relative, bytes: bytes.length, mode: info.mode & 0o7777, sha256: digest(bytes), commit: entry.commit };
  });
  const namespace = {};
  for (const prefix of ['', '../executor-preparation-v1', '../executor-overlay-v2', '../executor-v3', '../executor-v4', '../executor-v5']) {
    const base = path.resolve(candidate, prefix);
    const members = [];
    const visit = relative => {
      for (const name of fs.readdirSync(path.join(base, relative)).sort()) {
        const member = path.join(relative, name);
        const info = fs.lstatSync(path.join(base, member));
        assert(!info.isSymbolicLink());
        members.push({ path: member, directory: info.isDirectory() });
        if (info.isDirectory() && member !== 'runs') visit(member);
      }
    };
    visit(''); namespace[prefix] = members;
  }
  return { kind: 'STATIC_BYTE_AND_NAMESPACE_AUDIT_NOT_EXECUTION', date: new Date().toISOString(), recipeCommit, evidenceCommit, sealSha256, sealCount: seal.files.length, files, namespace, index: git(['diff', '--cached', '--name-status']).toString(), fullStatus: git(['status', '--porcelain=v1', '--untracked-files=all']).toString(), ownStatus: git(['status', '--short', '--', path.relative(repository, own)]).toString(), archivePolicy: 'Committed evidence gzip authenticated as opaque bytes only; no archive extraction, product pack read, instruction plaintext or deployed-provider authentication.' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  assert(['BEFORE.json', 'AFTER.json'].includes(name));
  const result = snapshot();
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const target = path.join(own, name);
  assert(!fs.existsSync(target));
  const patch = `*** Begin Patch\n*** Add File: ${path.relative(repository, target)}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  execFileSync('apply_patch', [], { cwd: repository, input: patch });
  console.log(JSON.stringify({ output: name, authenticated: result.files.length, sealCount: result.sealCount }));
}
