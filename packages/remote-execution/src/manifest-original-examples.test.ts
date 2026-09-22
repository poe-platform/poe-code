import { createHash } from 'node:crypto';
import { Volume } from 'memfs';
import { describe, expect, it } from 'vitest';
import { validateDependencyManifest, type DependencyManifest, type ManifestInvocation } from './protocol.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const examples = [
  {
    name: 'nested concat',
    output: 'out/joined.mp4',
    argv: ['-f', 'concat', '-safe', '0', '-i', 'edit/lists/cut.ffconcat', '-c', 'copy', 'out/joined.mp4'],
    directories: ['clips', 'edit', 'edit/lists', 'out'],
    files: {
      'clips/part one.mp4': 'first clip', 'clips/part two.mp4': 'second clip',
      'edit/lists/cut.ffconcat': "ffconcat version 1.0\nfile '../../clips/part one.mp4'\ninpoint 0.5\noutpoint 1.5\nfile '../../clips/part two.mp4'\n",
    },
    reads: ['edit/lists/../../clips/part one.mp4', 'edit/lists/../../clips/part two.mp4'],
    expected: ['first clip', 'second clip'],
  },
  {
    name: 'filter script with cwd font and live reload',
    output: 'out/titled.mkv',
    argv: ['-i', 'clips/source.mp4', '-/filter_complex', 'filters/look.txt', '-map', '[v]', '-an', '-c:v', 'ffv1', 'out/titled.mkv'],
    directories: ['assets', 'clips', 'filters', 'fonts', 'out', 'titles'],
    files: {
      'assets/grade.cube': 'grade', 'clips/source.mp4': 'source',
      'filters/look.txt': '[0:v]lut3d=file=assets/grade.cube,drawtext=fontfile=fonts/TestSans.ttf:textfile=titles/current.txt:reload=1:x=24:y=24[v]\n',
      'fonts/TestSans.ttf': 'font', 'titles/current.txt': 'initial title',
    },
    reads: ['assets/grade.cube', 'fonts/TestSans.ttf', 'titles/current.txt'],
    expected: ['grade', 'font', 'initial title'],
  },
  {
    name: 'ICC and caption resources',
    output: 'out/captioned.png',
    argv: ['images/input.tif', '-profile', 'profiles/input.icc', '-profile', 'profiles/output.icc', '(', '-background', 'none', '-fill', 'white', '-font', 'fonts/TestSans.ttf', '-pointsize', '24', '-size', '400x', 'caption:@text/caption.txt', ')', '-gravity', 'south', '-compose', 'over', '-composite', 'out/captioned.png'],
    directories: ['fonts', 'images', 'out', 'profiles', 'text'],
    files: { 'fonts/TestSans.ttf': 'font', 'images/input.tif': 'image', 'profiles/input.icc': 'input profile', 'profiles/output.icc': 'output profile', 'text/caption.txt': 'caption' },
    reads: ['profiles/input.icc', 'profiles/output.icc', 'text/caption.txt'],
    expected: ['input profile', 'output profile', 'caption'],
  },
  {
    name: 'identified image sequence',
    output: null,
    argv: ['-framerate', '24000/1001', '-start_number', '1001', '-i', 'frames/shot_%06d.png', '-vf', 'fps=12,scale=320:-2', 'out/thumb_%04d.png'],
    directories: ['frames', 'out'],
    files: { 'frames/shot_001001.png': 'frame one', 'frames/shot_001002.png': 'frame two' },
    reads: ['frames/shot_001001.png', 'frames/shot_001002.png'],
    expected: ['frame one', 'frame two'],
  },
];

describe.each([
  { name: 'direct SDK', transport: (value: DependencyManifest) => value },
  { name: 'REST JSON', transport: (value: DependencyManifest): DependencyManifest => JSON.parse(JSON.stringify(value)) },
])('$name original manifests without a tool parser or CLI', ({ transport }) => {
  it.each(examples)('admits the original $name logical tree', example => {
    const files: Record<string, string> = example.files;
    const names = [...example.directories, ...Object.keys(files), ...(example.output ? [example.output] : [])].sort(); // Fixture names are ASCII.
    const manifest: DependencyManifest = {
      version: 1, sessionId: 'session', epoch: 'epoch', namespaceId: 'namespace',
      revision: 'manifest-1', sourceAuthorityId: 'identified-only', logicalRoot: bytes('/work'), cwd: bytes('/work'),
      entries: names.map(name => {
        const source = { authorityId: 'identified-only', path: bytes(`/work/${name}`),
          freshness: name === 'titles/current.txt' ? 'live' as const : 'revalidate-on-open' as const,
          observedVersion: 'observed-1', retainedIdentity: null, callbackGrantId: `open:${name}` };
        const path = name.split('/').map(bytes);
        if (name === example.output) return { kind: 'output-intent' as const, path, source, operations: ['create' as const, 'truncate' as const] };
        return Object.hasOwn(files, name)
          ? { kind: 'file' as const, path, source, blob: { blobId: `blob:${name}`, size: String(bytes(files[name]).length), sha256: createHash('sha256').update(files[name]).digest('hex') } }
          : { kind: 'directory' as const, path, source };
      }),
    };
    const invocation: ManifestInvocation = { manifestId: 'manifest', manifestRevision: 'manifest-1', directoryRevision: 'ready-1', cwd: bytes('/work'), originalArgv: example.argv.map(bytes) };
    const before = JSON.stringify({ manifest, invocation });
    const submitted = transport(manifest);
    validateDependencyManifest(submitted, { maxEntries: 100, maxPathBytes: 4096 });
    expect(JSON.stringify({ manifest, invocation })).toBe(before);

    // Interpret the submitted tree independently of media parsers and server mapping.
    // Decoding is lossless for these ASCII fixtures; byte-name admission has separate tests.
    const text = (path: number[]) => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(path));
    const tree = new Volume();
    const root = text(submitted.logicalRoot);
    const cwd = text(invocation.cwd);
    expect(text(submitted.cwd)).toBe(cwd);
    tree.mkdirSync(root);
    const blobs = new Map(Object.entries(files).map(([name, content]) => [`blob:${name}`, Buffer.from(content)]));
    const intents: string[] = [];
    for (const entry of submitted.entries) {
      const name = entry.path.map(text).join('/');
      const path = `${root}/${name}`;
      if (entry.kind === 'directory') tree.mkdirSync(path);
      else if (entry.kind === 'file') {
        const content = blobs.get(entry.blob.blobId);
        if (!content) throw new Error(`Missing fixture blob: ${entry.blob.blobId}`);
        expect(String(content.byteLength)).toBe(entry.blob.size);
        expect(createHash('sha256').update(content).digest('hex')).toBe(entry.blob.sha256);
        tree.writeFileSync(path, content);
      } else if (entry.kind === 'output-intent') {
        intents.push(name);
        expect(tree.existsSync(path)).toBe(false);
      } else throw new Error(`Unexpected fixture entry: ${entry.kind}`);
    }
    expect(intents).toEqual(example.output ? [example.output] : []);
    expect(Object.keys(tree.toJSON()).sort()).toEqual([
      ...Object.keys(files).map(name => `${root}/${name}`), `${root}/out`,
    ].sort());
    expect(example.reads.map(name => tree.readFileSync(`${cwd}/${name}`, 'utf8'))).toEqual(example.expected);
    for (const [name, content] of Object.entries(files)) expect(tree.readFileSync(`/work/${name}`)).toEqual(Buffer.from(content));
    expect(tree.readdirSync('/work/out')).toEqual([]);
    expect(names.some(name => name.includes('%'))).toBe(false);
    if (example.name.includes('live reload')) {
      tree.writeFileSync('/work/titles/current.txt', 'updated title');
      expect(tree.readFileSync('/work/titles/current.txt', 'utf8')).toBe('updated title');
      expect(manifest.entries.find(entry => JSON.stringify(entry.path) === JSON.stringify(['titles', 'current.txt'].map(bytes)))?.source).toMatchObject({ freshness: 'live', callbackGrantId: 'open:titles/current.txt' });
    }
  });
});
