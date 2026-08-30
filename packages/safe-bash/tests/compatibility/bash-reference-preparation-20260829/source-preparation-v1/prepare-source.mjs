import { lstat, readFile, writeFile, mkdir, mkdtemp, open, readdir, realpath, unlink, chmod, symlink, link, readlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, posix } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const parent = fileURLToPath(new URL('../', import.meta.url));
const began = performance.now();
const deadline = began + 900000;
const output = root + 'RUN-01/';
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', { at: new Date().toISOString(), role: 'SOURCE_DATA_ONLY', maxNativeChildren: 23, deadlineMs: 900000, network: false });
let work = null;
let starts = 0;
let captured = 0;
let ownedClosed = true;
const children = [];
const patchResults = [];
const guard = () => assert(performance.now() < deadline, 'CONTROLLER_DEADLINE');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = async pathname => {
  const status = await lstat(pathname);
  assert(status.isFile() && !status.isSymbolicLink() && status.size <= 4 * 1024 * 1024, 'TEXT_ADMISSION');
  return readFile(pathname, 'utf8');
};
const identify = async pathname => {
  guard();
  const status = await lstat(pathname);
  assert(status.isFile() && !status.isSymbolicLink(), 'REGULAR_IDENTITY');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname, { highWaterMark: 65536 })) { guard(); hash.update(chunk); }
  return { path: pathname, bytes: status.size, mode: (status.mode & 0o7777).toString(8), sha256: hash.digest('hex') };
};
const check = async row => {
  const actual = await identify(row.resolved ?? row.path);
  for (const key of ['bytes', 'mode', 'sha256']) assert.equal(actual[key], row[key], `IDENTITY_${key}:${row.path}`);
  return actual;
};
const boundedPath = pathname => {
  assert(pathname.length > 0 && Buffer.byteLength(pathname) <= 1024);
  assert(/^[\x20-\x7e]+$/.test(pathname) && !pathname.includes('\\') && !pathname.startsWith('/'));
  assert(pathname.split('/').every(part => part && part !== '.' && part !== '..'), 'UNSAFE_COMPONENT');
  assert(!pathname.split('/').some(part => /[ .]$/.test(part)), 'ALIAS_COMPONENT');
  return pathname;
};
const excluded = pathname => pathname.split('/').some(part => part.toLowerCase() === 'agents.md');
const native = async (id, tool, argv, cwd) => {
  guard();
  assert(++starts <= 23);
  await check(tool);
  const folder = output + id + '/';
  await mkdir(folder, { mode: 0o700 });
  await mkdir(folder + 'home', { mode: 0o700 });
  await mkdir(folder + 'tmp', { mode: 0o700 });
  await mkdir(folder + 'empty-bin', { mode: 0o700 });
  const env = { HOME: folder + 'home', TMPDIR: folder + 'tmp', PATH: folder + 'empty-bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  await save(id + '/ADMISSION.json', { tool, argv, cwd, env, deadlineMs: 10000, streamCap: 1048576 });
  const stdout = await open(folder + 'stdout.raw', 'wx', 0o600);
  const stderr = await open(folder + 'stderr.raw', 'wx', 0o600);
  const buffers = [[], []];
  const lengths = [0, 0];
  let failure = null;
  let child;
  let closeTimer;
  let timer;
  let retirementTimer;
  let closed = false;
  const events = [];
  const start = performance.now();
  const terminate = message => {
    failure ??= message;
    if (child?.pid && !closed) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error.message; }
    }
    closeTimer ??= setTimeout(() => { if (!closed) { ownedClosed = false; failure = 'UNKNOWN_RETIREMENT'; } }, 1000);
  };
  try {
    child = spawn(tool.resolved ?? tool.path, argv, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    events.push({ event: 'spawn-request', pid: child.pid ?? null });
    timer = setTimeout(() => terminate('CHILD_DEADLINE'), Math.min(10000, Math.max(1, deadline - performance.now())));
    const consume = async (stream, handle, index) => {
      for await (const bytes of stream) {
        captured += bytes.length;
        lengths[index] += bytes.length;
        if (lengths[index] > 1048576 || captured > 32 * 1024 * 1024) { terminate('CAPTURE_CAP'); continue; }
        await handle.write(bytes);
        buffers[index].push(Buffer.from(bytes));
      }
    };
    const consumption = Promise.all([consume(child.stdout, stdout, 0), consume(child.stderr, stderr, 1)]);
    const disposition = await new Promise((fulfill, reject) => {
      retirementTimer = setTimeout(() => { if (!closed) { terminate('UNKNOWN_RETIREMENT'); ownedClosed = false; reject(new Error('UNKNOWN_RETIREMENT')); } }, Math.min(11000, Math.max(1, deadline - performance.now())));
      child.once('error', error => { failure = error.message; events.push({ event: 'error', message: error.message }); });
      child.once('exit', (code, signal) => events.push({ event: 'exit', code, signal, ms: performance.now() - start }));
      child.once('close', (code, signal) => { closed = true; events.push({ event: 'close', code, signal, ms: performance.now() - start }); fulfill({ code, signal }); });
      consumption.catch(error => { terminate(error.message); reject(error); });
    });
    await consumption;
    const result = { id, disposition, events, lengths, elapsedMs: performance.now() - start, closed, failure };
    children.push(result);
    await save(id + '/CHILD.json', result);
    assert(!failure && closed && disposition.code === 0 && disposition.signal === null, 'CHILD_REFUSAL:' + id);
    return { ...result, stdout: Buffer.concat(buffers[0]).toString('utf8'), stderr: Buffer.concat(buffers[1]).toString('utf8') };
  } finally {
    clearTimeout(timer);
    clearTimeout(retirementTimer);
    clearTimeout(closeTimer);
    if (child?.pid && !closed) { terminate('UNFINISHED_CHILD'); ownedClosed = false; }
    await stdout.close(); await stderr.close();
    await check(tool);
  }
};

try {
  const seal = JSON.parse(await text(root + 'EXECUTION-SEAL.json'));
  for (const row of seal.inputs) await check(row);
  const plan = JSON.parse(await text(parent + 'verification-v2/plan-r2.json'));
  const signed = JSON.parse(await text(parent + 'verification-v2/RUN-02/RESULT.json'));
  const tools = JSON.parse(await text(root + 'TOOLS.json'));
  assert.equal(signed.attributedValid, 16);
  assert.equal(signed.literalRefusals, 0);
  assert.equal(signed.childrenClosed, 17);
  assert.equal(plan.authoritativePrimary, '7C0135FB088AAF6C66C650B9BB5869F064EA74AB');
  const identities = [...plan.acquiredArtifacts, ...plan.authorityArtifacts, ...plan.closure, plan.node];
  for (const row of identities) await check(row);
  for (const pair of plan.pairs) {
    const outcome = JSON.parse(await text(parent + 'verification-v2/RUN-02/' + pair.id + '/OUTCOME.json'));
    const raw = await text(parent + 'verification-v2/RUN-02/' + pair.id + '/stdout.raw');
    assert.deepEqual(outcome.payload, pair.payload);
    assert.deepEqual(outcome.signature, pair.signature);
    assert.equal(outcome.exit.code, 0);
    assert.equal(outcome.classification, 'VALID_SIGNATURE_WITH_SOURCE_ATTRIBUTED_PRIMARY');
    assert.equal(outcome.validSignatures.length, 1);
    assert.equal(outcome.validSignatures[0].signingFingerprint, plan.authoritativePrimary);
    assert.equal(outcome.validSignatures[0].primaryFingerprintField, plan.authoritativePrimary);
    assert.deepEqual(outcome.adverse, []);
    assert.equal(raw.trim(), outcome.machine.map(row => row.raw).join('\n'));
    const child = signed.children.find(row => row.id === pair.id);
    assert(child.ownedClosed);
    for (const channel of ['stdout', 'stderr']) {
      const status = await lstat(parent + 'verification-v2/RUN-02/' + pair.id + '/' + channel + '.raw');
      assert.equal(status.size, child.lengths[channel], 'RAW_CAPTURE_COMPLETENESS');
    }
  }
  await save('INPUT-ADMISSION.json', { reauthenticated: identities.length, pairs: 16, completeRawCapturePairs: 16, primary: plan.authoritativePrimary, signatureCommit: seal.signatureCommit, gitRows: seal.gitRows });
  work = await mkdtemp('/tmp/safe-bash-reference-source-20260829-');
  await chmod(work, 0o700);
  await save('WORK-OWNERSHIP.json', { path: work, creation: 'EXCLUSIVE_MKDTEMP', retainedSourceData: true, sourceExecution: false });
  const reader = tools.tools.find(row => row.path.endsWith('/llvm-otool'));
  const metaTargets = ['/usr/bin/patch', '/bin/sh', '/Library/Developer/CommandLineTools/usr/bin/clang', '/Library/Developer/CommandLineTools/usr/bin/make', '/Library/Developer/CommandLineTools/usr/bin/ld', '/Library/Developer/CommandLineTools/usr/bin/ar', '/Library/Developer/CommandLineTools/usr/bin/ranlib', reader.path];
  const dependencies = [];
  for (let index = 0; index < metaTargets.length; index++) {
    const target = tools.tools.find(row => row.path === metaTargets[index]);
    await check(target);
    const child = await native('META-' + String(index + 1).padStart(2, '0'), reader, ['-L', target.resolved], work);
    dependencies.push({ target, dependencies: child.stdout, metadataOnly: true });
  }
  const patchLibraries = dependencies[0].dependencies.split('\n').slice(1).filter(line => line.trim()).map(line => line.trim().split(' (')[0]);
  assert(patchLibraries.length > 0 && patchLibraries.every(pathname => pathname.startsWith('/usr/lib/') || pathname.startsWith('/System/Library/')), 'PATCH_EXTERNAL_LOADER_DEPENDENCY');
  const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
  const sdkResolved = await realpath(sdk);
  assert((await lstat(sdkResolved)).isDirectory());
  await save('BUILD-DEPENDENCIES.json', { dependencies, sdk: { path: sdk, resolved: sdkResolved, contentsAdmitted: false }, patchSystemCacheIdentityChecked: true, dynamicClosureClaim: false, explanation: 'Direct load commands only; complete compiler/linker/SDK/bootstrap runtime closure and provider fence remain unqualified.' });
  const tarpath = work + '/base.tar.data';
  let inflated = 0;
  await pipeline(createReadStream(plan.pairs[0].payload.path), createGunzip(), new Transform({ transform(bytes, encoding, callback) { inflated += bytes.length; if (inflated > 128 * 1024 * 1024 || performance.now() >= deadline) callback(new Error('TAR_INFLATE_BOUND')); else callback(null, bytes); } }), createWriteStream(tarpath, { flags: 'wx', mode: 0o600 }));
  assert.equal(inflated % 512, 0);
  const tar = await open(tarpath, 'r');
  const rows = [];
  const names = new Map();
  let offset = 0;
  let aggregate = 0;
  let longName = null;
  let longLink = null;
  let terminated = false;
  const exact = async (length, position) => { const bytes = Buffer.alloc(length); const result = await tar.read(bytes, 0, length, position); assert.equal(result.bytesRead, length); return bytes; };
  const field = bytes => { const zero = bytes.indexOf(0); const end = zero < 0 ? bytes.length : zero; if (zero >= 0) assert(bytes.subarray(zero).every(value => value === 0)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); };
  const octal = bytes => { const value = bytes.toString('ascii').replace(/[\0 ]+$/g, '').replace(/^ +/, ''); assert(/^[0-7]*$/.test(value)); const number = value ? Number.parseInt(value, 8) : 0; assert(Number.isSafeInteger(number) && number >= 0); return number; };
  try {
    while (offset < inflated) {
      guard();
      const header = await exact(512, offset);
      if (header.every(value => value === 0)) {
        assert(!longName && !longLink && inflated - offset >= 1024);
        for (let position = offset; position < inflated; position += 512) assert((await exact(512, position)).every(value => value === 0), 'TRAILING_TAR_DATA');
        terminated = true; break;
      }
      const checksum = octal(header.subarray(148, 156));
      const computed = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
      assert.equal(checksum, computed, 'TAR_CHECKSUM');
      const size = octal(header.subarray(124, 136));
      const mode = octal(header.subarray(100, 108));
      assert(size <= 16 * 1024 * 1024 && !(mode & 0o7000));
      const type = String.fromCharCode(header[156] || 48);
      const payloadOffset = offset + 512;
      const next = payloadOffset + Math.ceil(size / 512) * 512;
      assert(next <= inflated);
      if (size % 512) assert((await exact(512 - size % 512, payloadOffset + size)).every(value => value === 0), 'NONZERO_PADDING');
      if (type === 'L' || type === 'K') {
        assert(size > 0 && size <= 1024);
        const value = field(await exact(size, payloadOffset));
        if (type === 'L') { assert(longName === null); longName = value; } else { assert(longLink === null); longLink = value; }
        offset = next; continue;
      }
      assert(['0', '1', '2', '5'].includes(type), 'UNSUPPORTED_TAR_TYPE:' + type);
      const magic = header.subarray(257, 263).toString('ascii');
      assert(magic === 'ustar\0' || magic === 'ustar ', 'UNSUPPORTED_TAR_FORMAT');
      const prefix = magic === 'ustar\0' ? field(header.subarray(345, 500)) : '';
      const rawname = longName ?? (prefix ? prefix + '/' : '') + field(header.subarray(0, 100));
      const pathname = boundedPath(type === '5' && rawname.endsWith('/') ? rawname.slice(0, -1) : rawname);
      const target = longLink ?? field(header.subarray(157, 257));
      longName = null; longLink = null;
      assert(pathname === 'bash-5.3' || pathname.startsWith('bash-5.3/'));
      assert(!names.has(pathname.toLowerCase()), 'PATH_ALIAS_OR_DUPLICATE');
      assert(type === '0' || size === 0);
      aggregate += type === '0' ? size : 0;
      assert(aggregate <= 96 * 1024 * 1024 && rows.length < 10000);
      const hash = createHash('sha256');
      if (type === '0' && size) for await (const bytes of createReadStream(tarpath, { start: payloadOffset, end: payloadOffset + size - 1 })) hash.update(bytes);
      const row = { path: pathname, type, size, originalMode: mode.toString(8), payloadOffset, sha256: type === '0' ? hash.digest('hex') : null, link: target || null, excludedInstructionName: excluded(pathname) };
      rows.push(row); names.set(pathname.toLowerCase(), row); offset = next;
    }
    assert(terminated && rows.length > 0);
    for (const row of rows) {
      let ancestor = posix.dirname(row.path);
      while (ancestor !== '.') { assert.equal(names.get(ancestor.toLowerCase())?.type, '5', 'NON_DIRECTORY_ANCESTOR'); ancestor = posix.dirname(ancestor); }
      if (row.type === '1' || row.type === '2') {
        boundedPath(row.link);
        row.resolvedLink = row.type === '1' ? row.link : posix.join(posix.dirname(row.path), row.link);
        assert(row.resolvedLink.startsWith('bash-5.3/'));
        assert.equal(names.get(row.resolvedLink.toLowerCase())?.type, '0', 'LINK_MUST_TARGET_REGULAR_MEMBER');
        assert(!excluded(row.resolvedLink));
      }
    }
    await save('ARCHIVE-INVENTORY.json', { compressed: plan.pairs[0].payload, tar: await identify(tarpath), members: rows.length, aggregateRegularBytes: aggregate, excluded: rows.filter(row => row.excludedInstructionName).length, rows });
    for (const row of rows.filter(row => row.type === '5').sort((left, right) => left.path.length - right.path.length)) if (!row.excludedInstructionName) await mkdir(work + '/' + row.path, { mode: 0o700 });
    for (const row of rows.filter(row => row.type === '0')) {
      if (row.excludedInstructionName) continue;
      const destination = work + '/' + row.path;
      if (row.size === 0) await writeFile(destination, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      else await pipeline(createReadStream(tarpath, { start: row.payloadOffset, end: row.payloadOffset + row.size - 1 }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
      assert.equal((await identify(destination)).sha256, row.sha256);
    }
    for (const row of rows.filter(row => row.type === '1' || row.type === '2')) {
      if (row.excludedInstructionName) continue;
      if (row.type === '1') await link(work + '/' + row.resolvedLink, work + '/' + row.path);
      else await symlink(row.link, work + '/' + row.path);
    }
  } finally { await tar.close(); }
  await unlink(tarpath);
  const source = work + '/bash-5.3';
  const patchTool = tools.tools.find(row => row.path === '/usr/bin/patch');
  const patchPaths = JSON.parse(await text(root + 'PATCH-PATHS.json'));
  for (let index = 0; index < patchPaths.length; index++) {
    const paths = patchPaths[index];
    const pair = plan.pairs[index + 1];
    await check(pair.payload); await check(pair.signature);
    assert.equal(pair.payload.sha256, paths.sha256);
    const targets = [];
    for (let header = 0; header < paths.headers.length; header += 2) {
      const old = paths.headers[header].header;
      const next = paths.headers[header + 1].header;
      assert(old.startsWith('*** ../') && next.startsWith('--- '));
      const target = boundedPath(next.slice(4));
      assert(!excluded(target));
      assert(['*** ../bash-5.3/', '*** ../bash-5.3-patched/', '*** ../bash-20250807/'].some(prefix => old === prefix + target));
      const oldPath = resolve(source, old.slice(4));
      assert(oldPath.startsWith(work + '/'));
      if (oldPath !== source + '/' + target) { try { await lstat(oldPath); assert.fail('OLD_HEADER_ALTERNATE_EXISTS'); } catch (error) { assert.equal(error.code, 'ENOENT'); } }
      assert.equal(names.get(('bash-5.3/' + target).toLowerCase())?.type, '0');
      targets.push({ path: target, before: await identify(source + '/' + target) });
    }
    const expectedBefore = `#define PATCHLEVEL ${index}`;
    assert((await text(source + '/patchlevel.h')).includes(expectedBefore));
    const argv = ['-s', '-f', '-F', '0', '-p0', '--posix', '-d', source, '-i', pair.payload.path];
    const child = await native(pair.name, patchTool, argv, source);
    assert((await text(source + '/patchlevel.h')).includes(`#define PATCHLEVEL ${index + 1}`));
    for (const target of targets) target.after = await identify(source + '/' + target.path);
    const result = { name: pair.name, signedPayload: pair.payload, argv, status: child.disposition, targets };
    patchResults.push(result); await save(pair.name + '/PATCH-RESULT.json', result);
  }
  const finalRows = [];
  const walk = async directory => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const pathname = directory + '/' + entry.name;
      const relativePath = relative(work, pathname).split('\\').join('/');
      assert(!excluded(relativePath));
      const original = names.get(relativePath.toLowerCase());
      assert(original && original.path === relativePath, 'UNEXPECTED_SOURCE_ENTRY');
      if (entry.isDirectory()) { finalRows.push({ path: relativePath, type: '5', mode: '700' }); await walk(pathname); }
      else if (entry.isFile()) { const row = await identify(pathname); finalRows.push({ ...row, path: relativePath, type: original.type, originalMode: original.originalMode }); }
      else if (entry.isSymbolicLink()) { assert.equal(original.type, '2'); assert.equal(await readlink(pathname), original.link); finalRows.push({ path: relativePath, type: '2', mode: ((await lstat(pathname)).mode & 0o777).toString(8), link: original.link }); }
      else assert.fail('FINAL_UNSUPPORTED_LINK_OR_SPECIAL');
    }
  };
  await walk(source);
  const expectedCount = rows.filter(row => !row.excludedInstructionName && row.path !== 'bash-5.3').length;
  assert.equal(finalRows.length, expectedCount);
  const allowedChanges = new Set(patchResults.flatMap(row => row.targets.map(target => 'bash-5.3/' + target.path)));
  for (const row of finalRows.filter(row => row.type === '0')) if (!allowedChanges.has(row.path)) assert.equal(row.sha256, names.get(row.path.toLowerCase()).sha256, 'UNDECLARED_CHANGE');
  const canonical = JSON.stringify(finalRows.map(row => [row.path, row.type, row.mode, row.bytes ?? 0, row.sha256 ?? null]));
  await save('FINAL-SOURCE-INVENTORY.json', { source, order: 'UTF8 byte order within directory traversal', canonicalEncoding: 'UTF8 JSON tuple array no LF', sha256: digest(canonical), members: finalRows.length, changedPaths: [...allowedChanges].sort(), patchlevel: 15, rows: finalRows });
  const sourceFiles = ['configure', 'Makefile.in', 'builtins/Makefile.in', 'lib/readline/Makefile.in', 'patchlevel.h', 'version.h', 'config-top.h', 'config.h.in', 'support/mkversion.c', 'support/mksignames.c'];
  const observations = [];
  const patterns = { generatedHelpers: /mkbuiltins|mksyntax|mkversion|mksignames/, shellExecution: /\$\((?:SHELL|BUILD_SHELL)\)|CONFIG_SHELL|config\.guess|config\.sub/, compileAndLink: /\$\((?:CC|CC_FOR_BUILD|AR|RANLIB|LINKER)\)/, localization: /LIBINTL|gettext|ENABLE_NLS|enable_nls/, readline: /READLINE|readline|TERMCAP|LIBTERMCAP/, siteAndCache: /CONFIG_SITE|cache_file|config\.site/ };
  for (const filename of sourceFiles) {
    try {
      const pathname = source + '/' + filename;
      const identity = await identify(pathname);
      const lines = (await text(pathname)).split('\n');
      const matches = Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, lines.flatMap((line, index) => pattern.test(line) ? [index + 1] : [])]));
      const declarations = lines.flatMap((line, index) => /^#define\s+(PATCHLEVEL|DISTVERSION|RELSTATUS|DEFAULT_PATH_VALUE|STANDARD_UTILS_PATH)\b/.test(line) ? [{ line: index + 1, declaration: line }] : []);
      observations.push({ filename, identity, matches, declarations });
    } catch (error) { if (error.code === 'ENOENT') observations.push({ filename, absent: true }); else throw error; }
  }
  await save('BUILD-SOURCE-OBSERVATIONS.json', { sourceOnly: true, noProseCaptured: true, observations });
  for (const row of identities) await check(row);
  for (const row of seal.inputs) await check(row);
  await save('INPUT-POSTCHECK.json', { unchanged: true, pairs: 16, verifierAndAuthorityReauthenticated: identities.length });
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, stack: error.stack, work, starts, ownedClosed, patchesCompleted: patchResults.length });
} finally {
  const result = { status: process.exitCode ? 'SOURCE_PREPARATION_STOP' : 'SOURCE_PREPARATION_COMPLETE', work, elapsedMs: performance.now() - began, starts, closedChildren: children.filter(row => row.closed).length, ownedClosed, capturedBytes: captured, patchesApplied: patchResults.length, sourceOnly: true, buildExecuted: false, runtimeQualified: false, children };
  await save('RESULT.json', result);
  console.log(JSON.stringify({ ...result, children: undefined }));
}
