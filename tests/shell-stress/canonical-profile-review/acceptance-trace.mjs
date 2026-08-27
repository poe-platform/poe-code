import childProcess from 'node:child_process';
import { register, syncBuiltinESMExports } from 'node:module';

if (process.env.PROFILE_REVIEW_POLICY) {
  register(`data:text/javascript,${encodeURIComponent(String.raw`
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const policy = JSON.parse(readFileSync(process.env.PROFILE_REVIEW_POLICY));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const path = realpathSync(fileURLToPath(url));
  const before = hash(readFileSync(path));
  const result = await nextLoad(url, context);
  const after = hash(readFileSync(path));
  const expected = policy.files[path];
  const valid = expected === before && before === after;
  appendFileSync(process.env.PROFILE_REVIEW_TRACE, JSON.stringify({ pid: process.pid, url, path, before, hash: after, expected: expected ?? null, valid }) + '\n');
  if (!valid) throw new Error('Independent archive import identity rejected: ' + path);
  return result;
}
`)}`);
  for (const method of ['spawn', 'spawnSync']) {
    const original = childProcess[method];
    childProcess[method] = function traced(command, args, options) {
      if (command === process.execPath && options?.env) {
        const preload = `--import=${import.meta.url}`;
        const flags = options.env.NODE_OPTIONS ?? '';
        options = { ...options, env: { ...options.env, PROFILE_REVIEW_POLICY: process.env.PROFILE_REVIEW_POLICY, PROFILE_REVIEW_TRACE: process.env.PROFILE_REVIEW_TRACE, NODE_OPTIONS: flags.includes(preload) ? flags : `${flags} ${preload}`.trim() } };
      }
      return original(command, args, options);
    };
  }
  syncBuiltinESMExports();
}
