import assert from 'node:assert/strict';
import * as hostFs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.env.GIT_AUTHOR_ROOT;
assert.ok(root && path.isAbsolute(root));
const directory = process.env.GIT_AUTHOR_LAYOUT === 'source' ? 'src' : 'dist';
const leaf = name => pathToFileURL(path.join(root, directory, name)).href;
const { MemoryFileSystem, Shell, agentCommands, createReadOnlyFileSystem, CommandRegistry } = await import(leaf('index.js'));
const { createGitCommand, createGitCommands, gitCommands } = await import(leaf('commands/git/index.js'));
const { Session } = await import(leaf('commands/git/io.js'));
const { GIT_LIMITS } = await import(leaf('commands/git/limits.js'));
const fixture = JSON.parse(await hostFs.readFile(new URL('fixture.json', import.meta.url)));
const cases = [];
const record = async (id, name, run) => {
  const begin = Date.now();
  await hostFs.appendFile(process.env.GIT_AUTHOR_RESULT + '.events.jsonl', JSON.stringify({ id, name, state: 'START' }) + '\n');
  try { await run(); cases.push({ id, name, status: 'PASS', elapsedMs: Date.now() - begin }); }
  catch (error) { cases.push({ id, name, status: 'FAIL', error: String(error?.stack ?? error), elapsedMs: Date.now() - begin }); console.error(name, error); }
  await hostFs.appendFile(process.env.GIT_AUTHOR_RESULT + '.events.jsonl', JSON.stringify(cases.at(-1)) + '\n');
};
const hash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
async function put(fs, name, bytes, mode = 0o644) {
  await fs.mkdir(path.posix.dirname(name), { recursive: true });
  await fs.writeFile(name, typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
  await fs.chmod(name, mode);
}
async function setup() {
  const fs = new MemoryFileSystem();
  for (const file of fixture.files) await put(fs, '/repo/' + file.path, file.text === undefined ? Buffer.from(file.base64, 'base64') : file.text, file.mode);
  return fs;
}
async function object(fs, type, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const oid = hash(type, bytes);
  await put(fs, `/repo/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, deflateSync(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes])));
  return oid;
}
function index(entries, version = 2, extension = Buffer.alloc(0)) {
  const header = Buffer.alloc(12); header.write('DIRC'); header.writeUInt32BE(version, 4); header.writeUInt32BE(entries.length, 8);
  const rows = entries.map(entry => {
    const name = Buffer.from(entry.path), count = Math.ceil((62 + name.length + 1) / 8) * 8, row = Buffer.alloc(count);
    row.writeUInt32BE(entry.mode ?? 0o100644, 24); Buffer.from(entry.oid, 'hex').copy(row, 40);
    row.writeUInt16BE((entry.flags ?? 0) | (entry.stage ?? 0) << 12 | Math.min(name.length, 4095), 60); name.copy(row, 62); return row;
  });
  const bytes = Buffer.concat([header, ...rows, extension]); return Buffer.concat([bytes, createHash('sha1').update(bytes).digest()]);
}
const mutations = new Set(['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'chmod', 'utimes', 'symlink', 'link', 'writeStream']);
async function execute(fs, args, extra = {}) {
  const out = [], err = [], cleanups = []; let stdinReads = 0, invocations = 0, mutationCalls = 0;
  const guarded = new Proxy(fs, { get(target, name) {
    if (mutations.has(name)) return () => { mutationCalls++; throw new Error('product mutator forbidden'); };
    const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const context = { command: 'git', args, cwd: '/repo', env: {}, fs: guarded, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { stdinReads++; throw new Error('Git stdin forbidden'); } },
    stdout: { async write(bytes) { out.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { err.push(Buffer.from(bytes)); } },
    invoke() { invocations++; throw new Error('Git host invocation forbidden'); }, registerCleanup(cleanup) { cleanups.push(cleanup); }, ...extra };
  let value, rejected = false, reason;
  try { value = await createGitCommand().execute(context); } catch (error) { rejected = true; reason = error; }
  const settled = await Promise.allSettled(cleanups.map(cleanup => cleanup()));
  assert.equal(stdinReads, 0); assert.equal(invocations, 0); assert.equal(mutationCalls, 0);
  return { code: value?.exitCode, stdout: Buffer.concat(out), stderr: Buffer.concat(err), rejected, reason, settled, context };
}
async function good(fs, args, stdout, code = 0, extra) {
  const result = await execute(fs, args, extra);
  assert.equal(result.rejected, false, String(result.reason)); assert.equal(result.code, code, result.stderr.toString()); assert.equal(result.stderr.length, 0);
  assert.deepEqual(result.stdout, Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)); return result;
}
async function refused(fs, args, pattern, code = 128, extra) {
  const result = await execute(fs, args, extra);
  assert.equal(result.rejected, false, String(result.reason)); assert.equal(result.code, code); assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), pattern); return result;
}
const show = ['show', 'HEAD:src/app.txt'];
const status = ['status', '--porcelain'];

for (const [offset, workflow] of fixture.proposedOutputs.entries()) {
  await record(`A0${offset + 1}`, `neutral literal workflow ${offset + 1}`, async () => {
    const expected = workflow.stdoutBase64 ? Buffer.from(workflow.stdoutBase64, 'base64') : Buffer.from(workflow.stdout ?? workflow.expectedStdout ?? '');
    await good(await setup(), workflow.args ?? workflow.argv, expected, workflow.exitCode ?? 0);
  });
}
await record('A01', 'literal status exact', async () => good(await setup(), status, 'M  README.md\nD  obsolete.txt\n M src/app.txt\n?? notes.txt\n'));
await record('A02', 'working and cached names', async () => { const fs = await setup(); await good(fs, ['diff', '--name-only'], 'src/app.txt\n'); await good(fs, ['diff', '--cached', '--name-only'], 'README.md\nobsolete.txt\n'); });
await record('A03', 'raw show and first parent full IDs', async () => { const fs = await setup(); await good(fs, show, 'two\n'); await good(fs, ['log', '--first-parent', '--format=%H %s'], `${fixture.oids.headCommit} Second\n${fixture.oids.baseCommit} Initial\n`); });
await record('A07', 'cwd discovery and short relative paths', async () => good(await setup(), ['status', '--short', '-uno', '--', '.'], ' M app.txt\n', 0, { cwd: '/repo/src' }));
await record('A07', 'boundary stops ancestor discovery', async () => { const fs = await setup(); const result = await execute(fs, ['-C', '/other', 'rev-parse', '--show-toplevel']); assert.equal(result.code, 128); });
await record('A08', 'bare raw show and worktree refusals', async () => { const fs = await setup(); await fs.rename('/repo/.git', '/bare'); await put(fs, '/bare/config', '[core]\nbare=true\n'); await good(fs, ['rev-parse', '--is-bare-repository'], 'true\n', 0, { cwd: '/bare' }); await good(fs, show, 'two\n', 0, { cwd: '/bare' }); await refused(fs, status, /worktree/, 128, { cwd: '/bare' }); });
for (const [id, name, content] of [['A09', 'commondir', '../common\n'], ['A10', 'shallow', fixture.oids.headCommit], ['A10', 'info/grafts', ''], ['A10', 'objects/info/alternates', '../other'], ['A10', 'objects/info/http-alternates', 'http://invalid/'], ['A10', 'objects/pack/x.pack', 'PACK'], ['A10', 'objects/pack/x.idx', ''], ['A10', 'objects/pack/x.promisor', ''], ['A10', 'refs/replace/' + fixture.oids.headCommit, fixture.oids.baseCommit]]) {
  await record(id, `storage refusal ${name}`, async () => { const fs = await setup(); await put(fs, '/repo/.git/' + name, content); await refused(fs, ['rev-parse', '--absolute-git-dir'], /unsupported/); });
}
await record('A09', 'gitfile routing refuses', async () => { const fs = new MemoryFileSystem(); await put(fs, '/repo/.git', 'gitdir: /elsewhere\n'); await refused(fs, status, /gitfile/); });
await record('A10', 'empty pack/info directories allowed', async () => { const fs = await setup(); await fs.mkdir('/repo/.git/objects/pack'); await fs.mkdir('/repo/.git/objects/info'); await good(fs, show, 'two\n'); });
for (const setting of ['[core]\nautocrlf=true', '[core]\nignorecase=true', '[core]\nrepositoryformatversion=1', '[extensions]\nobjectformat=sha256', '[include]\npath=/outside', '[alias]\nshow=!bad', '[core]\nworktree=/outside', '[filter "x"]\nclean=bad']) {
  await record('A11', `config refusal ${setting}`, async () => { const fs = await setup(); await put(fs, '/repo/.git/config', setting); await refused(fs, show, /unsupported/); });
}
await record('A11', 'inert config is not execution', async () => { const fs = await setup(); await put(fs, '/repo/.git/config', '[core]\nfilemode=false\n[user]\nname=Nobody\n[remote "origin"]\nurl=https://never-executed.invalid\nfetch=+refs/heads/*:refs/remotes/origin/*\n'); await good(fs, show, 'two\n'); });
await record('A12', 'virtual GIT_DIR forbidden', async () => refused(await setup(), show, /environment/, 128, { env: { GIT_DIR: '/outside' } }));
await record('A13', 'packed refs standalone and loose override', async () => { const fs = await setup(); await fs.rm('/repo/.git/refs/heads/main'); await put(fs, '/repo/.git/packed-refs', `# pack-refs with: peeled fully-peeled\n${fixture.oids.headCommit} refs/heads/main\n`); await good(fs, ['rev-parse', 'HEAD'], fixture.oids.headCommit + '\n'); await put(fs, '/repo/.git/refs/heads/main', fixture.oids.baseCommit + '\n'); await good(fs, ['rev-parse', 'HEAD'], fixture.oids.baseCommit + '\n'); });
await record('A14', 'symbolic ref cycle', async () => { const fs = await setup(); await put(fs, '/repo/.git/refs/heads/main', 'ref: refs/heads/other\n'); await put(fs, '/repo/.git/refs/heads/other', 'ref: refs/heads/main\n'); await refused(fs, show, /cyclic/); });
await record('A14', 'unborn versus missing object', async () => { const fs = await setup(); await fs.rm('/repo/.git/refs/heads/main'); await good(fs, ['status', '--porcelain', '-uno'], 'A  README.md\nAM src/app.txt\n'); await put(fs, '/repo/.git/refs/heads/main', '0'.repeat(40) + '\n'); await refused(fs, status, /missing/); });
for (const [name, transform] of [
  ['trailing zlib byte', bytes => Buffer.concat([bytes, Buffer.from([0])])],
  ['truncated zlib', bytes => bytes.subarray(0, bytes.length - 1)],
  ['wrong checksum', bytes => { const copy = Buffer.from(bytes); copy[copy.length - 1] ^= 1; return copy; }],
  ['canonical leading zero', () => deflateSync(Buffer.from('blob 04\0two\n'))],
  ['declared too short', () => deflateSync(Buffer.from('blob 3\0two\n'))],
  ['declared too long', () => deflateSync(Buffer.from('blob 5\0two\n'))],
  ['wrong content hash', () => deflateSync(Buffer.from('blob 4\0bad\n'))],
  ['over cap header', () => deflateSync(Buffer.from('blob 8388609\0'))],
  ['second zlib member', bytes => Buffer.concat([bytes, deflateSync(Buffer.from('blob 0\0'))])],
]) await record('A15-A18', name, async () => { const fs = await setup(), target = '/repo/.git/objects/f7/19efd430d52bcfc8566a43b2eb655688d38871'; await put(fs, target, transform(Buffer.from(await fs.readFile(target)))); await refused(fs, show, /Git|zlib|object/); });
await record('A19', 'raw arbitrary bytes admitted', async () => { const fs = await setup(); const bytes = Buffer.from([0, 255, 192, 128, 10]); const oid = await object(fs, 'blob', bytes); const tree = await object(fs, 'tree', Buffer.concat([Buffer.from('100644 bin\0'), Buffer.from(oid, 'hex')])); await good(fs, ['show', tree + ':bin'], bytes); });
await record('A20', 'tree traversal rejected', async () => { const fs = await setup(); const oid = await object(fs, 'tree', Buffer.concat([Buffer.from('100644 ../x\0'), Buffer.from(fixture.oids.stagedReadme, 'hex')])); await refused(fs, ['show', oid + ':x'], /invalid|Git/); });
await record('A21', 'submodule mode rejected', async () => { const fs = await setup(); const oid = await object(fs, 'tree', Buffer.concat([Buffer.from('160000 sub\0'), Buffer.from(fixture.oids.headCommit, 'hex')])); await refused(fs, ['show', oid + ':sub'], /mode|submodule/); });
await record('A22', 'index checksum wrong', async () => { const fs = await setup(); const bytes = Buffer.from(await fs.readFile('/repo/.git/index')); bytes[20] ^= 1; await put(fs, '/repo/.git/index', bytes); await refused(fs, ['ls-files'], /checksum/); });
for (const version of [2, 3]) await record('A23', `index version ${version}`, async () => { const fs = await setup(); await put(fs, '/repo/.git/index', index([{ path: 'x', oid: fixture.oids.stagedReadme }], version)); await good(fs, ['ls-files', '--stage'], `100644 ${fixture.oids.stagedReadme} 0\tx\n`); });
await record('A23', 'index v4 refuses', async () => { const fs = await setup(); await put(fs, '/repo/.git/index', index([], 4)); await refused(fs, ['ls-files'], /version/); });
for (const [mask, expected] of [[1, 'DD'], [2, 'AU'], [4, 'UA'], [3, 'UD'], [5, 'DU'], [6, 'AA'], [7, 'UU']]) await record('A24', `conflict mask ${mask}`, async () => { const fs = await setup(); const rows = [1, 2, 3].filter(stage => mask & 1 << stage - 1).map(stage => ({ path: 'conflict', stage, oid: fixture.oids.stagedReadme })); await put(fs, '/repo/.git/index', index(rows)); await good(fs, ['status', '--porcelain', '-uno', '--', 'conflict'], `${expected} conflict\n`); await refused(fs, ['diff', '--', 'conflict'], /unmerged/); });
await record('A25', 'stage0 mixed conflict forbidden', async () => { const fs = await setup(); await put(fs, '/repo/.git/index', index([0, 1].map(stage => ({ path: 'x', stage, oid: fixture.oids.stagedReadme })))); await refused(fs, ['ls-files'], /mixed-stage/); });
await record('A26', 'assume-valid refused', async () => { const fs = await setup(); await put(fs, '/repo/.git/index', index([{ path: 'x', oid: fixture.oids.stagedReadme, flags: 0x8000 }])); await refused(fs, ['ls-files'], /assume-valid/); });
await record('A27', 'optional versus mandatory extension', async () => { const fs = await setup(); const extension = Buffer.from('TEST\0\0\0\0'); await put(fs, '/repo/.git/index', index([], 2, extension)); await good(fs, ['ls-files'], ''); extension[0] = 116; await put(fs, '/repo/.git/index', index([], 2, extension)); await refused(fs, ['ls-files'], /mandatory/); });
await record('A28', 'missing index does not erase HEAD deletions', async () => { const fs = await setup(); await fs.rm('/repo/.git/index'); await good(fs, ['status', '--porcelain', '-uno'], 'D  README.md\nD  obsolete.txt\nD  src/app.txt\n'); });
await record('A29', 'ignored files and normal/all directory expansion', async () => { const fs = await setup(); await put(fs, '/repo/.gitignore', '*.tmp\nignored/\n!keep.tmp\n'); await put(fs, '/repo/trash.tmp', 'x'); await put(fs, '/repo/keep.tmp', 'x'); await put(fs, '/repo/new/deep', 'x'); await put(fs, '/repo/ignored/deep', 'x'); const result = await execute(fs, status); assert.equal(result.code, 0, result.stderr.toString()); assert.match(result.stdout.toString(), /\?\? new\/\n/); assert.doesNotMatch(result.stdout.toString(), /trash|ignored/); assert.match(result.stdout.toString(), /keep.tmp/); const all = await execute(fs, [...status, '-uall']); assert.match(all.stdout.toString(), /new\/deep/); });
await record('A30', 'nested ignore and slash-aware double star', async () => { const fs = await setup(); await put(fs, '/repo/.gitignore', 'new/**/gone\n'); await put(fs, '/repo/new/one/gone', 'x'); await put(fs, '/repo/new/one/keep', 'x'); await good(fs, ['status', '--porcelain', '-uall', '--', 'new'], '?? new/one/keep\n'); });
await record('A31', 'literal magic and -z raw newline paths', async () => { const fs = await setup(); await put(fs, '/repo/x[1]\n', 'x'); await good(fs, ['--literal-pathspecs', 'status', '-z', '--', 'x[1]\n'], '?? x[1]\n\0'); await refused(fs, ['status', '-s', '--', 'x[1]'], /pathspec/, 129); });
await record('A32', 'symlink versus regular is T without following', async () => { const fs = await setup(); await fs.rm('/repo/README.md'); await fs.symlink('/outside', '/repo/README.md'); await good(fs, ['status', '--porcelain', '-uno', '--', 'README.md'], 'MT README.md\n'); });
await record('A33', 'mode changes require truthful permissions', async () => { const fs = await setup(); await put(fs, '/repo/.git/config', '[core]\nfilemode=true\n'); await fs.chmod('/repo/README.md', 0o755); await good(fs, ['status', '--porcelain', '-uno', '--', 'README.md'], 'MM README.md\n'); });
await record('A34', 'active attributes refuse status but raw show works', async () => { const fs = await setup(); await put(fs, '/repo/.gitattributes', '*.txt text\n'); await refused(fs, status, /attributes/); await good(fs, show, 'two\n'); });
await record('A35', 'revision ancestry and absent parent', async () => { const fs = await setup(); await good(fs, ['rev-parse', 'HEAD^'], fixture.oids.baseCommit + '\n'); await good(fs, ['rev-parse', 'HEAD~0'], fixture.oids.headCommit + '\n'); await refused(fs, ['rev-parse', 'HEAD^2'], /parent/); await refused(fs, ['rev-parse', 'HEAD..HEAD'], /unknown|revision/); });
await record('A36', 'annotated tag keeps ID and peels consumer', async () => { const fs = await setup(); const oid = await object(fs, 'tag', `object ${fixture.oids.headCommit}\ntype commit\ntag v1\ntagger A <a@x> 0 +0000\n\nrelease\n`); await put(fs, '/repo/.git/refs/tags/v1', oid + '\n'); await good(fs, ['rev-parse', 'v1'], oid + '\n'); await good(fs, ['rev-parse', 'v1^0'], fixture.oids.headCommit + '\n'); await good(fs, ['show', 'v1:src/app.txt'], 'two\n'); });
await record('A37', 'show path repository relative and traversal refused', async () => { const fs = await setup(); await good(fs, show, 'two\n', 0, { cwd: '/repo/src' }); await refused(fs, ['show', 'HEAD:../README.md'], /path|component/); });
await record('A38', 'log zero and single first parent', async () => { const fs = await setup(); await good(fs, ['log', '--first-parent', '--format=%H', '-n0'], ''); await good(fs, ['log', '--first-parent', '--format=%H', '-n1'], fixture.oids.headCommit + '\n'); });
await record('A39', 'subject refusal versus full hash rendering', async () => { const fs = await setup(); const oid = await object(fs, 'commit', `tree ${fixture.oids.headTree}\nauthor A <a@x> -1 +0000\ncommitter A <a@x> -1 +0000\n\na\nb\n`); await refused(fs, ['log', '--first-parent', '--format=%H %s', oid], /subject/); await good(fs, ['log', '--first-parent', '--format=%H', oid], oid + '\n'); });
await record('A40', 'diff return code and NUL names', async () => { const fs = await setup(); await good(fs, ['diff', '--quiet'], '', 1); await good(fs, ['diff', '--exit-code', '--name-status', '-z'], 'M\0src/app.txt\0', 1); await good(fs, ['diff', 'HEAD', 'HEAD', '--quiet'], ''); });
await record('A41', 'patch exact elementary replacement', async () => { const fs = await setup(); const result = await execute(fs, ['diff', '--full-index', '-U0']); assert.equal(result.code, 0, result.stderr.toString()); const newId = hash('blob', Buffer.from('working\n')); assert.equal(result.stdout.toString(), `diff --git a/src/app.txt b/src/app.txt\nindex f719efd430d52bcfc8566a43b2eb655688d38871..${newId} 100644\n--- a/src/app.txt\n+++ b/src/app.txt\n@@ -1 +1 @@\n-two\n+working\n`); });
await record('A42', 'patch apply no-final-LF/BOM/CR and tied lines', async () => {
  for (const [oldText, newText] of [['a\nb\na\n', 'a\na\nb\n'], ['\ufeffx\r\nlast', '\ufeffy\r\nlast'], ['', 'added'], ['a\nb\nc\nd\ne\n', 'a\nB\nc\nD\ne\n']]) {
    const fs = await setup(), oid = await object(fs, 'blob', oldText); await put(fs, '/repo/.git/index', index([{ path: 'p', oid }])); await put(fs, '/repo/p', newText);
    const result = await execute(fs, ['diff', '-U1']); assert.equal(result.code, 0, result.stderr.toString());
    const patchLines = result.stdout.toString().split('\n'), original = oldText.match(/[^\n]*\n|[^\n]+$/g) ?? [], rebuilt = []; let cursor = 0;
    for (let offset = 0; offset < patchLines.length; offset++) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(patchLines[offset]); if (!match) continue;
      const count = match[2] === undefined ? 1 : Number(match[2]); const start = Number(match[1]) - (count ? 1 : 0);
      rebuilt.push(...original.slice(cursor, start)); cursor = start;
      while (++offset < patchLines.length && !patchLines[offset].startsWith('@@ ')) {
        const row = patchLines[offset]; if (!row || ![' ', '+', '-'].includes(row[0])) break;
        let text = row.slice(1) + '\n'; if (patchLines[offset + 1] === '\\ No newline at end of file') { text = row.slice(1); offset++; }
        if (row[0] !== '+') assert.equal(original[cursor++], text);
        if (row[0] !== '-') rebuilt.push(text);
      }
      offset--;
    }
    rebuilt.push(...original.slice(cursor)); assert.equal(rebuilt.join(''), newText);
  }
});
await record('A43', 'binary names and quiet allowed, patch refusal', async () => { const fs = await setup(); await put(fs, '/repo/src/app.txt', Buffer.from([255, 0])); await good(fs, ['diff', '--name-only'], 'src/app.txt\n'); await good(fs, ['diff', '--quiet'], '', 1); await refused(fs, ['diff'], /UTF-8|binary/); });
await record('A44', 'diff cached and tree to tree', async () => { const fs = await setup(); await good(fs, ['diff', 'HEAD^', 'HEAD', '--name-only'], 'src/app.txt\n'); await good(fs, ['diff', '--cached', 'HEAD', '--name-status'], 'M\tREADME.md\nD\tobsolete.txt\n'); });
await record('A44', 'staged deletion remains deletion when untracked path recreated', async () => { const fs = await setup(); await put(fs, '/repo/obsolete.txt', 'gone\n'); await good(fs, ['diff', 'HEAD', '--name-status', '--', 'obsolete.txt'], 'D\tobsolete.txt\n'); });
await record('A46', 'tracked file and ancestor directory obstructions', async () => { const fs = await setup(); await fs.rm('/repo/src', { recursive: true }); await put(fs, '/repo/src', 'obstruction'); await good(fs, ['status', '--porcelain', '-uno', '--', 'src'], ' D src/app.txt\n'); await fs.rm('/repo/README.md'); await fs.mkdir('/repo/README.md'); await good(fs, ['status', '--porcelain', '-uno', '--', 'README.md'], 'MD README.md\n'); });
await record('A47', 'metadata symlink refuses before target read', async () => { const fs = await setup(); await fs.rename('/repo/.git/config', '/repo/config-elsewhere'); await fs.symlink('/repo/config-elsewhere', '/repo/.git/config'); await refused(fs, show, /symlink/); });
await record('A48', 'actual LCS cap refuses a large changed middle', async () => { const fs = await setup(); const before = Array.from({ length: 1000 }, (_, index) => `old${index}\n`).join(''); const after = Array.from({ length: 1000 }, (_, index) => `new${index}\n`).join(''); const oid = await object(fs, 'blob', before); await put(fs, '/repo/.git/index', index([{ path: 'p', oid }])); await put(fs, '/repo/p', after); await refused(fs, ['diff'], /maxDiffCells/); });
await record('A49', 'decompression expansion limited by declared object length', async () => { const fs = await setup(); await put(fs, '/repo/.git/objects/f7/19efd430d52bcfc8566a43b2eb655688d38871', deflateSync(Buffer.concat([Buffer.from('blob 4\0'), Buffer.alloc(262144)]))); await refused(fs, show, /declared length/); });
await record('A50', 'root and standalone registries require explicit replace', async () => { const host = { commands: new CommandRegistry() }; gitCommands().setup(host); assert.throws(() => gitCommands().setup(host), /registered/); gitCommands({ replace: true }).setup(host); const shell = new Shell({ fs: await setup(), cwd: '/repo' }).use(gitCommands()).use(gitCommands({ replace: true })); try { const result = await shell.exec('git rev-parse --show-toplevel'); assert.equal(result.stdout, '/repo\n'); } finally { await shell.dispose(); } });
await record('A51', 'accessor and unknown option keys refuse without getter execution', async () => { let called = 0; const options = Object.defineProperty({}, 'replace', { get() { called++; return true; } }); assert.throws(() => gitCommands(options)); assert.equal(called, 0); assert.throws(() => createGitCommand({ limits: {} })); assert.throws(() => createGitCommands({ discoveryBoundary: 'relative' })); });
for (const args of [['--version'], ['status'], ['diff', '--stat'], ['log', '--oneline'], ['show'], ['rev-parse', '--verify'], ['status', '--porcelain=v2'], ['diff', '-U101'], ['ls-files', '--others']]) await record('A45', `usage refusal ${args.join(' ')}`, async () => refused(await setup(), args, /Git|M1A/, 129));
for (const key of Object.keys(GIT_LIMITS)) await record('A52', `fixed counter ${key}`, async () => { const session = new Session({ fs: {}, signal: new AbortController().signal, stdout: { write() {} } }, '/'); if (key === 'maxResidentBytes') { session.reserve(GIT_LIMITS[key]); assert.throws(() => session.reserve(1)); } else { session.charge(key, GIT_LIMITS[key]); assert.throws(() => session.charge(key, 1)); } await session.operation.close(); assert.throws(() => createGitCommand({ [key]: 1 })); });
await record('A53', 'oversized source chunk refused before retain', async () => { const fs = await setup(); const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return () => ({ async *[Symbol.asyncIterator]() { yield Buffer.alloc(65537); } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); await refused(source, show, /chunk|size/); });
await record('A54', 'borrowed offset buffers reused on next and return', async () => { const fs = await setup(); const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return file => ({ async *[Symbol.asyncIterator]() { const bytes = await target.readFile(file), allocation = Buffer.alloc(19), borrowed = allocation.subarray(7, 11); try { for (let offset = 0; offset < bytes.length; offset += 4) { borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + 4)); yield borrowed.subarray(0, Math.min(4, bytes.length - offset)); borrowed.fill(239); } } finally { borrowed.fill(255); } } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); await good(source, show, 'two\n'); });
for (const reason of [null, 0, '', { code: 'EACCES' }]) await record('A55', `caller preabort ${JSON.stringify(reason)}`, async () => { const controller = new AbortController(); controller.abort(reason); const result = await execute(await setup(), show, { signal: controller.signal }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); });
await record('A55', 'midread abort awaits reader cleanup', async () => { const fs = await setup(), controller = new AbortController(), reason = { stop: true }; let cleaned = 0; const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return file => ({ async *[Symbol.asyncIterator]() { try { yield (await target.readFile(file)).subarray(0, 1); controller.abort(reason); yield Buffer.alloc(0); } finally { await delay(2); cleaned++; } } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); const result = await execute(source, show, { signal: controller.signal }); assert.equal(result.reason, reason); assert.equal(cleaned, 1); });
for (const reason of [undefined, null, 0, new Error('sink sentinel')]) await record('A56', `sink rejection identity ${String(reason)}`, async () => { const result = await execute(await setup(), show, { stdout: { async write() { throw reason; } } }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); });
await record('A56', 'slow sink writes do not overlap', async () => { let active = 0, max = 0, bytes = ''; const result = await execute(await setup(), ['log', '--first-parent', '--format=%H'], { stdout: { async write(chunk) { active++; max = Math.max(max, active); await delay(2); bytes += Buffer.from(chunk).toString(); active--; } } }); assert.equal(result.code, 0); assert.equal(max, 1); assert.equal(bytes, `${fixture.oids.headCommit}\n${fixture.oids.baseCommit}\n`); });
await record('A56', 'already closed output no input acquisition', async () => { const closed = new AbortController(); closed.abort('consumer'); let writes = 0; const result = await execute(await setup(), show, { stdout: { ownedOutput: { consumerClosed: closed.signal, async write() { writes++; } }, async write() { writes++; } } }); assert.equal(result.code, 141); assert.equal(writes, 0); });
await record('A56', 'consumer closure does not swallow unrelated host failure', async () => { const fs = await setup(), closed = new AbortController(), reason = { unrelated: true }; const source = new Proxy(fs, { get(target, name) { if (name === 'lstat') return async () => { closed.abort('consumer'); throw reason; }; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); const result = await execute(source, show, { stdout: { ownedOutput: { consumerClosed: closed.signal, async write() {} }, async write() {} } }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); });
await record('A56', 'diagnostic sink rejection under original caller is preserved', async () => { const reason = { stderr: true }; const result = await execute(await setup(), ['--version'], { stderr: { async write() { throw reason; } } }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); });
await record('A57', 'reader error wins over failing cleanup without duplicate release', async () => { const fs = await setup(), primary = null, secondary = { cleanup: true }; let releases = 0; const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return () => ({ [Symbol.asyncIterator]() { return { async next() { throw primary; }, async return() { releases++; throw secondary; } }; } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); const result = await execute(source, show); assert.equal(result.rejected, true); assert.equal(result.reason, primary); assert.equal(releases, 1); });
await record('A57', 'cleanup rejection is not successful result', async () => { const fs = await setup(), reason = { cleanup: 1 }; let releases = 0; const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return file => ({ [Symbol.asyncIterator]() { let once = false; return { async next() { if (once) return { done: true }; once = true; return { done: false, value: await target.readFile(file) }; }, async return() { releases++; throw reason; } }; } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); const result = await execute(source, show); assert.equal(result.rejected, true); assert.equal(result.reason, reason); assert.equal(releases, 1); });
await record('A58', 'read-only wrapper workflow', async () => good(createReadOnlyFileSystem(await setup()), show, 'two\n'));
await record('A59', 'changed metadata before output refuses', async () => { const fs = await setup(); let heads = 0; const source = new Proxy(fs, { get(target, name) { if (name === 'readStream') return (file, options) => ({ async *[Symbol.asyncIterator]() { if (file === '/repo/.git/HEAD' && ++heads === 2) await target.writeFile(file, Buffer.from('ref: refs/heads/xxxx\n')); yield* target.readStream(file, options); } }); const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; } }); await refused(source, ['rev-parse', '--absolute-git-dir'], /changed/); });
await record('A60', 'plugin registry and actual shell pipe', async () => { const fs = await setup(); const shell = new Shell({ fs, cwd: '/repo' }).use(agentCommands()).use(gitCommands()); try { const result = await shell.exec('git show HEAD:src/app.txt | cat'); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, 'two\n'); } finally { await shell.dispose(); } assert.equal(createGitCommands().length, 1); });
await record('PUBLIC-NEGATIVE', 'module is not accidentally default/root exported', async () => { const api = await import(leaf('index.js')); assert.equal('gitCommands' in api, false); const packageJson = JSON.parse(await hostFs.readFile(path.join(root, 'package.json'))); assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0); assert.equal(Object.keys(packageJson.optionalDependencies ?? {}).length, 0); assert.equal(packageJson.exports['./commands/git'], undefined); });
const summary = { layout: process.env.GIT_AUTHOR_LAYOUT ?? 'compiled-package', root, cases, pass: cases.filter(row => row.status === 'PASS').length, fail: cases.filter(row => row.status === 'FAIL').length, nativeGitExecutions: 0, qualification: 'Author examples/counter controls, not independent A01-A60 exhaustive closure or native parity' };
await hostFs.writeFile(process.env.GIT_AUTHOR_RESULT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail }));
process.exitCode = summary.fail ? 1 : 0;
