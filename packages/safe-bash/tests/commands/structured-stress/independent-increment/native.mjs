import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCases, pipelineCases } from './cases.mjs';

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, '../../../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const executable = '/usr/bin/jq';
const timeoutMs = 2000;
const maxBytesPerStream = 65536;
export const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };

export async function invokeNative(argv, inputHex = '', transport = 'whole', files = {}) {
  const temporary = await mkdtemp(join(directory, '.native-'));
  try {
    for (const [name, hex] of Object.entries(files)) {
      assert.match(name, /^[a-z]+\.txt$/u);
      await writeFile(join(temporary, name), Buffer.from(hex, 'hex'), { flag: 'wx' });
    }
    return await new Promise((resolveResult, rejectResult) => {
      const child = spawn(executable, argv, { shell: false, cwd: temporary, env: { ...environment, HOME: temporary }, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = { stdout: [], stderr: [] };
      const sizes = { stdout: 0, stderr: 0 };
      let failure;
      const fail = error => { failure ??= error; child.kill('SIGKILL'); };
      const watchdog = setTimeout(() => fail(new Error('native timeout')), timeoutMs);
      child.on('error', fail);
      for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
        sizes[name] += chunk.length;
        if (sizes[name] > maxBytesPerStream) fail(new Error(`native ${name} cap`));
        else chunks[name].push(chunk);
      });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
      child.on('close', (status, signal) => {
        clearTimeout(watchdog);
        if (failure || signal || status === null) return rejectResult(failure ?? new Error(`native signal ${signal}`));
        const stdout = Buffer.concat(chunks.stdout);
        const stderr = Buffer.concat(chunks.stderr);
        resolveResult({ status, signal, stdoutHex: stdout.toString('hex'), stderrHex: stderr.toString('hex'), stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) });
      });
      void (async () => {
        const input = Buffer.from(inputHex, 'hex');
        if (transport === 'bytewise') {
          for (const byte of input) {
            if (child.stdin.destroyed) break;
            child.stdin.write(Buffer.from([byte]));
            await new Promise(done => setImmediate(done));
          }
          child.stdin.end();
        } else child.stdin.end(input);
      })().catch(fail);
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function captureCase(fixture) {
  if (!fixture.stages) return { ...fixture, inputSha256: sha256(Buffer.from(fixture.inputHex, 'hex')), expected: await invokeNative(fixture.argv, fixture.inputHex, fixture.transport, fixture.files) };
  let inputHex = fixture.inputHex;
  const stages = [];
  for (const argv of fixture.stages) {
    const expected = await invokeNative(argv, inputHex);
    stages.push({ argv, inputHex, inputSha256: sha256(Buffer.from(inputHex, 'hex')), expected });
    inputHex = expected.stdoutHex;
  }
  const stderr = Buffer.concat(stages.map(stage => Buffer.from(stage.expected.stderrHex, 'hex')));
  const stdout = Buffer.from(inputHex, 'hex');
  return { ...fixture, stages, inputSha256: sha256(Buffer.from(fixture.inputHex, 'hex')), expected: { status: stages.at(-1).expected.status, signal: null, stdoutHex: inputHex, stderrHex: stderr.toString('hex'), stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert.ok(['--freeze', '--verify', '--case'].includes(mode), 'Use --freeze, --verify, or --case ID');
  const version = await invokeNative(['--version']);
  const build = await invokeNative(['--build-configuration']);
  assert.equal(version.status, 0);
  assert.equal(build.status, 0);
  if (mode === '--case') {
    const fixture = [...probeCases, ...pipelineCases].find(candidate => candidate.id === process.argv[3]);
    assert.ok(fixture, 'unknown trusted probe ID');
    console.log(JSON.stringify(await captureCase(fixture), null, 2));
  } else if (mode === '--verify') {
    const frozen = JSON.parse(await readFile(join(directory, 'native-vectors.json'), 'utf8'));
    assert.deepEqual(version, frozen.provenance.version);
    assert.deepEqual(build, frozen.provenance.build);
    assert.equal(sha256(await readFile(executable)), frozen.provenance.executableSha256);
    for (const fixture of frozen.cases) {
      const specification = fixture.stages ? { ...fixture, stages: fixture.stages.map(stage => stage.argv) } : fixture;
      const actual = await captureCase(specification);
      assert.deepEqual(actual, fixture, fixture.id);
    }
    console.log(`Verified ${frozen.cases.length} frozen cases; ${frozen.provenance.fixtureInvocations} fixture invocations + 2 metadata invocations.`);
  } else {
    const sourcePaths = ['input.ts', 'jq.ts', 'interpreter.ts', 'parser.ts', 'limits.ts', 'values.ts'];
    const productHashes = {};
    for (const name of sourcePaths) productHashes[name] = sha256(await readFile(join(root, 'src/commands/structured', name)));
    const scriptHashes = {};
    for (const name of ['cases.mjs', 'native.mjs']) scriptHashes[name] = sha256(await readFile(join(directory, name)));
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false, timeout: timeoutMs, maxBuffer: maxBytesPerStream });
    assert.equal(head.status, 0);
    const captured = [];
    for (const fixture of [...probeCases, ...pipelineCases]) captured.push(await captureCase(fixture));
    const document = {
      provenance: { capturedAt: new Date().toISOString(), executable, executableSha256: sha256(await readFile(executable)), version, build, platform: process.platform, architecture: process.arch, node: process.version, head: head.stdout.trim(), reviewedCommits: ['62315bc7703330088b0b0466619b3a5a00028bdf', 'e9b30e18e6d03a8fe1ee27b131f8669ab62c0485'], productHashes, scriptHashes, environment, home: 'fresh isolated temporary directory per invocation', cwd: 'fresh isolated temporary directory under this test directory', shell: false, timeoutMs, maxBytesPerStream, inputEncoding: 'hexadecimal exact bytes; argv strings UTF-8', transportNote: 'bytewise writes yield between writes; OS pipe read coalescing is not controlled', fixtureInvocations: captured.reduce((total, fixture) => total + (fixture.stages?.length ?? 1), 0), metadataInvocations: 2 },
      cases: captured,
    };
    const target = join(directory, 'native-vectors.json');
    await assert.rejects(readFile(target), { code: 'ENOENT' });
    const content = `${JSON.stringify(document, null, 2)}\n`;
    const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
    const result = spawnSync('apply_patch', [patch], { shell: false, cwd: root, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
    assert.equal(result.status, 0, result.stderr);
    console.log(`${captured.length} cases frozen; ${document.provenance.fixtureInvocations} fixture invocations + 2 metadata invocations; sha256 ${sha256(content)}`);
  }
}
