import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..');
const source = process.argv[3] ?? 'debb29ead94ae387f359d9d04b333ee4380f88d6';
const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]+$/); assert.match(source, /^[0-9a-f]{40}$/);
const evidence = join(own, 'evidence', label);
await mkdir(dirname(evidence), { recursive: true });
await mkdir(evidence, { recursive: false });
const workspace = await mkdtemp(join(own, '.work-'));
const fixture = join(workspace, 'fixtures');
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin`, HOME: workspace, TMPDIR: workspace,
  LANG: 'C.UTF-8', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => { const result = spawnSync('git', args, { cwd: repo, env, timeout: 30000, maxBuffer: 32 * 1024 * 1024 }); assert.equal(result.status, 0, String(result.stderr)); return result.stdout; };
const record = { source, sourceHash: hash(git(['show', `${source}:src/fs/webdav/webdav.ts`])), contractHash: hash(git(['show', `${source}:src/contracts/filesystem.md`])),
  status: git(['status', '--short']).toString(), inputs: {}, commands: [], startedAt: new Date().toISOString() };
try {
  await mkdir(fixture);
  await mkdir(join(fixture, 'evidence/apache-final'), { recursive: true });
  for (const name of ['run.mjs', 'apache.mjs', 'server.py', 'dependencies.json', 'openssl.cnf', 'https.mts', 'example.mts', 'consumer.mts', 'phase2-consumer.mts', 'raw.mjs', 'phase2-validate.mjs', 'legacy-lock.test.ts', 'direct-comparison.test.ts', 'timestamp-postcondition.test.ts', 'lock-scope.test.ts']) {
    const bytes = git(['show', `${source}:tests/fs/webdav/real-service/${name}`]);
    let text = bytes.toString();
    if (['run.mjs', 'phase2-validate.mjs'].includes(name)) text = text.replace("const repo = resolve(own, '../../../..');", `const repo = ${JSON.stringify(repo)};`);
    if (name === 'run.mjs') {
      const marker = "  const rawReport = JSON.parse(await readFile(`${evidence}/raw.json`));";
      assert.ok(text.includes(marker));
      text = text.replace("const consumerFiles = ['https.mts', 'example.mts', 'consumer.mts'];", "const consumerFiles = ['https.mts', 'example.mts', 'consumer.mts', 'feasibility.mts'];");
      text = text.replace(marker, "  await run(process.execPath, ['--unhandled-rejections=strict', `${workspace}/consumer/out/feasibility.mjs`, `${workspace}/config.json`, evidence, provider]);\n" + marker);
    }
    if (name === 'phase2-validate.mjs') text = text.replace("const ownedTests = ['legacy-lock.test.ts', 'timestamp-postcondition.test.ts'];", "const ownedTests = ['legacy-lock.test.ts', 'timestamp-postcondition.test.ts', 'lock-scope.test.ts'];");
    record.inputs[name] = { originalSha256: hash(bytes), executedSha256: hash(Buffer.from(text)) };
    await writeFile(join(fixture, name), text);
  }
  await writeFile(join(fixture, 'evidence/apache-final/raw.json'), git(['show', `${source}:tests/fs/webdav/real-service/evidence/apache-final/raw.json`]));
  const probe = await readFile(join(own, 'feasibility.mts'));
  record.inputs['feasibility.mts'] = { originalSha256: hash(probe), executedSha256: hash(probe) };
  await writeFile(join(fixture, 'feasibility.mts'), probe);
  await writeFile(join(evidence, 'before.json'), JSON.stringify(record, null, 2), { flag: 'wx' });
  for (const name of ['validation', 'apache', 'wsgidav']) {
    const args = name === 'validation' ? [join(fixture, 'phase2-validate.mjs'), name, `--source=${source}`, '--aliases', '--committed-only']
      : [join(fixture, 'run.mjs'), name, name, `--source=${source}`, '--legacy'];
    const result = spawnSync(process.execPath, args, { cwd: repo, env, timeout: 240000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    record.commands.push({ name, args, status: result.status, signal: result.signal, error: result.error?.message });
    await writeFile(join(evidence, `${name}.stdout.log`), result.stdout ?? '', { flag: 'wx' });
    await writeFile(join(evidence, `${name}.stderr.log`), result.stderr ?? '', { flag: 'wx' });
    console.log(name, result.status, result.stdout?.slice(-1600), result.stderr?.slice(-1200));
  }
  for (const entry of await readdir(join(fixture, 'evidence'), { withFileTypes: true })) if (entry.isDirectory() && entry.name !== 'apache-final') {
    await cp(join(fixture, 'evidence', entry.name), join(evidence, entry.name), { recursive: true, errorOnExist: true, force: false });
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(evidence, 'run.json'), JSON.stringify({ ...record, cleanup: { workspace, removed: true }, endedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
}
