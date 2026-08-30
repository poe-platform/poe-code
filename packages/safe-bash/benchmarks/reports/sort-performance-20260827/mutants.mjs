import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), 'utf8')).trim();
assert.match(root, /^\/tmp\/safe-bash-sort-performance-[A-Za-z0-9]+$/);
const evidence = process.env.SORT_REPORT ?? join(own, 'evidence'), target = join(root, 'candidate/src/commands/text.ts');
const original = await readFile(target, 'utf8'), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proposal = JSON.parse(await readFile(join(own, 'prototypes/proposal.json'), 'utf8'));
assert.equal(hash(original), proposal.candidateSha256);
const build = () => execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: join(root, 'candidate'), timeout: 60000 });
function change(from, to) {
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Update File: ${target}\n@@\n${from.split('\n').map(line => '-' + line).join('\n')}\n${to.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
}
const rows = [];
for (const mutation of [
  { name: 'remove-total-input-cap', from: '              if (size > bufferLimit) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });\n              records.push(bytes);', to: '              records.push(bytes);' },
  { name: 'borrow-instead-of-own-record', from: '      else accept(new Uint8Array(part));', to: '      else accept(part);' },
]) {
  assert.equal(original.split(mutation.from).length, 2);
  change(mutation.from, mutation.to);
  try {
    build();
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--test', '--test-concurrency=1', '--test-timeout=30000', join(root, 'harness/holdouts.mjs')],
      { cwd: join(root, 'candidate'), env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: join(root, 'tmp'), LC_ALL: 'C', TZ: 'UTC', SORT_ROOT: root, SORT_VARIANT: 'candidate' }, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(join(evidence, `mutant-${mutation.name}.stdout`), result.stdout, { flag: 'wx' });
    await writeFile(join(evidence, `mutant-${mutation.name}.stderr`), result.stderr, { flag: 'wx' });
    const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    rows.push({ name: mutation.name, sha256: hash(await readFile(target)), status: result.status, signal: result.signal, counts });
    assert.ifError(result.error); assert.equal(result.signal, null); assert.ok(counts.fail > 0); console.log(mutation.name, counts);
  } finally { change(mutation.to, mutation.from); assert.equal(await readFile(target, 'utf8'), original); build(); }
}
await writeFile(join(evidence, 'mutants.json'), JSON.stringify({ restoredSourceSha256: hash(await readFile(target)), rows }, null, 2) + '\n', { flag: 'wx' });
