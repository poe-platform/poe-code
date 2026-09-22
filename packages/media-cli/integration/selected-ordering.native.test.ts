/** Exact selected-artifact differential for the public execution API. Disposable
 * container-native effects; does not qualify the canonical bridge or cloud. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMediaEngine } from '../src/engine.js';

interface FileRecord { size: number; sha256: string; bytes_base64: string }
interface Observation {
  argv: string[];
  cwd: string;
  executable_sha256: string;
  status: { exit_code: number | null; signal: string | null; timed_out: boolean };
  native_process_started: boolean;
  spawn_error: unknown;
  stdout_base64: string;
  stderr_base64: string;
  files_before: Record<string, FileRecord>;
  files_after: Record<string, FileRecord>;
  effects: Record<string, string>;
  stream_probe?: Observation;
  decoded_rgb?: Observation;
}
interface Corpus { image: string; runner_sha256?: string; results: { id: string; runs: Observation[] }[] }
const evidence = new URL('./fixtures/selected-ordering/', import.meta.url);
const base: Corpus = JSON.parse(await readFile(new URL('native-base.json', evidence), 'utf8'));
const delegate: Corpus = JSON.parse(await readFile(new URL('native-delegate.json', evidence), 'utf8'));
const processSource = await readFile(new URL('ordering-process.mjs', import.meta.url), 'utf8');
const context = process.env.MEDIA_ORDERING_DOCKER_CONTEXT;
const reportPath = process.env.MEDIA_ORDERING_DIFFERENTIAL_OUTPUT;
const comparisons: { id: string; image: string; direct: Observation; through: Observation }[] = [];
const images = { base: process.env.MEDIA_ORDERING_IMAGE, delegate: process.env.MEDIA_ORDERING_DELEGATE_IMAGE };
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
async function docker(args: string[], input?: string) {
  if (!context) throw new Error('Explicit MEDIA_ORDERING_DOCKER_CONTEXT required');
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('docker', ['--context', context, ...args], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Docker experiment deadline exceeded; unavailable cases never pass')); }, 25000);
    child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); if (code === 0) resolve(Buffer.concat(stdout).toString()); else reject(new Error(Buffer.concat(stderr).toString())); });
    child.stdin.end(input);
  });
}
async function native(image: string, argv: string[], files: Record<string, FileRecord>): Promise<Observation> {
  const result: Observation = JSON.parse(await docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '--read-only', '--network', 'none', '--pids-limit', '64', '--memory', '512m', '--cpus', '2', '--tmpfs', '/scratch:rw,nosuid,nodev,size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', image, '--input-type=module', '-e', processSource], JSON.stringify({ argv, files })));
  expect(result.native_process_started).toBe(true); expect(result.spawn_error).toBeNull();
  expect(result.status.timed_out).toBe(false); expect(result.status.signal).toBeNull();
  return result;
}

/** Comparison-only tolerances: FFmpeg heap addresses, frame progress speed/time,
 * and failed-Ghostscript random spool names. Returned byte streams remain intact. */
function comparableDiagnostic(encoded: string) {
  return Buffer.from(encoded, 'base64').toString('utf8').split('\n').map(line => {
    if (line.startsWith('[')) {
      const pointer = line.indexOf(' @ 0x'), end = line.indexOf(']', pointer);
      if (pointer >= 0 && end > pointer && [...line.slice(pointer + 5, end)].every(c => '0123456789abcdefABCDEF'.includes(c))) line = line.slice(0, pointer) + ' @ <address>' + line.slice(end);
    }
    if (line.startsWith('frame=')) {
      const speed = line.indexOf('speed='), elapsed = line.indexOf(' elapsed=', speed);
      if (speed >= 0 && elapsed > speed) line = line.slice(0, speed) + 'speed=<rate> elapsed=<time>';
    }
    const prefix = '/scratch/fixture/tmp/magick-';
    let offset = 0;
    while ((offset = line.indexOf(prefix, offset)) >= 0) {
      const begin = offset + prefix.length;
      let end = begin;
      while (end < line.length && 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.includes(line[end])) end++;
      line = line.slice(0, begin) + '<temporary-id>' + line.slice(end); offset = begin + 14;
    }
    return line;
  }).join('\n');
}

afterAll(async () => {
  if (reportPath) await writeFile(reportPath, JSON.stringify({ captured_at: new Date().toISOString(), scope: 'Public JS execution API with independently restored container-native fixtures; not cloud or canonical bridge qualification.', comparisons }, null, 2) + '\n', { flag: 'wx' });
});

beforeAll(async () => {
  if (!reportPath) throw new Error('Explicit MEDIA_ORDERING_DIFFERENTIAL_OUTPUT required to retain both original raw observations');
  expect(sha(processSource)).toBe(base.runner_sha256);
  const admission = JSON.parse(await readFile(new URL('admission.json', evidence), 'utf8'));
  expect(sha(await readFile(new URL('production-candidates.json', evidence)))).toBe(admission.candidate_lock_sha256);
  for (const [label, corpus] of [['base', base], ['delegate', delegate]] as const) {
    const selected = images[label];
    if (!selected) throw new Error('Both MEDIA_ORDERING_IMAGE and MEDIA_ORDERING_DELEGATE_IMAGE are required; no Homebrew fallback');
    expect((await docker(['image', 'inspect', '--format', '{{.Id}}', selected])).trim()).toBe(corpus.image);
    const inventory = JSON.parse(await readFile(new URL('inventory-' + label + '.json', evidence), 'utf8'));
    expect(inventory.image).toBe(corpus.image);
    expect(sha(JSON.stringify(inventory.files))).toBe(inventory.files_digest);
    // Docker's immutable image identity binds the captured configuration/library/
    // module/policy/font/delegate closure. Verify the invoked entrypoints too.
    const paths = ['/opt/ffmpeg/ffmpeg', '/opt/ffmpeg/ffprobe', '/opt/imagemagick/AppRun', '/opt/imagemagick/usr/bin/magick'];
    const query = 'const fs=require("fs"),crypto=require("crypto");console.log(JSON.stringify(' + JSON.stringify(paths) + '.map(path=>({path,sha256:crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex")}))))';
    const actual = JSON.parse(await docker(['run', '--rm', '--platform', 'linux/amd64', '--read-only', '--network', 'none', '--entrypoint', 'node', corpus.image, '-e', query]));
    for (const file of actual) expect(file.sha256, file.path).toBe(inventory.files.find((entry: { path: string }) => entry.path === file.path).sha256);
  }
});

// Independently reviewed native expectations; no import from fast unit cases,
// generated option metadata, discovery, resolver or a JS operation parser.
const cases = [
  ['base', 'ff-valid', 0], ['base', 'ff-unknown-later', 8], ['base', 'ff-missing-lut', 254], ['base', 'ff-second-parent', 254],
  ['base', 'ff-refuse', 0], ['base', 'ff-optional-map', 0], ['base', 'ff-pipe-mp4', 234],
  ['base', 'im-late-option', 11], ['base', 'im-late-resource', 1], ['base', 'im-late-stack', 1],
  ['base', 'im-mogrify-resource', 1], ['base', 'im-mogrify-syntax', 1], ['base', 'im-delegate-after-write', 1], ['base', 'im-resource-limit-after-write', 1],
  ['delegate', 'im-delegate-success', 0], ['delegate', 'im-delegate-late-syntax', 11], ['delegate', 'im-delegate-late-limit', 1],
] as const;
it.each(cases)('%s: %s preserves direct native behavior (exit %s)', async (label, name, status) => {
  const corpus = label === 'base' ? base : delegate;
  const fixture = corpus.results.find(result => result.id === name)!.runs[0];
  // Native side uses original recorded argv and independently restored bytes.
  const direct = await native(corpus.image, fixture.argv.slice(), structuredClone(fixture.files_before));
  expect(direct.status.exit_code).toBe(status);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  let through: Observation | undefined;
  const engine = createMediaEngine({ bind: async request => ({
    invocation: { sessionId: 's', epoch: 'e', buildId: corpus.image, sourceAuthorityId: 'a', bindingId: 'g', materializationId: 'm', manifestId: 'f', manifestRevision: 'r', directoryRevision: 'd' },
    job: { async execute(invocation) {
      // The JS side gets a NEW fixture world; neither side's final bytes seed the other.
      const argv = [fixture.argv[0], ...invocation.originalArgv.map(bytes => Buffer.from(bytes).toString('utf8'))];
      through = await native(corpus.image, argv, structuredClone(fixture.files_before));
      await request.stdout.write(Buffer.from(through.stdout_base64, 'base64'));
      await request.stderr.write(Buffer.from(through.stderr_base64, 'base64'));
      return { exitCode: through.status.exit_code! };
    } },
  }) });
  const result = await engine.execute({ command: name.startsWith('ff-') ? 'ffmpeg' : 'magick', args: fixture.argv.slice(1).map(s => new TextEncoder().encode(s)), cwd: fixture.cwd, env: {}, fs: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  comparisons.push({ id: name, image: corpus.image, direct, through: through! });
  expect(result).toEqual({ exitCode: direct.status.exit_code });
  expect(Buffer.concat(stdout).toString('base64')).toBe(through!.stdout_base64);
  expect(Buffer.concat(stderr).toString('base64')).toBe(through!.stderr_base64);
  expect(through!.argv).toEqual(direct.argv); expect(through!.files_before).toEqual(direct.files_before);
  expect(through!.status).toEqual(direct.status); expect(through!.effects).toEqual(direct.effects);
  expect(through!.stdout_base64).toBe(direct.stdout_base64);
  expect(comparableDiagnostic(through!.stderr_base64)).toBe(comparableDiagnostic(direct.stderr_base64));
  for (const [path, file] of Object.entries(direct.files_after)) {
    if ((name === 'ff-valid' || name === 'ff-optional-map') && path === 'first.mkv') continue;
    expect(through!.files_after[path], path).toEqual(file);
  }
  if (label === 'delegate') {
    // PPM is an image sequence here: original RGB, then Ghostscript's 2x2 red
    // page. This independent literal also proves successful delegate rendering.
    const sequence = Buffer.concat([Buffer.from('P6\n3 1\n255\n'), Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), Buffer.from('P6\n2 2\n65535\n'), Buffer.from([255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0])]);
    for (const observation of [direct, through!]) expect(observation.files_after['delegate.ppm'].bytes_base64).toBe(sequence.toString('base64'));
  }
  if (name === 'ff-valid' || name === 'ff-optional-map') {
    for (const observation of [direct, through!]) {
      expect(observation.stream_probe!.status.exit_code).toBe(0);
      expect(JSON.parse(Buffer.from(observation.stream_probe!.stdout_base64, 'base64').toString()).streams).toEqual([{ codec_type: 'video' }]);
      expect(observation.decoded_rgb!.status.exit_code).toBe(0);
      expect([...Buffer.from(observation.decoded_rgb!.stdout_base64, 'base64')]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    }
  }
});
