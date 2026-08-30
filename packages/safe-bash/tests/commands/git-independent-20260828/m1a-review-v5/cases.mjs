import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { neutral, small, set, object, addObject, tree, commit, tag, index, checksumIndex, materialize, snapshot, hash } from './fixtures.mjs';

export function makeCases(environment) {
  const cases = [];
  const add = (id, title, body) => cases.push({ id, title, body });
  const get = () => environment;
  const base = () => neutral(get().records);
  const head = files => files.get('.git/refs/heads/main').data.toString().trim();
  const invoke = async (files, args, expected, options = {}) => {
    const { core, api, observations, signal } = get();
    const fixture = await materialize(core, files, options);
    const before = await snapshot(fixture.raw), cleanups = [], stdout = [], stderr = [];
    let outputSize = 0, writes = 0, pending = 0;
    const sink = pieces => ({ async write(bytes) {
      assert.ok(bytes instanceof Uint8Array); assert.equal(pending, 0, 'await sink backpressure'); pending++;
      try { if (options.sink) await options.sink(bytes, pieces === stdout, writes++); outputSize += bytes.length; assert.ok(outputSize <= 4 * 1024 * 1024, 'per-case capture'); pieces.push(Buffer.from(bytes)); } finally { pending--; }
    } });
    const output = sink(stdout);
    if (options.consumer) output.ownedOutput = { consumerClosed: options.consumer.signal, write: output.write };
    const context = {
      command: 'git', args, cwd: options.cwd ?? '/repo', env: { ...(options.env ?? {}) }, fs: fixture.fs,
      stdinIsDefault: true, stdin: { [Symbol.asyncIterator]() { throw new Error('forbidden stdin read'); } },
      stdout: output, stderr: sink(stderr), signal: options.signal ?? signal,
      invoke() { throw new Error('forbidden invocation'); },
      ...(!options.noHook && { registerCleanup(callback) { fixture.register(); cleanups.push(callback); } }),
    };
    let result, failure, thrown = false;
    try { result = await api.createGitCommand(options.commandOptions).execute(context); }
    catch (error) { thrown = true; failure = error; }
    const cleaned = await Promise.allSettled(cleanups.map(callback => callback()));
    const after = await snapshot(fixture.raw);
    const actual = { args, cwd: context.cwd, env: context.env, exitCode: result?.exitCode, thrown, reason: thrown ? { type: failure === null ? 'null' : typeof failure, message: String(failure?.message ?? failure) } : null,
      stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64'), before, after, calls: fixture.calls,
      cleanup: cleaned.map(row => row.status), streams: fixture.streams(), writes, mutations: fixture.mutations };
    observations.push(actual);
    assert.deepEqual(after, before, 'read-only exact namespace/content/modes'); assert.deepEqual(fixture.mutations, []);
    assert.equal(fixture.streams().active, 0, 'all admitted iterators settled'); assert.ok(cleaned.every(row => row.status === 'fulfilled'), 'registered cleanup settled');
    assert.equal(context.cwd, options.cwd ?? '/repo'); assert.deepEqual(context.env, options.env ?? {});
    if (options.reasonPresent) { assert.equal(thrown, true); assert.equal(failure, options.reason); return actual; }
    if (thrown) throw failure;
    assert.equal(result.exitCode, expected.code, `status for ${args.join(' ')}`);
    const outputBytes = Buffer.concat(stdout), errorBytes = Buffer.concat(stderr);
    if (expected.out !== undefined) assert.deepEqual(outputBytes, Buffer.isBuffer(expected.out) ? expected.out : Buffer.from(expected.out), 'exact stdout');
    if (expected.code === 0 || expected.code === 1 || expected.code === 141) assert.equal(errorBytes.length, 0, 'success/difference/consumer-close stderr empty');
    else { assert.ok(errorBytes.length > 0 && errorBytes.length <= 65536, 'bounded refusal diagnostic'); assert.match(errorBytes.toString(), /^git: .+\n$/); }
    if (expected.error) assert.match(errorBytes.toString(), expected.error);
    return actual;
  };
  const refuse = (files, args = ['rev-parse', 'HEAD'], options = {}) => invoke(files, args, { code: 128, out: '' }, options);
  const changed = () => small();
  const status = ['status', '--porcelain=v1', '-uall'];
  const stageEntries = files => {
    const data = files.get('.git/index').data, count = data.readUInt32BE(8); let offset = 12; const entries = [];
    for (let number = 0; number < count; number++) { const zero = data.indexOf(0, offset + 62); entries.push({ path: data.subarray(offset + 62, zero).toString(), oid: data.subarray(offset + 40, offset + 60).toString('hex'), mode: data.readUInt32BE(offset + 24), stage: data.readUInt16BE(offset + 60) >>> 12 & 3 }); offset += Math.ceil((zero - offset + 1) / 8) * 8; }
    return entries;
  };
  for (let number = 1; number <= 6; number++) add(`A0${number}`, 'unchanged neutral project prediction; native UNRUN', async () => {
    const row = get().records.workflows[number - 1];
    await invoke(base(), row.args, { code: row.exitCode, out: Buffer.from(row.stdoutBase64, 'base64') });
  });
  add('A07', 'nested cwd, eight/nine -C, explicit boundary', async () => {
    await invoke(base(), ['rev-parse', '--show-toplevel'], { code: 0, out: '/repo\n' }, { cwd: '/repo/src', commandOptions: { discoveryBoundary: '/repo' } });
    await invoke(base(), [...Array.from({ length: 8 }, () => ['-C', '.']).flat(), 'rev-parse', '--show-toplevel'], { code: 0, out: '/repo\n' });
    await invoke(base(), [...Array.from({ length: 9 }, () => ['-C', '.']).flat(), 'rev-parse', 'HEAD'], { code: 129, out: '' });
    await refuse(base(), ['-C', '..', 'rev-parse', 'HEAD'], { commandOptions: { discoveryBoundary: '/repo' } });
  });
  add('A08', 'gitfiles and metadata symlinks refuse routing', async () => {
    const files = base(); for (const name of [...files.keys()]) if (name.startsWith('.git/')) files.delete(name);
    set(files, '.git', 'gitdir: ../elsewhere\n'); await refuse(files);
    files.set('.git', { link: '/outside', mode: 0o777 }); await refuse(files);
  });
  add('A09', 'named ratification overlay: whole commondir refusal', async () => { const files = base(); set(files, '.git/commondir', '../common\n'); await refuse(files); });
  add('A10', 'bare metadata succeeds, working query refuses', async () => {
    const files = new Map([...base()].filter(([name]) => name.startsWith('.git/')).map(([name, entry]) => [name.slice(5), entry]));
    set(files, 'config', '[core]\nbare = true\n');
    await invoke(files, ['rev-parse', '--is-bare-repository'], { code: 0, out: 'true\n' });
    await invoke(files, ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' });
    await refuse(files, status);
  });
  add('A11', 'detached, unborn and born missing index', async () => {
    const files = base(), oid = head(files); set(files, '.git/HEAD', oid + '\n'); await invoke(files, ['rev-parse', 'HEAD'], { code: 0, out: oid + '\n' });
    const unborn = small([{ path: 'file.txt', before: 'same\n', after: 'same\n' }]); unborn.files.delete('.git/refs/heads/main'); set(unborn.files, '.git/index', index([]));
    await invoke(unborn.files, status, { code: 0, out: '?? file.txt\n' });
    const missing = small([{ path: 'file.txt', before: 'same\n', after: 'same\n' }]); missing.files.delete('.git/index');
    await invoke(missing.files, status, { code: 0, out: 'D  file.txt\n?? file.txt\n' });
  });
  add('A12', 'explicit format0; format1 SHA1 and SHA256 refused', async () => {
    for (const config of ['[core]\nrepositoryformatversion = 1\n[extensions]\nobjectformat = sha1\n', '[extensions]\nobjectformat = sha256\n', '[core]\nrepositoryformatversion = 2\n']) { const files = base(); set(files, '.git/config', config); await refuse(files); }
  });
  add('A13', 'config scalar last-value and unsafe include/escape', async () => {
    const files = base(); set(files, '.git/config', '[CoRe]\nfileMode = true\nfilemode = false\n[user]\nname = "inert # name"\n'); await invoke(files, ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' });
    for (const config of ['[include]\npath = /outside\n', '[user]\nname = "bad\\q"\n', '[core]\nworktree = /outside\n']) { set(files, '.git/config', config); await refuse(files); }
  });
  add('A14', 'all eight frozen routing environment keys', async () => { for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_SYSTEM']) await refuse(base(), ['rev-parse', 'HEAD'], { env: { [key]: '0' } }); });
  add('A15', 'actual pack/idx/promisor/alternate markers', async () => { for (const name of ['objects/pack/pack-x.pack', 'objects/pack/pack-x.idx', 'objects/pack/pack-x.promisor', 'objects/info/alternates', 'objects/info/http-alternates']) { const files = base(); set(files, '.git/' + name, ''); await refuse(files, ['ls-files']); } });
  add('A16', 'shallow/grafts/replace metadata', async () => { for (const name of ['shallow', 'info/grafts', 'refs/replace/' + 'a'.repeat(40)]) { const files = base(); set(files, '.git/' + name, ''); await refuse(files); } });
  add('A17', 'packed refs stale loose precedence and malformed rows', async () => {
    const files = base(), oid = head(files); set(files, '.git/packed-refs', '0'.repeat(40) + ' refs/heads/main\n'); await invoke(files, ['rev-parse', 'HEAD'], { code: 0, out: oid + '\n' });
    for (const content of [`${oid} refs/heads/other\n${oid} refs/heads/other\n`, '^' + oid + '\n', 'broken\n']) { set(files, '.git/packed-refs', content); await refuse(files); }
  });
  add('A18', 'symbolic loops and malformed ref syntax', async () => {
    const files = base(); set(files, '.git/HEAD', 'ref: refs/heads/loop\n'); set(files, '.git/refs/heads/loop', 'ref: refs/heads/loop\n'); await refuse(files);
    for (const ref of ['refs/heads/../main', 'refs/heads/main.lock', 'refs/heads/a\\b']) { set(files, '.git/HEAD', `ref: ${ref}\n`); await refuse(files); }
  });
  add('A19', 'annotated tag identity, nested peel, wrong target type', async () => {
    const files = base(), oid = head(files), first = addObject(files, tag(oid)), second = addObject(files, tag(first, 'tag'));
    set(files, '.git/refs/tags/review', second + '\n'); await invoke(files, ['rev-parse', 'review'], { code: 0, out: second + '\n' });
    await invoke(files, ['log', '--first-parent', '--format=%H', '-n1', 'review'], { code: 0, out: oid + '\n' });
    const bad = addObject(files, tag(oid, 'blob')); set(files, '.git/refs/tags/bad', bad + '\n'); await refuse(files, ['log', '--first-parent', '--format=%H', '-n1', 'bad']);
  });
  add('A20', 'ambiguous shorthand and typed suffixes', async () => {
    const files = base(), oid = head(files); set(files, '.git/refs/tags/main', oid + '\n'); await refuse(files, ['rev-parse', 'main']);
    await invoke(files, ['rev-parse', 'refs/heads/main'], { code: 0, out: oid + '\n' });
    await invoke(files, ['rev-parse', 'HEAD^0'], { code: 0, out: oid + '\n' });
    await refuse(files, ['rev-parse', oid.slice(0, 7)]); await refuse(files, ['rev-parse', 'f'.repeat(40)]);
  });
  add('A21', 'complete loose-name abbreviation collision census', async () => {
    const files = base(), oid = head(files), alternate = oid.slice(0, 7) + (oid[7] === '0' ? '1' : '0') + oid.slice(8);
    set(files, `.git/objects/${alternate.slice(0, 2)}/${alternate.slice(2)}`, 'inert census name');
    const expected = get().records.workflows[4]; const subject = Buffer.from(expected.stdoutBase64, 'base64').toString().split('\n')[0].slice(41);
    await invoke(files, ['log', '--first-parent', '--oneline', '-n1'], { code: 0, out: oid.slice(0, 8) + ' ' + subject + '\n' });
  });
  add('A22', 'literal component-prefix selection and magic refusal', async () => {
    await invoke(base(), ['ls-files', '--', 'src'], { code: 0, out: 'src/app.txt\n' });
    await invoke(base(), ['ls-files', '--', 'src-old'], { code: 0, out: '' });
    await invoke(base(), ['ls-files', '--', ':(glob)*'], { code: 129, out: '' });
  });
  add('A23', 'standard v3 zero extension positive, v4/skip refusal', async () => {
    const files = base(), entries = stageEntries(files); set(files, '.git/index', index(entries.map(entry => ({ ...entry, extended: 0 })), 3)); await invoke(files, ['ls-files', '-z'], { code: 0, out: 'README.md\0src/app.txt\0' });
    set(files, '.git/index', index(entries, 4)); await refuse(files, ['ls-files']);
    set(files, '.git/index', index(entries.map(entry => ({ ...entry, extended: 0x4000 })), 3)); await refuse(files, ['ls-files']);
  });
  add('A24', 'checksum, count, name-length and padding corruption', async () => {
    const original = base().get('.git/index').data;
    for (const mutate of [bytes => { bytes[bytes.length - 1] ^= 1; return bytes; }, bytes => { bytes.writeUInt32BE(1000, 8); return checksumIndex(bytes.subarray(0, -20)); }, bytes => { bytes.writeUInt16BE(1, 72); return checksumIndex(bytes.subarray(0, -20)); }, bytes => bytes.subarray(0, 15)]) { const files = base(); set(files, '.git/index', mutate(Buffer.from(original))); await refuse(files, ['ls-files']); }
  });
  add('A25', 'uppercase optional envelope, split/sparse refusals', async () => {
    const files = base(), entries = stageEntries(files); set(files, '.git/index', index(entries, 2, [['TEST', Buffer.from('untrusted hints')]])); await invoke(files, ['ls-files', '-z'], { code: 0, out: 'README.md\0src/app.txt\0' });
    for (const name of ['link', 'sdir']) { set(files, '.git/index', index(entries, 2, [[name, Buffer.alloc(0)]])); await refuse(files, ['ls-files']); }
  });
  add('A26', 'all seven unmerged masks plus selected diff refusal', async () => {
    for (const [stages, code] of [[[1], 'DD'], [[2], 'AU'], [[3], 'UA'], [[1, 2], 'UD'], [[1, 3], 'DU'], [[2, 3], 'AA'], [[1, 2, 3], 'UU']]) {
      const fixture = changed(); set(fixture.files, '.git/index', index(stages.map(stage => ({ ...fixture.items[0], stage }))));
      await invoke(fixture.files, status, { code: 0, out: code + ' file.txt\n' });
      await refuse(fixture.files, ['diff', '--cached', '--name-only']);
    }
  });
  add('A27', 'duplicate stage, mixed stage and unsafe paths', async () => {
    const fixture = changed(), item = fixture.items[0];
    for (const entries of [[item, item], [{ ...item, stage: 0 }, { ...item, stage: 2 }], [{ ...item, path: '../escape' }], [{ ...item, path: '.git/config' }]]) { set(fixture.files, '.git/index', index(entries)); await refuse(fixture.files, ['ls-files']); }
  });
  add('A28', 'arbitrary raw bytes and empty blobs', async () => { for (const bytes of [Buffer.alloc(0), Buffer.from([0, 255, 128, 10]), Buffer.from('\ufeffBOM\r\n')]) { const fixture = small([{ path: 'file.txt', before: bytes, after: bytes }]); await invoke(fixture.files, ['show', 'HEAD:file.txt'], { code: 0, out: bytes }); } });
  add('A29', 'canonical object framing and filename hash integrity', async () => {
    const fixture = changed(), member = `.git/objects/${fixture.items[0].oid.slice(0, 2)}/${fixture.items[0].oid.slice(2)}`;
    for (const frame of ['blob 07\0before\n', 'blob -1\0', 'blob 8\0before\n', 'blob 6\0before\n', 'blob 7before\n', 'blob 7\0wrong!\n']) { set(fixture.files, member, deflateSync(Buffer.from(frame))); await refuse(fixture.files, ['show', 'HEAD:file.txt']); }
  });
  add('A30', 'zlib truncated/checksum/trailing/second member', async () => {
    const fixture = changed(), member = `.git/objects/${fixture.items[0].oid.slice(0, 2)}/${fixture.items[0].oid.slice(2)}`, original = fixture.files.get(member).data;
    const checksum = Buffer.from(original); checksum[checksum.length - 1] ^= 1;
    for (const compressed of [original.subarray(0, -1), original.subarray(0, 3), checksum, Buffer.concat([original, Buffer.from([0])]), Buffer.concat([original, deflateSync(Buffer.from('blob 0\0'))])]) { set(fixture.files, member, compressed); await refuse(fixture.files, ['show', 'HEAD:file.txt']); }
  });
  add('A31', 'directory-aware tree order and executable/symlink modes', async () => {
    const fixture = changed(), blob = fixture.items[0].oid;
    const child = addObject(fixture.files, tree([{ name: 'item', mode: 0o100644, oid: blob }]));
    const root = addObject(fixture.files, tree([{ name: 'a', mode: 0o40000, oid: child }, { name: 'a.c', mode: 0o100755, oid: blob }, { name: 'link', mode: 0o120000, oid: blob }]));
    const oid = addObject(fixture.files, commit(root)); set(fixture.files, '.git/refs/heads/main', oid + '\n'); await invoke(fixture.files, ['show', 'HEAD:a/item'], { code: 0, out: 'before\n' });
  });
  add('A32', 'wrong tree object type and submodule refusal', async () => {
    const fixture = changed(); const badCommit = addObject(fixture.files, commit(fixture.items[0].oid)); set(fixture.files, '.git/refs/heads/main', badCommit + '\n'); await refuse(fixture.files, ['show', 'HEAD:file.txt']);
    const badTree = addObject(fixture.files, tree([{ name: 'sub', mode: 0o160000, oid: fixture.head }])); const oid = addObject(fixture.files, commit(badTree)); set(fixture.files, '.git/refs/heads/main', oid + '\n'); await refuse(fixture.files, ['show', 'HEAD:sub']);
  });
  add('A33', 'shared subtree DAG remains visible twice', async () => {
    const fixture = changed(), subtree = addObject(fixture.files, tree([{ name: 'item', mode: 0o100644, oid: fixture.items[0].oid }]));
    const root = addObject(fixture.files, tree([{ name: 'left', mode: 0o40000, oid: subtree }, { name: 'right', mode: 0o40000, oid: subtree }]));
    const oid = addObject(fixture.files, commit(root)); set(fixture.files, '.git/refs/heads/main', oid + '\n');
    await invoke(fixture.files, ['show', 'HEAD:left/item'], { code: 0, out: 'before\n' }); await invoke(fixture.files, ['show', 'HEAD:right/item'], { code: 0, out: 'before\n' });
  });
  add('A34', 'actual bytes beat equal stat size/cache', async () => { const fixture = small([{ path: 'file.txt', before: 'aaaa\n', after: 'bbbb\n' }]); await invoke(fixture.files, status, { code: 0, out: ' M file.txt\n' }); });
  add('A35', 'staged deletion plus recreation and obstruction', async () => {
    const fixture = changed(); set(fixture.files, '.git/index', index([])); await invoke(fixture.files, status, { code: 0, out: 'D  file.txt\n?? file.txt\n' });
    const obstruction = changed(); obstruction.files.delete('file.txt'); set(obstruction.files, 'file.txt/child', 'new\n'); await invoke(obstruction.files, status, { code: 0, out: ' D file.txt\n?? file.txt/child\n' });
  });
  add('A36', 'truthful permission capability and executable bit', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same\n', after: 'same\n', mode: 0o100644, workMode: 0o755 }]);
    await invoke(fixture.files, status, { code: 0, out: ' M file.txt\n' }); await refuse(fixture.files, status, { capabilities: { permissions: false } });
    set(fixture.files, '.git/config', '[core]\nfilemode=false\n'); await invoke(fixture.files, status, { code: 0, out: '' }, { capabilities: { permissions: false } });
  });
  add('A37', 'symlink target text, never target traversal', async () => {
    const fixture = small([{ path: 'file.txt', before: '/outside', after: undefined, mode: 0o120000 }]); fixture.files.set('file.txt', { link: '/outside', mode: 0o777 });
    await invoke(fixture.files, status, { code: 0, out: '' }); fixture.files.set('file.txt', { link: '/elsewhere', mode: 0o777 }); await invoke(fixture.files, status, { code: 0, out: ' M file.txt\n' });
  });
  add('A38', 'ignore does not suppress tracked files; nested override', async () => {
    const fixture = small([{ path: 'tracked.tmp', before: 'old', after: 'new' }]); set(fixture.files, '.gitignore', '*.tmp\n'); set(fixture.files, 'hidden.tmp', 'x'); set(fixture.files, 'sub/.gitignore', '!keep.tmp\n'); set(fixture.files, 'sub/keep.tmp', 'x');
    await invoke(fixture.files, status, { code: 0, out: ' M tracked.tmp\n?? .gitignore\n?? sub/.gitignore\n?? sub/keep.tmp\n' });
  });
  add('A39', 'parent-pruning and slash-aware globstar', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same', after: 'same' }]); set(fixture.files, '.gitignore', 'build/\n!build/keep\na/**/b\n'); set(fixture.files, 'build/keep', 'x'); set(fixture.files, 'a/b', 'x'); set(fixture.files, 'a/deep/b', 'x'); set(fixture.files, 'a/deep/c', 'x');
    await invoke(fixture.files, status, { code: 0, out: '?? .gitignore\n?? a/deep/c\n' });
  });
  add('A40', 'symlinked and unsupported active ignore pattern', async () => {
    const files = base(); files.set('.gitignore', { link: '/outside', mode: 0o777 }); await refuse(files, status);
    set(files, '.gitignore', '[[:alpha:]]\n'); await refuse(files, status);
  });
  add('A41', 'all/normal/none untracked grouping and empty dirs', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same', after: 'same' }]); set(fixture.files, 'extra/one', '1'); set(fixture.files, 'extra/two', '2');
    for (const [flag, output] of [['-uno', ''], ['-unormal', '?? extra/\n'], ['-uall', '?? extra/one\n?? extra/two\n']]) await invoke(fixture.files, ['status', '--porcelain=v1', flag], { code: 0, out: output }, { directories: ['empty'] });
  });
  add('A42', 'raw NUL names and Git C quoting', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same', after: 'same' }]); set(fixture.files, 'tab\tname', 'x'); set(fixture.files, 'é', 'x');
    await invoke(fixture.files, ['status', '--porcelain=v1', '-z', '-uall'], { code: 0, out: '?? tab\tname\0?? é\0' });
    await invoke(fixture.files, status, { code: 0, out: '?? "tab\\tname"\n?? "\\303\\251"\n' });
  });
  add('A43', 'active attributes refuse comparisons but raw unchanged', async () => {
    const files = base(); set(files, '.gitattributes', '* text\n'); await refuse(files, status); await invoke(files, ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' });
  });
  add('A44', 'working/cached/one/two REV comparison sides', async () => {
    const fixture = changed(); await invoke(fixture.files, ['diff', '--name-status'], { code: 0, out: 'M\tfile.txt\n' });
    await invoke(fixture.files, ['diff', '--cached', '--name-status'], { code: 0, out: '' });
    await invoke(fixture.files, ['diff', '--name-status', 'HEAD'], { code: 0, out: 'M\tfile.txt\n' });
    await invoke(fixture.files, ['diff', '--name-status', 'HEAD', 'HEAD'], { code: 0, out: '' });
  });
  add('A45', 'independent applicable U0 text patch with CR/BOM/noLF', async () => {
    const before = '\ufeffone\r\nold', after = '\ufeffone\r\nnew'; const fixture = small([{ path: 'file.txt', before, after }]);
    const actual = await invoke(fixture.files, ['diff', '--full-index', '-U0'], { code: 0 });
    const patch = Buffer.from(actual.stdoutBase64, 'base64').toString();
    assert.match(patch, /@@ -2(?:,1)? \+2(?:,1)? @@/); assert.match(patch, /-old\n\\ No newline at end of file\n\+new\n\\ No newline at end of file\n/);
    const reconstructed = before.replace(/old$/, patch.match(/\n\+([^\n]+)\n\\ No newline/)[1]); assert.equal(reconstructed, after);
    await invoke(fixture.files, ['diff', '-U101'], { code: 129, out: '' });
  });
  add('A46', 'cumulative LCS budget across two finite files', async () => {
    const old = Array.from({ length: 710 }, (_, number) => 'old-' + number).join('\n') + '\n', current = Array.from({ length: 710 }, (_, number) => 'new-' + number).join('\n') + '\n';
    const fixture = small([{ path: 'one', before: old, after: current }, { path: 'two', before: old, after: current }]);
    await invoke(fixture.files, ['diff', '-U0'], { code: 128, error: /maxDiffCells/ });
  });
  add('A47', 'late NUL and invalid UTF8 names/quiet versus text', async () => {
    for (const bytes of [Buffer.concat([Buffer.alloc(8193, 65), Buffer.from([0])]), Buffer.from([255, 254])]) { const fixture = small([{ path: 'file.txt', before: bytes, after: Buffer.concat([bytes, Buffer.from('x')]) }]); await invoke(fixture.files, ['diff', '--name-only'], { code: 0, out: 'file.txt\n' }); await invoke(fixture.files, ['diff', '--quiet'], { code: 1, out: '' }); await refuse(fixture.files, ['diff']); }
  });
  add('A48', 'difference statuses and unsupported switches', async () => {
    const fixture = changed(); await invoke(fixture.files, ['diff', '--exit-code', '--name-only'], { code: 1, out: 'file.txt\n' });
    for (const flag of ['--binary', '--raw', '--no-index', '-M']) await invoke(fixture.files, ['diff', flag], { code: 129, out: '' });
  });
  add('A49', 'first-parent count zero and missing later parent', async () => {
    const fixture = changed(); await invoke(fixture.files, ['log', '--first-parent', '--format=%H', '-n0'], { code: 0, out: '' });
    const oid = addObject(fixture.files, commit(fixture.root, ['f'.repeat(40)])); set(fixture.files, '.git/refs/heads/main', oid + '\n');
    await invoke(fixture.files, ['log', '--first-parent', '--format=%H', '-n2'], { code: 128, out: oid + '\n' });
    await invoke(fixture.files, ['log', '--format=%H'], { code: 129, out: '' });
  });
  add('A50', 'unsupported commit subject versus full hash', async () => {
    const fixture = changed(), oid = addObject(fixture.files, commit(fixture.root, [], 'one\ntwo\n')); set(fixture.files, '.git/refs/heads/main', oid + '\n');
    await invoke(fixture.files, ['log', '--first-parent', '--format=%H', '-n1'], { code: 0, out: oid + '\n' }); await refuse(fixture.files, ['log', '--first-parent', '--format=%H %s', '-n1']);
  });
  add('A51', 'argument count/bytes and invalid public option domain', async () => {
    await invoke(base(), Array(129).fill('x'), { code: 129, out: '' }); await invoke(base(), ['x'.repeat(65537)], { code: 129, out: '' });
    for (const options of [{ limits: {} }, { replace: 1 }, { discoveryBoundary: 'relative' }]) assert.throws(() => get().api.createGitCommand(options), TypeError);
    let called = false; assert.throws(() => get().api.createGitCommand({ get replace() { called = true; return false; } }), TypeError); assert.equal(called, false);
  });
  add('A52', 'fixed counter edges include resident and cumulative domains', async () => {
    const { Session, limits } = get().internals;
    const context = { signal: get().signal, stdout: { async write() {} }, registerCleanup() {} };
    for (const name of ['maxReadBytes', 'maxInflatedBytes', 'maxObjects', 'maxCommits', 'maxSteps', 'maxLines', 'maxDiffCells', 'maxChunks', 'maxOutputBytes']) { const session = new Session(context, '/'); session.charge(name, limits[name]); assert.throws(() => session.charge(name, 1)); await session.operation.close(); }
    const session = new Session(context, '/'); session.reserve(limits.maxResidentBytes); assert.throws(() => session.reserve(1)); session.unreserve(limits.maxResidentBytes); await session.operation.close();
  });
  add('A53', 'provider oversized chunks and empty chunk count', async () => {
    await refuse(base(), ['show', 'HEAD:src/app.txt'], { stream: async function* () { yield Buffer.alloc(65537); } });
    await refuse(base(), ['show', 'HEAD:src/app.txt'], { stream: async function* () { for (let count = 0; count < 32769; count++) yield Buffer.alloc(0); } });
  });
  add('A54', 'borrowed nonzero-offset buffers reused through finalization', async () => {
    await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { stream: async function* (original) {
      const borrowed = Buffer.alloc(25), view = borrowed.subarray(3, 20);
      for await (const chunk of original) for (let offset = 0; offset < chunk.length; offset += view.length) { const width = Math.min(view.length, chunk.length - offset); view.fill(0); view.set(chunk.subarray(offset, offset + width)); yield view.subarray(0, width); view.fill(255); }
      view.fill(128);
    } });
  });
  add('A55', 'caller abort identities and midread cancellation', async () => {
    for (const reason of [null, 0, { code: 'ENOENT', purpose: 'abort' }]) { const controller = new AbortController(); controller.abort(reason); await invoke(base(), ['show', 'HEAD:src/app.txt'], {}, { signal: controller.signal, reasonPresent: true, reason }); }
    const controller = new AbortController(), reason = { code: 'EIO', purpose: 'midread' };
    await invoke(base(), ['show', 'HEAD:src/app.txt'], {}, { signal: controller.signal, reasonPresent: true, reason, stream: async function* (original) { for await (const chunk of original) { controller.abort(reason); yield chunk; } } });
  });
  add('A56', 'slow and rejected sink identities; consumer closure', async () => {
    await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { sink: async () => delay(2) });
    const reason = { sink: 'independent failure' }; await invoke(base(), ['show', 'HEAD:src/app.txt'], {}, { sink() { throw reason; }, reasonPresent: true, reason });
    const controller = new AbortController(); controller.abort('closed'); const result = await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 141, out: '' }, { consumer: controller }); assert.equal(result.calls.length, 0);
  });
  add('A57', 'direct host no registration hook still finalizes readers', async () => { await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { noHook: true }); });
  add('A58', 'actual read-only wrapper and alias namespace refusal', async () => {
    await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { readonly: true });
    await refuse(base(), ['rev-parse', 'HEAD'], { intercept(name, args) { if (name === 'realpath' && args[0] === '/repo/.git') return { handled: true, value: '/foreign/.git' }; } });
  });
  add('A59', 'typed unreadable metadata remains error not clean', async () => {
    const { core } = get(); await refuse(base(), ['rev-parse', 'HEAD'], { intercept(name, args) { if (name === 'lstat' && args[0] === '/repo/.git/config') throw new core.FsError('EACCES', { path: args[0] }); } });
  });
  add('A60', 'actual Shell pipeline optional plugin and no defaults drift', async () => {
    const { core, api } = get(), fixture = await materialize(core, base(), { noHook: true });
    const shell = new core.Shell({ fs: fixture.fs, cwd: '/repo' }); shell.use(core.agentCommands()); shell.use(api.gitCommands());
    try { const result = await shell.exec('git show HEAD:src/app.txt | cat'); get().observations.push({ shell: true, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'two\n'); assert.equal(result.stderr, ''); }
    finally { await shell.dispose(); }
    assert.equal(core.createAgentCommands().length, 78); assert.equal(Object.hasOwn(core, 'createGitCommand'), false);
  });
  add('H01', 'realistic empty canonical objects/pack and info positive', async () => { await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { directories: ['.git/objects/pack', '.git/objects/info'] }); });
  add('H02', 'packed refs only remains supported without loose branch', async () => { const files = base(), oid = head(files); files.delete('.git/refs/heads/main'); set(files, '.git/packed-refs', '# pack-refs with: peeled fully-peeled sorted\n' + oid + ' refs/heads/main\n'); await invoke(files, ['rev-parse', 'HEAD'], { code: 0, out: oid + '\n' }); });
  add('H03', 'tracked regular-to-symlink type change', async () => { const fixture = changed(); fixture.files.set('file.txt', { link: 'before\n', mode: 0o777 }); await invoke(fixture.files, status, { code: 0, out: ' T file.txt\n' }); });
  add('H04', 'escaped ignore space/hash/bang and bracket/question', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same', after: 'same' }]); set(fixture.files, '.gitignore', '\\#name\n\\!name\nspace\\ \n[ab]?.tmp\n'); for (const name of ['#name', '!name', 'space ', 'a1.tmp', 'c1.tmp']) set(fixture.files, name, 'x');
    await invoke(fixture.files, status, { code: 0, out: '?? .gitignore\n?? c1.tmp\n' });
  });
  add('H05', 'strict Unicode blob text rejection separate from raw', async () => {
    const bytes = Buffer.from([0xed, 0xa0, 0x80]), fixture = small([{ path: 'file.txt', before: bytes, after: 'text' }]);
    await invoke(fixture.files, ['show', 'HEAD:file.txt'], { code: 0, out: bytes }); await refuse(fixture.files, ['diff']);
  });
  add('H06', 'unknown executable metadata omitted not inferred', async () => {
    const fixture = small([{ path: 'file.txt', before: 'same', after: 'same' }]);
    await refuse(fixture.files, status, { capabilities: { permissions: undefined } });
  });
  add('H07', 'mandatory index unknown lowercase and stale optional TREE', async () => {
    const files = base(), entries = stageEntries(files); set(files, '.git/index', index(entries, 2, [['TREE', Buffer.from('false clean')]])); await invoke(files, ['diff', '--name-only'], { code: 0, out: 'src/app.txt\n' });
    set(files, '.git/index', index(entries, 2, [['zzzz', Buffer.alloc(0)]])); await refuse(files, ['ls-files']);
  });
  add('H08', 'public factories export shape, collision and replacement', async () => {
    const { api, core } = get(); assert.deepEqual(Object.keys(api).sort(), ['createGitCommand', 'createGitCommands', 'gitCommands']);
    const registry = new core.CommandRegistry(); const host = { commands: registry, use() { throw new Error('unexpected middleware'); }, registerFileSystem() { throw new Error('unexpected filesystem'); } };
    api.gitCommands().setup(host); assert.deepEqual(registry.list().map(command => command.name), ['git']); assert.throws(() => api.gitCommands().setup(host)); api.gitCommands({ replace: true }).setup(host);
  });
  add('H09', 'object cap declared before expansion allocation', async () => {
    const fixture = changed(), member = `.git/objects/${fixture.items[0].oid.slice(0, 2)}/${fixture.items[0].oid.slice(2)}`;
    set(fixture.files, member, deflateSync(Buffer.from('blob 8388609\0'))); await refuse(fixture.files, ['show', 'HEAD:file.txt']);
  });
  add('H10', 'bounded malformed provider size and early file budget', async () => {
    await refuse(base(), ['show', 'HEAD:src/app.txt'], { intercept: async (name, args, target) => name === 'lstat' && args[0].endsWith('/config') ? { handled: true, value: { ...await target.lstat(...args), size: 1048577 } } : undefined });
  });
  add('H11', 'owned Real adapter bytes/modes/readonly effects', async () => {
    const { core, realRoot } = get();
    await invoke(base(), ['show', 'HEAD:src/app.txt'], { code: 0, out: 'two\n' }, { real: new core.RealFileSystem({ root: realRoot }) });
  });
  return cases;
}
