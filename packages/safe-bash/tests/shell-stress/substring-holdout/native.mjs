import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild, sha256 } from '../current-shell/support.mjs';
import { nativeCases, hostCases, policy } from './cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
assert.equal(process.cwd(), root);
const filename = process.argv[2];
assert.match(filename ?? '', /^[a-z0-9-]+\.json$/);
const target = resolve(owned, filename);
assert.ok(!existsSync(target), 'Native evidence is immutable; select a fresh name');
assert.equal(nativeCases.length, 24);
const casesPath = resolve(owned, 'cases.mjs');
const casesHash = sha256(await readFile(casesPath));
const helper = resolve(owned, '../current-shell/support.mjs');
const helperHash = sha256(await readFile(helper));
const started = new Date().toISOString();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
const localeList = await runChild('/usr/bin/locale', ['-a'], { env: { ...policy.environment, LANG: 'C', LC_ALL: 'C' }, deadline: policy.deadlineMs });
assert.equal(localeList.status, 0);
assert.ok(Buffer.from(localeList.stdout, 'base64').toString().split('\n').includes('en_US.UTF-8'));
const profiles = [];
const directories = [];
const children = [localeList];

async function captureEntries(directory) {
  const entries = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name), stat = await lstat(path);
    assert.ok(stat.isFile(), `Unexpected effect type: ${name}`);
    entries[name] = { bytes: (await readFile(path)).toString('base64'), mode: stat.mode & 0o777 };
  }
  return entries;
}

for (const [role, binary] of [['primary', policy.primary], ['historical', policy.historical]]) {
  const hash = sha256(await readFile(binary));
  if (role === 'primary') assert.equal(hash, policy.primarySha256);
  const version = await runChild(binary, ['--version'], { env: { ...policy.environment, LANG: 'C', LC_ALL: 'C' }, deadline: policy.deadlineMs });
  children.push(version);
  assert.equal(version.status, 0);
  assert.match(Buffer.from(version.stdout, 'base64').toString(), role === 'primary' ? /version 5\.3\./ : /version 3\.2\./);
  for (const locale of policy.locales) {
    const env = { ...policy.environment, LANG: locale, LC_ALL: locale };
    const charmap = await runChild('/usr/bin/locale', ['charmap'], { env, deadline: policy.deadlineMs });
    children.push(charmap);
    assert.equal(charmap.status, 0);
    if (locale !== 'C') assert.equal(Buffer.from(charmap.stdout, 'base64').toString().trim(), 'UTF-8');
    const controlScript = 'VALUE="Aé猫🙂Z"; printf "%s|%s|%s|%s|" "$0" "$1" "$LC_ALL" "${#VALUE}"; printf "%s" "${VALUE:1:1}"; printf "\\000\\377"';
    const controlArgs = ['--noprofile', '--norc', '-c', controlScript, policy.shellName, 'control-argument'];
    const control = await runChild(binary, controlArgs, { env, argv0: policy.argv0, deadline: policy.deadlineMs });
    children.push(control);
    const expectedControl = Buffer.concat([Buffer.from(`shell|control-argument|${locale}|${locale === 'C' ? 11 : 5}|`), locale === 'C' ? Buffer.from([0xc3]) : Buffer.from('é'), Buffer.from([0, 255])]);
    assert.equal(control.status, 0); assert.equal(control.stderr, '');
    assert.equal(control.stdout, expectedControl.toString('base64'), 'Actual byte/character/launcher profile control');
    const rows = [];
    for (const specimen of nativeCases) {
      const directory = await realpath(await mkdtemp(resolve(owned, '.native-')));
      directories.push(directory);
      try {
        for (const [name, text] of Object.entries(specimen.files)) {
          assert.match(name, /^[a-z]+$/);
          await writeFile(resolve(directory, name), text); await chmod(resolve(directory, name), 0o644);
        }
        const before = await captureEntries(directory);
        const args = ['--noprofile', '--norc', '-c', specimen.script, policy.shellName, ...specimen.args];
        const run = await runChild(binary, args, { cwd: directory, env, argv0: policy.argv0, stdin: Buffer.from(specimen.stdin, 'base64'), deadline: policy.deadlineMs });
        children.push(run);
        rows.push({ id: specimen.id, scriptSha256: sha256(specimen.script), argv0: policy.argv0, args, cwd: directory, env, stdin: specimen.stdin, before, run,
          tuple: { stdout: run.stdout, stderr: run.stderr, status: run.status, entries: await captureEntries(directory) } });
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
    profiles.push({ id: `${role}-${locale}`, role, locale, binary: await realpath(binary), binarySha256: hash, version, charmap, control: { script: controlScript, args: controlArgs, env, cwd: root, argv0: policy.argv0, expected: expectedControl.toString('base64'), run: control }, rows });
  }
}
assert.equal(sha256(await readFile(casesPath)), casesHash);
assert.equal(sha256(await readFile(helper)), helperHash);
const clean = children.every(child => !child.timedOut && !child.overflow && !child.groupAlive && child.signal === null);
const report = { started, finished: new Date().toISOString(), head, node: process.version, policy, casesHash, helper: { path: relative(root, helper), sha256: helperHash }, captureRunnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  nativeCount: nativeCases.length, hostCount: hostCases.length, productImported: false, newAuthorSourceOrExpectationsRead: false,
  localeTool: { path: '/usr/bin/locale', sha256: sha256(await readFile('/usr/bin/locale')), availableLocales: localeList }, profiles,
  cleanup: { children: children.map(({ pid, groupAlive, timedOut, overflow, signal }) => ({ pid, groupAlive, timedOut, overflow, signal })), allChildrenCompleted: clean, removedDirectories: directories, allDirectoriesAbsent: directories.every(directory => !existsSync(directory)) } };
execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, target)}\n${JSON.stringify(report, null, 2).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
console.log(JSON.stringify({ target: relative(root, target), casesHash, profiles: profiles.map(profile => ({ id: profile.id, rows: profile.rows.length, status0: profile.rows.filter(row => row.tuple.status === 0).length, nonzero: profile.rows.filter(row => row.tuple.status !== 0).map(row => ({ id: row.id, status: row.tuple.status })) })), clean }, null, 2));
assert.ok(clean, 'Timed out or signaled capture remains evidence but is not accepted native proof');
