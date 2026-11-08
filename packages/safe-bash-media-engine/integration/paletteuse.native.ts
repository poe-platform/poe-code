/** Opt-in same-build oracle. Stock filesystem access is not remote qualification. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFFmpegShims, discover, grammarRevision, nativeReference, type Tool } from '../src/index.js';
import { comparableDiagnostics } from './diagnostics.js';
import { runNative } from './runner.js';

const b = (value: string) => new TextEncoder().encode(value);
const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: '/nonexistent', PATH: '/usr/bin:/bin', AV_LOG_FORCE_NOCOLOR: '1' };
let cwd: string;
beforeAll(async () => {
  const lock = JSON.parse(await readFile(new URL('../metadata/baselines/build-lock.json', import.meta.url), 'utf8'));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    expect(createHash('sha256').update(await readFile(path)).digest('hex'), path).toBe(entry.sha256);
  }
  cwd = await mkdtemp(join(tmpdir(), 'media-paletteuse-'));
});
afterAll(async () => { if (cwd) await rm(cwd, { recursive: true, force: true }); });

const cases = [
  ...['tree.dot', '-', 'pipe:3', 'https:tree', 'tree%03d.dot', '', 'missing/tree.dot'].map(value => ({
    name: `literal ${value}`, options: `debug_kdtree='${value.replaceAll(':', '\\:')}'`, path: b(value), read: false,
  })),
  { name: 'positional', options: 'none:2:rectangle:0:128:tree.dot', path: b('tree.dot'), read: false },
  { name: 'loaded', options: '/debug_kdtree=name.txt', path: b('name.txt'), read: true },
  { name: 'missing late read', options: '/debug_kdtree=missing.txt', path: b('missing.txt'), read: true },
  { name: 'invalid timing', options: '/debug_kdtree=missing.txt', path: b('missing.txt'), read: true },
  { name: 'raw bytes', options: 'debug_kdtree=', path: Uint8Array.from([255, ...b('.dot')]), read: false },
];

it.each(cases)('preserves native palette effects and media for $name', async ({ name, options, path, read }) => {
  const graph = b(`[0:v]split[a][z];[a]palettegen[p];[z][p]paletteuse=${options}[out]`);
  const rawGraph = name === 'raw bytes' ? Uint8Array.from([...graph.subarray(0, graph.length - b('[out]').length), ...path, ...b('[out]')]) : graph;
  const argv = [
    ...['-v', 'warning', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.04', '-f', 'rawvideo', 'early.rgb'].map(b),
    b('-filter_complex'), rawGraph,
    ...(name === 'invalid timing' ? [b('-unknown_paletteuse_fixture')] : []),
    ...['-map', '[out]', '-frames:v', '1', '-f', 'rawvideo', 'out.pal'].map(b),
  ];
  // Hand-authored dependency expectations are independent of native results.
  expect(discover('ffmpeg', argv).dependencies.filter(item => item.role === 'filter-resource').map(item => [item.value, item.access, item.literal])).toEqual([
    [path, read ? 'read' : 'write', !read],
  ]);
  const reset = async () => {
    for (const entry of await readdir(cwd, { encoding: 'buffer' })) await rm(Buffer.concat([Buffer.from(cwd + '/'), entry]));
    await writeFile(join(cwd, 'name.txt'), 'pipe:3\0ignored');
    await writeFile(join(cwd, 'early.rgb'), 'early sentinel');
    await writeFile(join(cwd, 'out.pal'), 'output sentinel');
  };
  const effects = async () => Object.fromEntries(await Promise.all((await readdir(cwd, { encoding: 'buffer' })).map(async entry => [
    entry.toString('base64'), (await readFile(Buffer.concat([Buffer.from(cwd + '/'), entry]))).toString('base64'),
  ])));
  const context = { cwd, env, stdin: new Uint8Array() };
  await reset();
  const native = await runNative(nativeReference.executables.ffmpeg.path, argv, context);
  const nativeEffects = await effects();
  const diagnostic = Buffer.from(native.stderr, 'base64').toString();
  if (name === 'invalid timing') {
    expect(native.exitCode).not.toBe(0);
    expect(diagnostic).toContain('Unrecognized option');
    expect(diagnostic).not.toContain('missing.txt');
    expect(Buffer.from(nativeEffects[Buffer.from('early.rgb').toString('base64')], 'base64').toString()).toBe('early sentinel');
  } else if (name === 'missing late read') {
    expect(native.exitCode).not.toBe(0);
    expect(diagnostic).toContain('missing.txt');
    // Complex graph value files are read before any output is opened.
    expect(Buffer.from(nativeEffects[Buffer.from('early.rgb').toString('base64')], 'base64').toString()).toBe('early sentinel');
  } else {
    expect(native.exitCode, diagnostic).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.pal').toString('base64')], 'base64').length).toBe(16 * 16 + 1024);
    if (name === 'literal ' || name === 'literal missing/tree.dot' || name === 'raw bytes') {
      // The pinned macOS literal fopen reader refuses the invalid UTF-8 name.
      // Its optional diagnostic failure must preserve successful media output.
      expect(diagnostic).toContain('Cannot open file');
      if (name === 'raw bytes') expect(diagnostic).toContain('Illegal byte sequence');
    } else {
      const filename = name === 'loaded' ? b('pipe:3') : path;
      expect(Object.keys(nativeEffects), JSON.stringify(Object.keys(nativeEffects).map(key => Buffer.from(key, 'base64').toString('hex')))).toContain(Buffer.from(filename).toString('base64'));
      expect(Buffer.from(nativeEffects[Buffer.from(filename).toString('base64')], 'base64').toString()).toContain('digraph {');
    }
    expect(native.stdout).toBe('');
  }
  await reset();
  let observed: typeof native | undefined;
  let launches = 0;
  const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(invocation) {
      launches++;
      observed = await runNative(invocation.executable.path, invocation.argv, invocation.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim.ffmpeg(argv, context)).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(observed!.stdout).toBe(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, 'base64'))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, 'base64')));
  expect(await effects()).toEqual(nativeEffects);
});

it('preserves ffprobe frame-time writes with one native probe', async () => {
  const tool: Tool = 'ffprobe';
  const argv = ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.04,split[a][b];[a]palettegen[p];[b][p]paletteuse=debug_kdtree=probe.dot', '-show_frames', '-of', 'json'].map(b);
  expect(discover(tool, argv).dependencies.map(item => [item.value, item.access])).toEqual([[b('probe.dot'), 'write']]);
  const context = { cwd, env, stdin: new Uint8Array() };
  const native = await runNative(nativeReference.executables[tool].path, argv, context);
  expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
  const output = await readFile(join(cwd, 'probe.dot'));
  await rm(join(cwd, 'probe.dot'));
  let observed: typeof native | undefined;
  let launches = 0;
  const shim = createFFmpegShims<typeof context>({ build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live',
    async run(invocation) {
      launches++;
      observed = await runNative(invocation.executable.path, invocation.argv, invocation.context);
      return { exitCode: observed.exitCode };
    },
  });
  expect(await shim[tool](argv, context)).toEqual({ exitCode: native.exitCode });
  expect(launches).toBe(1);
  expect(observed).toEqual(native);
  expect(await readFile(join(cwd, 'probe.dot'))).toEqual(output);
});
