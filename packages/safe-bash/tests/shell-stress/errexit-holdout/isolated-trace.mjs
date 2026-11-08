import { registerHooks } from 'node:module';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const policy = JSON.parse(readFileSync(process.env.ERREXIT_ISOLATION_POLICY, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inspect(url) {
  const path = fileURLToPath(url.split('?')[0]);
  const real = realpathSync(path);
  const inArchive = path.startsWith(`${policy.archiveRoot}/`) && real.startsWith(`${policy.archiveRoot}/`);
  const inToolchain = real.startsWith(`${policy.toolchainRoot}/`);
  const liveSource = path.startsWith(`${policy.liveRoot}/src/`) || real.startsWith(`${policy.liveRoot}/src/`);
  const key = inArchive ? relative(policy.archiveRoot, path) : inToolchain ? relative(policy.toolchainRoot, real) : null;
  const expected = inArchive ? policy.archiveFiles[key] : inToolchain ? policy.toolchainFiles[key] : undefined;
  const actual = hash(readFileSync(path));
  const valid = !liveSource && expected !== undefined && actual === expected && (inArchive || inToolchain);
  return { url, path, real, key, category: inArchive ? key.startsWith('src/') ? 'product' : 'fixture' : inToolchain ? 'toolchain' : 'forbidden', expected, hash: actual, liveSource, valid };
}
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    const before = inspect(url);
    if (!before.valid) {
      appendFileSync(process.env.ERREXIT_ISOLATION_TRACE, `${JSON.stringify({ ...before, phase: 'rejected-before-load' })}\n`);
      throw new Error(`Isolated import rejected: ${before.path}`);
    }
    const loaded = nextLoad(url, context);
    const after = inspect(url);
    const record = { ...after, phase: 'loaded', beforeHash: before.hash, valid: after.valid && before.hash === after.hash };
    appendFileSync(process.env.ERREXIT_ISOLATION_TRACE, `${JSON.stringify(record)}\n`);
    if (!record.valid) throw new Error(`Isolated import changed while loading: ${after.path}`);
    return loaded;
  },
});
