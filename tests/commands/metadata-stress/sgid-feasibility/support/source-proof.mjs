import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const tagUrl = 'https://api.github.com/repos/apple-oss-distributions/xnu/git/ref/tags/xnu-12377.101.15';
async function json(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}
const tag = await json(tagUrl);
const tagObject = await json(tag.object.url);
const commit = tagObject.object.sha;
const entries = [
  ['apple-oss-distributions/xnu', commit, 'libsyscall/wrappers/unix03/chmod.c', ['int res = __chmod(path, mode);', 'res = __chmod(path, mode ^ S_ISGID);']],
  ['apple-oss-distributions/xnu', commit, 'bsd/vfs/vfs_syscalls.c', ['fchmodat_internal(vfs_context_t', 'chmod(__unused proc_t', 'fchmodat(__unused proc_t']],
  ['apple-oss-distributions/xnu', commit, 'bsd/vfs/vfs_subr.c', ['if (vap->va_mode & S_ISGID)', 'kauth_cred_ismember_gid(cred, group']],
  ['libuv/libuv', 'v1.51.0', 'src/unix/fs.c', ['X(CHMOD, chmod(req->path, req->mode));']],
  ['nodejs/node', 'v22.22.2', 'src/node_file.cc', ['uv_fs_chmod']],
];
const sources = [];
for (const [repository, revision, path, markers] of entries) {
  const url = `https://raw.githubusercontent.com/${repository}/${revision}/${path}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const text = await response.text();
  const lines = text.split('\n');
  const locations = Object.fromEntries(markers.map(marker => [marker, lines.flatMap((line, index) => line.includes(marker) ? [index + 1] : [])]));
  assert.ok(Object.values(locations).every(matches => matches.length > 0));
  sources.push({ repository, revision, path, url, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), locations });
}
const evidence = {
  capturedAt: new Date().toISOString(), tagUrl, tag, tagObject, sources,
  interpretation: {
    wrapper: 'Darwin UNIX03 chmod first calls __chmod with the requested mode. On EPERM with SGID requested it retries without SGID; success is returned. The remaining stale errno is not an error after a successful return.',
    kernel: 'The version-matched XNU source sends chmod and fchmodat through fchmodat_internal. vnode_authattr rejects setting SGID for a non-root caller outside the target group. Native controls distinguish the kernel refusal from the userspace retry.',
    node: 'The version-matched Node/libuv sources route fs chmod through uv_fs_chmod to libc chmod, not fchmodat.',
    limits: 'Tag version matches the running xnu-12377.101.15. No kernel or shared-cache binary rebuild, signature validation, or in-kernel event trace is claimed. GNU fchmodat arguments are measured through separate development-only interposition; Node API arguments are measured through a temporary restored builtin wrapper.',
  },
};
const content = JSON.stringify(evidence, null, 2);
const result = spawnSync('apply_patch', [], { encoding: 'utf8', input: `*** Begin Patch\n*** Add File: ${join(owned, 'source-proof.json')}\n${content.split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n` });
assert.equal(result.status, 0, result.stderr);
console.log(JSON.stringify({ commit, sources: sources.map(source => ({ path: source.path, sha256: source.sha256, locations: source.locations })) }, null, 2));
