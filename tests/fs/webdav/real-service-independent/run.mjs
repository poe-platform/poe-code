import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const output = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !output.startsWith('/tmp/')) throw new Error('fresh /tmp evidence directory required');
const source = process.argv[3] ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
assert.match(source, /^[a-f0-9]{40}$/);
const author = '1c745c3';
const authorRoot = 'tests/fs/webdav/real-service';
const scopeReview = process.argv.includes('--scope-review');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = spawnSync('git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
};
await mkdir(output);
const temporary = await mkdtemp('/tmp/safe-bash-webdav-review-');
const fixture = join(temporary, 'fixtures');
const report = { startedAt: new Date().toISOString(), source, author: git(['rev-parse', author]).toString().trim(), temporary, node: process.version, status: git(['status', '--short']).toString(), sourceHash: hash(git(['show', `${source}:src/fs/webdav/webdav.ts`])), behavioralAcceptance: false, inputs: {}, commands: [], cleanup: false };
function execute(label, file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', TSX_DISABLE_CACHE: '1' }, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  report.commands.push({ label, args, status: result.status, signal: result.signal, error: result.error?.message });
  return Promise.all([writeFile(join(output, `${label}.stdout.log`), result.stdout ?? ''), writeFile(join(output, `${label}.stderr.log`), result.stderr ?? '')]).then(() => result);
}
try {
  await mkdir(fixture);
  await mkdir(join(fixture, 'evidence/apache-final'), { recursive: true });
  await mkdir(join(temporary, 'node_modules'), { recursive: true });
  for (const name of ['typescript', '@types/node', 'undici-types', 'tsx', 'esbuild', '@esbuild/darwin-arm64', 'fsevents']) {
    await cp(join(repo, 'node_modules', name), join(temporary, 'node_modules', name), { recursive: true, dereference: true });
  }
  const names = ['run.mjs', 'phase2-validate.mjs', 'apache.mjs', 'server.py', 'dependencies.json', 'openssl.cnf', 'https.mts', 'example.mts', 'consumer.mts', 'phase2-consumer.mts', 'raw.mjs', 'legacy-lock.test.ts', 'direct-comparison.test.ts', 'timestamp-postcondition.test.ts'];
  for (const name of names) {
    const bytes = git(['show', `${author}:${authorRoot}/${name}`]);
    report.inputs[name] = { originalSha256: hash(bytes) };
    let text = bytes.toString();
    if (name === 'run.mjs' || name === 'phase2-validate.mjs') {
      assert.ok(text.includes("const repo = resolve(own, '../../../..');"));
      text = text.replace("const repo = resolve(own, '../../../..');", `const repo = ${JSON.stringify(repo)};`);
    }
    if (name === 'run.mjs') {
      text = text.replace("const consumerFiles = ['https.mts', 'example.mts', 'consumer.mts'];", "const consumerFiles = ['https.mts', 'example.mts', 'consumer.mts', 'independent.mts'];");
      const marker = "  const rawReport = JSON.parse(await readFile(`${evidence}/raw.json`));";
      assert.ok(text.includes(marker));
      text = text.replace(marker, "  await run(process.execPath, ['--unhandled-rejections=strict', '--import', join(own, 'public-guard.mjs'), `${workspace}/consumer/out/independent.mjs`, `${workspace}/config.json`, evidence, provider]);\n" + marker);
      if (scopeReview) {
        text = text.replace("'independent.mts'];", "'independent.mts', 'scope-neighbors.mts'];");
        text = text.replace(marker, "  await run(process.execPath, ['--unhandled-rejections=strict', '--import', join(own, 'public-guard.mjs'), `${workspace}/consumer/out/scope-neighbors.mjs`, `${workspace}/config.json`, evidence, provider]);\n" + marker);
      }
    }
    if (scopeReview && name === 'phase2-validate.mjs') text = text.replace("const ownedTests = ['legacy-lock.test.ts', 'timestamp-postcondition.test.ts'];", "const ownedTests = ['legacy-lock.test.ts', 'timestamp-postcondition.test.ts', 'lock-scope.test.ts'];");
    report.inputs[name].executedSha256 = hash(Buffer.from(text));
    await writeFile(join(fixture, name), text);
  }
  if (scopeReview) {
    const bytes = git(['show', '69672fe210fbf8a23cc980828bb46d073b078425:tests/fs/webdav/real-service/lock-scope.test.ts']);
    report.inputs['lock-scope.test.ts'] = { originalSha256: hash(bytes), executedSha256: hash(bytes) };
    await writeFile(join(fixture, 'lock-scope.test.ts'), bytes);
  }
  await writeFile(join(fixture, 'evidence/apache-final/raw.json'), git(['show', `${author}:${authorRoot}/evidence/apache-final/raw.json`]));
  for (const name of ['independent.mts', 'public-guard.mjs', ...(scopeReview ? ['scope-neighbors.mts'] : [])]) {
    const bytes = await readFile(join(own, name));
    report.inputs[name] = { originalSha256: hash(bytes), executedSha256: hash(bytes) };
    await writeFile(join(fixture, name), bytes);
  }
  if (!process.argv.includes('--services-only')) {
    const validation = await execute('unchanged-validation', join(fixture, 'phase2-validate.mjs'), ['unchanged-validation', `--source=${source}`, '--aliases', '--committed-only']);
    report.validationPassed = validation.status === 0;
  } else report.validationNotRerun = 'use separately preserved unchanged-validation cohort at this source';
  for (const provider of ['apache', 'wsgidav']) {
    const result = await execute(provider, join(fixture, 'run.mjs'), [provider, provider, `--source=${source}`, '--legacy']);
    report[provider] = { completed: result.status === 0 || result.status === 2, captureExit: result.status };
    console.log(provider, result.status, result.stdout.slice(-2200), result.stderr.slice(-1200));
  }
  for (const entry of await readdir(join(fixture, 'evidence'), { withFileTypes: true })) {
    if (entry.name !== 'apache-final' && entry.isDirectory()) await cp(join(fixture, 'evidence', entry.name), join(output, entry.name), { recursive: true });
  }
  report.fixtureSourceUnchanged = names.every(name => report.inputs[name].originalSha256 === hash(git(['show', `${author}:${authorRoot}/${name}`])));
} finally {
  await rm(temporary, { recursive: true, force: true });
  report.cleanup = true;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'run.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ source, validationPassed: report.validationPassed, apache: report.apache, wsgidav: report.wsgidav, output }, null, 2));
