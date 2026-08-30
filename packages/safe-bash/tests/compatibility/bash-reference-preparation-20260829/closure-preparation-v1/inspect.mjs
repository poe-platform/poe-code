import { lstat, realpath, readFile, writeFile, readdir, mkdir, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const previous = fileURLToPath(new URL('../source-preparation-v1/', import.meta.url));
const began = performance.now();
const deadline = began + 600000;
await mkdir(root + 'RUN-01', { mode: 0o700 });
const output = root + 'RUN-01/';
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', { at: new Date().toISOString(), role: 'SOURCE_METADATA_ONLY', maxNativeChildren: 8, deadlineMs: 600000 });
let starts = 0;
let captureBytes = 0;
let ownedClosed = true;
const children = [];
const guard = () => assert(performance.now() < deadline, 'METADATA_DEADLINE');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const publicRoot = pathname => ['/Library/Developer/CommandLineTools/', '/usr/bin/', '/usr/sbin/', '/bin/', '/sbin/', '/usr/lib/', '/usr/share/man/', '/System/'].some(prefix => pathname.startsWith(prefix));
const identity = async (pathname, limit = 350 * 1024 * 1024) => {
  guard();
  const status = await lstat(pathname);
  const resolved = await realpath(pathname);
  assert(publicRoot(resolved), 'OUTSIDE_PUBLIC_METADATA_ROOT:' + resolved);
  const final = await lstat(resolved);
  assert(final.isFile() && !final.isSymbolicLink() && final.size <= limit, 'REGULAR_BOUNDED_IDENTITY');
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(resolved, { highWaterMark: 65536 })) { guard(); digest.update(bytes); }
  return { path: pathname, resolved, isLink: status.isSymbolicLink(), bytes: final.size, mode: (final.mode & 0o7777).toString(8), sha256: digest.digest('hex') };
};
const maybeIdentity = async pathname => { try { return await identity(pathname); } catch (error) { if (error.code === 'ENOENT') return { path: pathname, absent: true }; throw error; } };
const json = async pathname => { const status = await lstat(pathname); assert(status.isFile() && status.size <= 8 * 1024 * 1024); return JSON.parse(await readFile(pathname, 'utf8')); };
const same = async row => { const observed = await identity(row.path); for (const key of ['resolved', 'bytes', 'mode', 'sha256']) assert.equal(observed[key], row[key], 'TOOL_MUTATION'); };
const sourceCheck = async () => {
  const inventory = await json(previous + 'RUN-01/FINAL-SOURCE-INVENTORY.json');
  assert.equal(inventory.sha256, '75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e');
  const seen = [];
  const visit = async (directory, prefix) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const path = prefix + '/' + entry.name;
      const expected = inventory.rows.find(row => row.path === path);
      assert(expected, 'SOURCE_APPEND');
      const stat = await lstat(directory + '/' + entry.name);
      assert.equal((stat.mode & 0o777).toString(8), expected.mode);
      if (entry.isDirectory()) { seen.push(expected); await visit(directory + '/' + entry.name, path); }
      else { assert(entry.isFile() && stat.size <= 16 * 1024 * 1024); assert.equal(hash(await readFile(directory + '/' + entry.name)), expected.sha256); seen.push(expected); }
    }
  };
  await visit(inventory.source, 'bash-5.3');
  assert.deepEqual(seen, inventory.rows);
  return { source: inventory.source, members: seen.length, sha256: inventory.sha256 };
};
const metadata = async (reader, targets) => {
  guard(); assert(++starts <= 8);
  await same(reader);
  const id = 'META-' + String(starts).padStart(2, '0');
  await mkdir(output + id, { mode: 0o700 });
  await mkdir(output + id + '/home', { mode: 0o700 });
  await mkdir(output + id + '/tmp', { mode: 0o700 });
  await mkdir(output + id + '/empty-bin', { mode: 0o700 });
  const env = { HOME: output + id + '/home', TMPDIR: output + id + '/tmp', PATH: output + id + '/empty-bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  const argv = ['-l', ...targets];
  await save(id + '/ADMISSION.json', { reader, argv, env, cwd: output + id, maxBodyMs: 10000, maxRetireMs: 1000 });
  const handles = [await open(output + id + '/stdout.raw', 'wx', 0o600), await open(output + id + '/stderr.raw', 'wx', 0o600)];
  const pieces = [[], []];
  const sizes = [0, 0];
  const begin = performance.now();
  const child = spawn(reader.resolved, argv, { env, cwd: output + id, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  let failure = null;
  let retirement;
  const stop = reason => { failure ??= reason; if (child.pid && !closed) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error.message; } } };
  const timer = setTimeout(() => stop('BODY_DEADLINE'), Math.min(10000, Math.max(1, deadline - performance.now())));
  const consume = async (stream, index) => { for await (const bytes of stream) { sizes[index] += bytes.length; captureBytes += bytes.length; if (sizes[index] > 4194304 || captureBytes > 33554432) { stop('CAPTURE_LIMIT'); continue; } await handles[index].write(bytes); pieces[index].push(Buffer.from(bytes)); } };
  const streams = Promise.all([consume(child.stdout, 0), consume(child.stderr, 1)]);
  try {
    const status = await new Promise((fulfill, reject) => {
      retirement = setTimeout(() => { if (!closed) { ownedClosed = false; stop('UNKNOWN_RETIREMENT'); reject(new Error('UNKNOWN_RETIREMENT')); } }, Math.min(11000, Math.max(1, deadline - performance.now())));
      child.once('error', error => { failure = error.message; });
      child.once('close', (code, signal) => { closed = true; fulfill({ code, signal }); });
      streams.catch(error => { stop(error.message); reject(error); });
    });
    await streams;
    const record = { id, status, closed, failure, sizes, elapsedMs: performance.now() - begin };
    children.push(record); await save(id + '/CHILD.json', record);
    assert(closed && !failure && status.code === 0 && status.signal === null, 'METADATA_CHILD_REFUSAL');
    return Buffer.concat(pieces[0]).toString('utf8');
  } finally {
    clearTimeout(timer); clearTimeout(retirement);
    if (!closed) { stop('UNFINISHED_CHILD'); ownedClosed = false; }
    await Promise.all(handles.map(handle => handle.close()));
    await same(reader);
  }
};
const parseLoads = (content, targets) => {
  const rows = [];
  let current = null;
  let command = null;
  for (const line of content.split('\n')) {
    const header = line.match(/^(\/.*?)(?: \(architecture ([^)]+)\))?:$/);
    if (header) { assert(targets.includes(header[1]), 'UNEXPECTED_METADATA_FILE'); current = { path: header[1], architecture: header[2] ?? 'unspecified', rpaths: [], libraries: [], dylinker: [] }; rows.push(current); command = null; continue; }
    const opcode = line.match(/^\s+cmd (LC_\w+)$/);
    if (opcode) { command = opcode[1]; continue; }
    const value = line.match(/^\s+(?:name|path) (.+) \(offset \d+\)$/);
    if (value && current) {
      if (command === 'LC_RPATH') current.rpaths.push(value[1]);
      else if (['LC_LOAD_DYLIB', 'LC_LOAD_WEAK_DYLIB', 'LC_REEXPORT_DYLIB', 'LC_LOAD_UPWARD_DYLIB', 'LC_LAZY_LOAD_DYLIB'].includes(command)) current.libraries.push({ name: value[1], kind: command });
      else if (command === 'LC_LOAD_DYLINKER') current.dylinker.push(value[1]);
    }
  }
  for (const target of targets) assert(rows.some(row => row.path === target), 'MISSING_METADATA_FILE');
  return rows;
};
const toolchain = '/Library/Developer/CommandLineTools';
const toolPaths = [toolchain + '/usr/bin/clang', toolchain + '/usr/bin/ld', toolchain + '/usr/bin/make', toolchain + '/usr/bin/ar', toolchain + '/usr/bin/ranlib', toolchain + '/usr/bin/libtool', toolchain + '/usr/bin/llvm-otool', '/bin/sh', '/bin/bash', '/usr/bin/sed', '/usr/bin/awk', '/usr/bin/grep', '/usr/bin/tr', '/usr/bin/sort', '/bin/expr', '/usr/bin/expr', '/usr/bin/wc', '/usr/bin/dirname', '/usr/bin/basename', '/bin/cat', '/bin/rm', '/bin/mkdir', '/bin/cp', '/bin/mv', '/bin/chmod', '/usr/bin/touch', '/usr/bin/env', '/usr/bin/uname', '/usr/bin/head', '/usr/bin/tail', '/usr/bin/cut', '/usr/bin/cmp', '/usr/bin/install', '/usr/bin/printf', '/usr/bin/true', '/usr/bin/false', '/usr/bin/test', '/usr/bin/tee', '/usr/bin/od', '/usr/bin/du', '/usr/bin/ls', '/bin/ls', '/usr/bin/readlink', '/bin/pwd', '/bin/sleep', '/usr/bin/sandbox-exec', '/usr/bin/eslogger', '/usr/sbin/dtrace', '/usr/bin/ps'];
try {
  const before = await sourceCheck(); await save('SOURCE-BEFORE.json', before);
  const tools = [];
  for (const pathname of toolPaths) tools.push(await maybeIdentity(pathname));
  const reader = tools.find(row => row.path.endsWith('/llvm-otool'));
  assert.equal(reader.sha256, '61ff2c63cf68eeeadf9c4700dadb8271740ff4960f98500f30db82b31521c0de');
  await save('TOOL-IDENTITIES.json', tools);
  const unique = [...new Set(tools.filter(row => !row.absent).map(row => row.resolved))];
  let loads = parseLoads(await metadata(reader, unique), unique);
  const libraryIdentities = [];
  const edges = [];
  const processed = new Set(unique);
  const rootRpaths = new Map(loads.map(row => [row.path, row.rpaths]));
  let pending = loads.map(row => ({ ...row, executable: row.path, inheritedRpaths: row.rpaths }));
  for (let round = 0; round < 4 && pending.length; round++) {
    const additions = new Map();
    for (const owner of pending) {
      const expand = value => value.replace(/^@loader_path(?=\/|$)/, dirname(owner.path)).replace(/^@executable_path(?=\/|$)/, dirname(owner.executable));
      for (const dependency of owner.libraries) {
        const candidates = dependency.name.startsWith('@rpath/') ? [...owner.rpaths, ...owner.inheritedRpaths].map(pathname => resolve(expand(pathname), dependency.name.slice(7))) : [expand(dependency.name)];
        const edge = { owner: owner.path, architecture: owner.architecture, rootExecutable: owner.executable, ...dependency, candidates: [] };
        if (dependency.name.startsWith('/usr/lib/') || dependency.name.startsWith('/System/Library/')) { edge.classification = 'PUBLIC_SYSTEM_IMAGE_NAME_NOT_ACTUAL_LOAD_PROOF'; edges.push(edge); continue; }
        for (const candidate of [...new Set(candidates)]) {
          if (!candidate.startsWith(toolchain + '/')) { edge.candidates.push({ path: candidate, disposition: 'OUTSIDE_TOOLCHAIN_UNRESOLVED' }); continue; }
          const row = await maybeIdentity(candidate);
          edge.candidates.push(row);
        }
        const present = edge.candidates.filter(row => row.sha256);
        const resolved = [...new Set(present.map(row => row.resolved))];
        if (resolved.length === 1) {
          edge.classification = 'UNIQUE_PRESENT_STATIC_CANDIDATE_NOT_DYLD_OBSERVATION';
          const row = present[0];
          if (!processed.has(row.resolved)) { assert(libraryIdentities.length + additions.size < 16); additions.set(row.resolved, { identity: row, executable: owner.executable, inheritedRpaths: [...owner.rpaths, ...owner.inheritedRpaths] }); }
        } else edge.classification = resolved.length ? 'AMBIGUOUS_STATIC_CANDIDATES' : 'UNRESOLVED_STATIC_EDGE';
        edges.push(edge);
      }
    }
    if (!additions.size) { pending = []; break; }
    const targets = [...additions.keys()];
    const next = parseLoads(await metadata(reader, targets), targets);
    for (const [pathname, data] of additions) { processed.add(pathname); libraryIdentities.push(data.identity); }
    loads.push(...next);
    pending = next.map(row => ({ ...row, executable: additions.get(row.path).executable, inheritedRpaths: additions.get(row.path).inheritedRpaths }));
  }
  await save('LOADER-GRAPH.json', { loadCommands: loads, edges, libraryIdentities, pendingAfterRoundCap: pending.length, runtimeLoadedImagesObserved: false });
  const sdkLink = toolchain + '/SDKs/MacOSX.sdk';
  const sdk = await realpath(sdkLink); assert(sdk.startsWith(toolchain + '/SDKs/'));
  const sdkStatus = await lstat(sdk); assert(sdkStatus.isDirectory());
  const versionsRoot = toolchain + '/usr/lib/clang';
  const versions = await readdir(versionsRoot, { withFileTypes: true }); assert(versions.length <= 8);
  const versionDirectories = versions.filter(row => row.isDirectory()).map(row => row.name);
  const resource = versionDirectories.length === 1 ? versionsRoot + '/' + versionDirectories[0] : null;
  const metadataRows = [];
  for (const pathname of [sdk + '/SDKSettings.json', sdk + '/SDKSettings.plist', '/System/Library/CoreServices/SystemVersion.plist']) {
    try {
      const row = await identity(pathname, 1048576);
      const content = await readFile(row.resolved, 'utf8');
      row.selectedVersionFields = pathname.endsWith('.json') ? Object.fromEntries(Object.entries(JSON.parse(content)).filter(([key, value]) => ['Version', 'CanonicalName', 'DisplayName', 'MaximumDeploymentTarget', 'MinimalDisplayName'].includes(key) && ['string', 'number'].includes(typeof value))) : [...content.matchAll(/<key>(ProductVersion|ProductBuildVersion|Version|CanonicalName)<\/key>\s*<string>([^<]{1,100})<\/string>/g)].map(match => ({ key: match[1], value: match[2] }));
      metadataRows.push(row);
    } catch (error) { if (error.code === 'ENOENT') metadataRows.push({ path: pathname, absent: true }); else throw error; }
  }
  const includeRoots = [sdk + '/usr/include', ...(resource ? [resource + '/include'] : [])];
  const seeds = ['stdio.h', 'stdlib.h', 'stddef.h', 'stdarg.h', 'stdint.h', 'stdbool.h', 'limits.h', 'float.h', 'string.h', 'strings.h', 'errno.h', 'unistd.h', 'fcntl.h', 'signal.h', 'setjmp.h', 'assert.h', 'ctype.h', 'locale.h', 'wchar.h', 'wctype.h', 'time.h', 'math.h', 'dirent.h', 'pwd.h', 'grp.h', 'termios.h', 'termcap.h', 'term.h', 'curses.h', 'ncurses.h', 'iconv.h', 'langinfo.h', 'dlfcn.h', 'regex.h', 'poll.h', 'pthread.h', 'sys/types.h', 'sys/stat.h', 'sys/wait.h', 'sys/time.h', 'sys/resource.h', 'sys/param.h', 'sys/ioctl.h', 'sys/file.h', 'sys/select.h', 'sys/socket.h', 'sys/utsname.h', 'sys/mman.h', 'sys/un.h', 'netinet/in.h', 'arpa/inet.h', 'netdb.h', 'mach/mach_time.h', 'Availability.h', 'TargetConditionals.h'];
  const queue = includeRoots.flatMap(base => seeds.map(name => ({ path: base + '/' + name, via: 'EXPLICIT_SEED' })));
  const visited = new Set();
  const headers = [];
  const unresolved = [];
  const includeEdges = [];
  let headerBytes = 0;
  let queueCursor = 0;
  for (; queueCursor < queue.length && headers.length < 512; queueCursor++) {
    guard(); assert(queue.length <= 2048);
    const item = queue[queueCursor]; if (visited.has(item.path)) continue; visited.add(item.path);
    if (!includeRoots.some(base => item.path.startsWith(base + '/'))) { unresolved.push({ ...item, reason: 'OUTSIDE_HEADER_SCOPE' }); continue; }
    let row;
    try { row = await identity(item.path, 4194304); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') { unresolved.push({ ...item, reason: 'ABSENT_LITERAL_CANDIDATE' }); continue; } throw error; }
    assert(includeRoots.some(base => row.resolved.startsWith(base + '/')), 'HEADER_SYMLINK_ESCAPE');
    if (headers.some(prior => prior.resolved === row.resolved)) continue;
    if (headerBytes + row.bytes > 33554432) { unresolved.push({ ...item, reason: 'HEADER_AGGREGATE_BOUND' }); break; }
    headerBytes += row.bytes; headers.push(row);
    const content = await readFile(row.resolved, 'utf8');
    for (const match of content.matchAll(/^\s*#\s*(include|include_next)\s*([<"])([^>"\r\n]+)[>"]/gm)) {
      const name = match[3]; if (name.length > 512 || name.includes('\0') || name.startsWith('/')) { unresolved.push({ path: row.path, name, reason: 'UNSUPPORTED_INCLUDE_FORM' }); continue; }
      const candidates = [...(match[2] === '"' ? [resolve(dirname(row.resolved), name)] : []), ...includeRoots.map(base => resolve(base, name))];
      includeEdges.push({ owner: row.resolved, kind: match[1], name, candidates, qualification: 'LEXICAL_OVERAPPROXIMATION_NOT_PREPROCESSOR_SELECTION' });
      for (const candidate of candidates) if (!visited.has(candidate) && !queue.some(queued => queued.path === candidate)) queue.push({ path: candidate, via: row.resolved });
    }
  }
  const stubNames = ['libSystem.tbd', 'libc.tbd', 'libm.tbd', 'libdl.tbd', 'libpthread.tbd', 'libncurses.tbd', 'libncurses.5.4.tbd', 'libtermcap.tbd', 'libiconv.tbd', 'libintl.tbd', 'libresolv.tbd', 'libz.tbd', 'libc++.tbd'];
  const stubs = []; const missingStubs = []; const stubQueue = stubNames.map(name => sdk + '/usr/lib/' + name); const stubSeen = new Set(); let stubBytes = 0;
  for (let index = 0; index < stubQueue.length && stubs.length < 128; index++) {
    const pathname = stubQueue[index]; if (stubSeen.has(pathname)) continue; stubSeen.add(pathname);
    try {
      const row = await identity(pathname, 2097152); assert(row.resolved.startsWith(sdk + '/usr/lib/'));
      if (stubs.some(prior => prior.resolved === row.resolved)) continue;
      assert(stubBytes + row.bytes <= 16777216); stubBytes += row.bytes; stubs.push(row);
      const content = await readFile(row.resolved, 'utf8');
      for (const match of content.matchAll(/\/usr\/lib\/[A-Za-z0-9_./+-]+\.dylib/g)) { const candidate = sdk + match[0].replace(/\.dylib$/, '.tbd'); if (!stubSeen.has(candidate) && !stubQueue.includes(candidate)) { assert(stubQueue.length < 512); stubQueue.push(candidate); } }
    } catch (error) { if (error.code === 'ENOENT') missingStubs.push({ path: pathname, reason: 'ABSENT_LITERAL_STUB' }); else throw error; }
  }
  await save('SDK-SCOPE.json', { sdkLink, sdk, directoryMode: (sdkStatus.mode & 0o777).toString(8), metadataRows, resourceDirectories: versionDirectories, proposedResourceRoot: resource, resourceSelection: 'EXPLICIT_FUTURE_FLAG_NOT_OBSERVED_DRIVER_DEFAULT', includeRoots, headerBytes, headers, includeEdges, unresolved, pendingHeaderCandidates: queue.length - queueCursor, stubBytes, stubs, missingStubs, wholeSDKAuthenticated: false, actualCompilerReadClosure: false });
  const manuals = [];
  for (const pathname of ['/usr/share/man/man1/sandbox-exec.1', '/usr/share/man/man1/eslogger.1', '/usr/share/man/man1/dtrace.1']) {
    try {
      const row = await identity(pathname, 262144); const content = await readFile(row.resolved, 'utf8');
      manuals.push({ ...row, lineClassifications: content.split('\n').flatMap((line, index) => /root|superuser|Full Disk|privacy|deprecated|exec|fork|exit|privileg|sequence/i.test(line) ? [{ line: index + 1, concepts: ['root', 'superuser', 'Full Disk', 'privacy', 'deprecated', 'exec', 'fork', 'exit', 'privileg', 'sequence'].filter(word => line.toLowerCase().includes(word.toLowerCase())) }] : []) });
    } catch (error) { if (error.code === 'ENOENT') manuals.push({ path: pathname, absent: true }); else throw error; }
  }
  await save('OBSERVER-FENCE-METADATA.json', { tools: tools.filter(row => /sandbox-exec$|eslogger$|dtrace$|\/ps$/.test(row.path)), manuals, observedPermissionGrant: false, fenceActivated: false, observerExecuted: false });
  for (const row of [...tools.filter(row => !row.absent), ...libraryIdentities, ...headers, ...stubs, ...metadataRows.filter(row => !row.absent)]) await same(row);
  const after = await sourceCheck(); assert.deepEqual(after, before); await save('SOURCE-AFTER.json', after);
  await save('SUMMARY.json', { status: 'METADATA_COMPLETE_NOT_BUILD_READY', toolObservations: tools.length, presentTools: tools.filter(row => !row.absent).length, distinctToolFiles: unique.length, loaderFiles: new Set(loads.map(row => row.path)).size, newLibraryFiles: libraryIdentities.length, unresolvedLoaderEdges: edges.filter(row => ['AMBIGUOUS_STATIC_CANDIDATES', 'UNRESOLVED_STATIC_EDGE'].includes(row.classification)).length, systemImageEdges: edges.filter(row => row.classification === 'PUBLIC_SYSTEM_IMAGE_NAME_NOT_ACTUAL_LOAD_PROOF').length, sdk, resource, headerFiles: headers.length, headerBytes, headerCandidatesUnprocessed: queue.length - queueCursor, absentOrUnresolvedHeaderCandidates: unresolved.length, stubs: stubs.length, stubBytes, missingStubs: missingStubs.length, sourceUnchanged: after, runtimeOrFenceQualified: false });
} catch (error) { process.exitCode = 1; await save('FAILURE.json', { message: error.message, stack: error.stack, starts, ownedClosed }); }
finally { await save('RESULT.json', { status: process.exitCode ? 'METADATA_STOP' : 'METADATA_COMPLETE', elapsedMs: performance.now() - began, starts, closedChildren: children.filter(row => row.closed).length, ownedClosed, captureBytes, buildExecutions: 0, fenceActivations: 0, children }); }
