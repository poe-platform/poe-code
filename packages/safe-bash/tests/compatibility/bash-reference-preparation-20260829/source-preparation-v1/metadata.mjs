import { lstat, readFile, writeFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'METADATA-STARTUP.json', JSON.stringify({ startedAt: new Date().toISOString(), role: 'SOURCE_METADATA', children: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
const identity = async pathname => {
  const resolved = await realpath(pathname);
  const status = await lstat(resolved);
  assert(status.isFile() && !status.isSymbolicLink() && status.size <= 350 * 1024 * 1024);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(resolved, { highWaterMark: 65536 })) digest.update(chunk);
  return { path: pathname, resolved, bytes: status.size, mode: (status.mode & 0o7777).toString(8), sha256: digest.digest('hex') };
};
try {
  const paths = ['/usr/bin/patch', '/Library/Developer/CommandLineTools/usr/bin/llvm-otool', '/Library/Developer/CommandLineTools/usr/bin/clang', '/Library/Developer/CommandLineTools/usr/bin/make', '/Library/Developer/CommandLineTools/usr/bin/ld', '/Library/Developer/CommandLineTools/usr/bin/ar', '/Library/Developer/CommandLineTools/usr/bin/ranlib', '/bin/sh', '/bin/bash', '/usr/bin/sed', '/usr/bin/awk', '/usr/bin/grep', '/usr/bin/tr', '/usr/bin/sort', '/usr/bin/expr', '/usr/bin/wc', '/usr/bin/dirname', '/usr/bin/basename', '/bin/cat', '/bin/rm', '/bin/mkdir', '/bin/cp', '/bin/mv', '/bin/chmod', '/usr/bin/touch', '/usr/bin/env'];
  const rows = [];
  for (const pathname of paths) {
    try { rows.push(await identity(pathname)); }
    catch (error) { if (error.code === 'ENOENT') rows.push({ path: pathname, absent: true }); else throw error; }
  }
  const plan = JSON.parse(await readFile(new URL('../verification-v2/plan-r2.json', import.meta.url), 'utf8'));
  const metadata = { tools: rows, node: plan.node, previousPlanKeys: Object.keys(plan), closureKeys: Object.keys(plan.closure[0]), authorityKeys: Object.keys(plan.authorityArtifacts[0]) };
  const manpath = '/usr/share/man/man1/patch.1';
  try {
    const status = await lstat(manpath);
    if (status.isFile() && status.size < 200000) {
      const content = await readFile(manpath, 'utf8');
      const lines = content.split('\n');
      metadata.patchManual = { ...(await identity(manpath)), selected: lines.flatMap((line, index) => /fuzz|force|batch|strip|input|directory|backup|posix/i.test(line) ? [{ line: index + 1, text: line }] : []).slice(0, 70) };
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(root + 'TOOLS.json', JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'METADATA_ONLY', tools: rows.length, absent: rows.filter(row => row.absent).length, previousPlanKeys: metadata.previousPlanKeys, closureKeys: metadata.closureKeys, authorityKeys: metadata.authorityKeys, patchManual: metadata.patchManual ?? null }));
} catch (error) {
  await writeFile(root + 'METADATA-FAILURE.json', JSON.stringify({ name: error.name, message: error.message }) + '\n', { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
