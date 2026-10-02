/** Manually reviewed pass-through expectations after selected-artifact Linux
 * reproduction. Native differential fixtures never import this file or parser. */
import { expect, it, vi } from 'vitest';
import { Volume } from 'memfs';
import { createMediaEngine } from './engine.js';
import type { MediaEngineRequest } from './engine.js';

const bytes = (value: string) => new TextEncoder().encode(value);
const identity = { sessionId: 'session', epoch: 'epoch', buildId: 'selected', sourceAuthorityId: 'authority', bindingId: 'binding', materializationId: 'materialization', manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'directory' };
function fixture(command: string, argv: string[], native: (request: MediaEngineRequest, fs: Volume) => Promise<number>) {
  const fs = Volume.fromJSON({ '/work/first.mkv': 'keep-first', '/work/early.ppm': 'keep-early', '/work/final.ppm': 'keep-final', '/work/source.ppm': 'original-pixels' });
  const read = vi.fn(() => { throw new Error('No frontend media-resource validation'); });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const request = { command, args: argv.map(bytes), cwd: '/work', env: {}, fs: { objects: { open: read } }, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b: Uint8Array) { stdout.push(b.slice()); } }, stderr: { async write(b: Uint8Array) { stderr.push(b.slice()); } } };
  const execute = vi.fn(async (invocation: { originalArgv: number[][] }, _signal: AbortSignal, source: unknown) => {
    expect(invocation.originalArgv).toEqual(argv.map(arg => Array.from(bytes(arg))));
    expect(source).toBe(request.fs);
    return { exitCode: await native(request, fs) };
  });
  const engine = createMediaEngine({ bind: async owned => ({ invocation: identity, job: { execute: async (...args) => {
    // Borrowed stream objects are the original invocation's destinations.
    expect(owned.stdout).toBe(request.stdout); expect(owned.stderr).toBe(request.stderr);
    return execute(...args);
  } } }) });
  return { fs, read, stdout, stderr, execute, engine, request };
}

it.each([
  { name: 'unknown option after first output', argv: ['-i', 'source.ppm', 'first.mkv', '-ordering_unknown', 'second.mkv'], status: 8, diagnostic: "Unrecognized option 'ordering_unknown'.\nError splitting the argument list: Option not found\n" },
  { name: 'missing LUT before output opening', argv: ['-i', 'source.ppm', '-vf', 'lut3d=file=absent.cube', 'first.mkv'], status: 254, diagnostic: 'absent.cube: No such file or directory\nError opening output file first.mkv.\n' },
])('preserves native $name status, diagnostics and unopened output', async ({ argv, status, diagnostic }) => {
  const raw = Uint8Array.from([...bytes(diagnostic), 0, 255, 13, 10]);
  const f = fixture('ffmpeg', argv, async (request, fs) => {
    expect(fs.readFileSync('/work/first.mkv', 'utf8')).toBe('keep-first');
    await request.stderr.write(raw);
    return status;
  });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: status });
  expect(f.stderr).toEqual([raw]); expect(f.stdout).toEqual([]);
  expect(f.fs.readFileSync('/work/first.mkv', 'utf8')).toBe('keep-first');
  expect(f.read).not.toHaveBeenCalled(); expect(f.execute).toHaveBeenCalledOnce();
});
it('retains first-output truncation when the second output parent is missing', async () => {
  const raw = bytes('Error opening output absent/second.mkv: No such file or directory\n');
  const f = fixture('ffmpeg', ['-y', '-i', 'source.ppm', 'first.mkv', 'absent/second.mkv'], async (request, fs) => {
    fs.writeFileSync('/work/first.mkv', '');
    expect(() => fs.writeFileSync('/work/absent/second.mkv', 'second')).toThrow();
    await request.stderr.write(raw);
    return 254;
  });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: 254 });
  expect(f.fs.readFileSync('/work/first.mkv').length).toBe(0);
  expect(f.fs.existsSync('/work/absent/second.mkv')).toBe(false);
  expect(f.stderr).toEqual([raw]); expect(f.read).not.toHaveBeenCalled();
});
it('does not infer nonzero status from overwrite refusal diagnostics', async () => {
  const raw = bytes("File 'first.mkv' already exists. Exiting.\nError opening output file first.mkv.\n");
  const f = fixture('ffmpeg', ['-nostdin', '-i', 'source.ppm', '-n', 'first.mkv'], async request => { await request.stderr.write(raw); return 0; });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: 0 }); expect(f.stderr).toEqual([raw]);
  expect(f.fs.readFileSync('/work/first.mkv', 'utf8')).toBe('keep-first');
});
it('leaves optional unmatched maps available to native automatic stream selection', async () => {
  const f = fixture('ffmpeg', ['-i', 'source.ppm', '-map', '0:a?', 'first.mkv'], async (_request, fs) => { fs.writeFileSync('/work/first.mkv', 'native-selected-video'); return 0; });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: 0 });
  expect(f.fs.readFileSync('/work/first.mkv', 'utf8')).toBe('native-selected-video');
  expect(f.read).not.toHaveBeenCalled(); expect(f.execute).toHaveBeenCalledOnce();
});
it('keeps nonseekable MP4 failure status and empty stdout', async () => {
  const raw = bytes('muxer does not support non seekable output\nConversion failed!\n');
  const f = fixture('ffmpeg', ['-i', 'source.ppm', '-f', 'mp4', 'pipe:1'], async request => { await request.stderr.write(raw); return 234; });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: 234 }); expect(f.stdout).toEqual([]); expect(f.stderr).toEqual([raw]);
});
it.each([
  { later: ['-ordering_unknown'], status: 11 },
  { later: ['absent.ppm'], status: 1 },
  { later: ['(', 'source.ppm'], status: 1 },
  { later: ['-limit', 'width', '1', 'source.ppm'], status: 1 },
  { later: ['page.ps'], status: 1 },
])('retains early ImageMagick write before later $later failure ($status)', async ({ later, status }) => {
  const raw = Uint8Array.of(255, 13, 10, 0);
  const f = fixture('magick', ['source.ppm', '-write', 'early.ppm', ...later, 'final.ppm'], async (request, fs) => {
    fs.writeFileSync('/work/early.ppm', 'early-native-pixels');
    await request.stderr.write(raw);
    return status;
  });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: status }); expect(f.stderr).toEqual([raw]);
  expect(f.fs.readFileSync('/work/early.ppm', 'utf8')).toBe('early-native-pixels');
  expect(f.fs.readFileSync('/work/final.ppm', 'utf8')).toBe('keep-final'); expect(f.read).not.toHaveBeenCalled();
});
it.each(['absent.ppm', '-ordering_unknown'])('keeps mogrify partial in-place changes before %s', async later => {
  const f = fixture('magick', ['mogrify', '-negate', 'source.ppm', later], async (_request, fs) => { fs.writeFileSync('/work/source.ppm', 'negated-native-pixels'); return 1; });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: 1 });
  expect(f.fs.readFileSync('/work/source.ppm', 'utf8')).toBe('negated-native-pixels'); expect(f.read).not.toHaveBeenCalled();
});
it.each([{ later: ['-ordering_unknown'], status: 11 }, { later: ['-limit', 'width', '1', 'source.ppm'], status: 1 }])('keeps successful delegate effects before later $later', async ({ later, status }) => {
  const f = fixture('magick', ['source.ppm', '-write', 'early.ppm', 'page.ps', '-write', 'delegate.ppm', ...later, 'final.ppm'], async (_request, fs) => {
    fs.writeFileSync('/work/early.ppm', 'early-native-pixels');
    fs.writeFileSync('/work/delegate.ppm', 'ghostscript-rendered-pixels');
    return status;
  });
  expect(await f.engine.execute(f.request)).toEqual({ exitCode: status });
  expect(f.fs.readFileSync('/work/delegate.ppm', 'utf8')).toBe('ghostscript-rendered-pixels');
  expect(f.fs.readFileSync('/work/early.ppm', 'utf8')).toBe('early-native-pixels');
  expect(f.fs.readFileSync('/work/final.ppm', 'utf8')).toBe('keep-final'); expect(f.read).not.toHaveBeenCalled();
});
