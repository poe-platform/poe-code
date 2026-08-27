import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const temporary = fs.realpathSync(process.env.TMPDIR);
const audit = join(process.env.REMAINING_AUDIT, `${process.pid}.jsonl`);
const append = fs.appendFileSync;
const writeFile = promises.writeFile.bind(promises);
const symlink = promises.symlink.bind(promises);
function resolved(path) {
  try { return fs.realpathSync(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(resolved(parent), path.slice(parent.length));
  }
}
function guard(operation, input) {
  const path = resolve(input instanceof URL ? fileURLToPath(input) : String(input));
  const destination = resolved(path);
  const offset = relative(temporary, destination);
  const allowed = offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith('../'));
  append(audit, JSON.stringify({ pid: process.pid, operation, path, destination, allowed }) + '\n');
  if (!allowed) throw new Error(`AUTHOR_WRITE_TARGET_DENIED: ${operation}: ${path}`);
}
for (const [operation, indexes] of Object.entries({
  writeFile: [0], appendFile: [0], mkdir: [0], mkdtemp: [0], rm: [0], rmdir: [0], unlink: [0],
  rename: [0, 1], copyFile: [1], cp: [1], link: [1], symlink: [1], chmod: [0], utimes: [0], truncate: [0],
})) {
  const original = promises[operation].bind(promises);
  promises[operation] = async (...args) => {
    for (const index of indexes) guard(operation, args[index]);
    return original(...args);
  };
}
const open = promises.open.bind(promises);
promises.open = async (path, flags, ...rest) => {
  if (typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : /[wa+]/.test(flags)) guard('open-write', path);
  return open(path, flags, ...rest);
};
syncBuiltinESMExports();

if (process.env.REMAINING_GUARD_CONTROL === '1') {
  const historical = join(process.env.REVIEW_COPY, 'tests/commands/split/evidence/edge-latest.json');
  const bytes = await promises.readFile(historical);
  await assert.rejects(promises.writeFile(historical, bytes), /AUTHOR_WRITE_TARGET_DENIED/);
  const alias = join(temporary, 'historical-alias');
  await symlink(dirname(historical), alias, 'dir');
  await assert.rejects(promises.writeFile(join(alias, 'edge-latest.json'), bytes), /AUTHOR_WRITE_TARGET_DENIED/);
  assert.deepEqual(await promises.readFile(historical), bytes);
  await writeFile(join(temporary, 'control.json'), JSON.stringify({ directIdenticalRewriteDenied: true, symlinkIdenticalRewriteDenied: true }), { flag: 'wx' });
}
