import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine, createResourceIO } from "poe-code/ssconvert";

function filesystem(volume: Volume) {
  const base = new MemoryFileSystem();
  return new Proxy(base, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "stat" || key === "lstat") return async (path: string) => {
      try {
        const stat = key === "lstat" ? volume.lstatSync(path) : volume.statSync(path);
        return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs, ctimeMs: stat.ctimeMs };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && isErrnoCode(error.code)) throw new FsError(error.code, { path });
        throw error;
      }
    };
    if (key === "readFile") return async (path: string, options?: { signal?: AbortSignal }) => { options?.signal?.throwIfAborted(); return new Uint8Array(volume.readFileSync(path) as Uint8Array); };
    if (key === "writeFile") return async (path: string, bytes: Uint8Array, options?: { signal?: AbortSignal; flag?: "w" | "wx"; mode?: number }) => { options?.signal?.throwIfAborted(); volume.writeFileSync(path, bytes, options); };
    if (key === "rename") return async (source: string, destination: string) => { volume.renameSync(source, destination); };
    if (key === "unlink") return async (path: string) => { volume.unlinkSync(path); };
    if (key === "readlink") return async (path: string) => String(volume.readlinkSync(path));
    if (key === "chmod") return async (path: string, mode: number) => { volume.chmodSync(path, mode); };
    if (key === "access") return async (path: string, mode?: number) => { volume.accessSync(path, mode); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const binding = { codecs: [], limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: "C", timezone: "UTC" } };
const mps = 'NAME          ORIGINAL\nROWS\n N COST\n L CAP\nCOLUMNS\n X COST 2 CAP 3\n Y COST -1 CAP 1\nRHS\n RHS CAP 9\nBOUNDS\n UP B X 4\nENDATA\n';

test("ssconvert merges through the shared SDK with exact diagnostics and replay effects", async () => {
  const volume = Volume.fromJSON({ "/one.csv": "1", "/two.csv": "2", "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  try {
    const args = "--set=invalid -I Gnumeric_stf:stf_csvtab -T Gnumeric_XmlIO:sax:0 /one.csv /two.csv";
    const merged = await shell.exec(`ssconvert -M /merged.xml ${args}`);
    assert.equal(merged.exitCode, 0, merged.stderr);
    assert.equal(merged.stdout, "");
    assert.equal(merged.stderr, "Adding sheets from file:///one.csv\nAdding sheets from file:///two.csv\n");
    const bytes = volume.readFileSync("/merged.xml", "utf8");
    const replay = await shell.exec(`ssconvert -M fd://1 ${args}`);
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.equal(replay.stderr, merged.stderr);
    assert.equal(replay.stdout, bytes);
    const restored = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /merged.xml fd://1");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "1\n");
    const collision = await shell.exec("ssconvert -M /collision.xml -T Gnumeric_XmlIO:sax:0 /one.csv /one.csv");
    assert.equal(collision.exitCode, 0, collision.stderr);
    assert.equal(collision.stderr, "Adding sheets from file:///one.csv\nAdding sheets from file:///one.csv\n");
    const collisionBytes = volume.readFileSync("/collision.xml", "utf8");
    assert.ok(collisionBytes.includes("<gnm:Name>one.csv(2)</gnm:Name>"));
    const graphs = await shell.exec("ssconvert --export-graphs -T png -M /graph.png /one.csv /two.csv");
    assert.equal(graphs.exitCode, 0, graphs.stderr);
    assert.equal(graphs.stdout, "");
    assert.equal(graphs.stderr, merged.stderr);
    const rejected = await shell.exec("ssconvert -M /merged.xml -T Gnumeric_stf:stf_csv -O sheet=one /one.csv /two.csv");
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, 'ssconvert: Unknown sheet "one"\n');
    assert.equal(volume.readFileSync("/merged.xml", "utf8"), bytes);
    assert.deepEqual(volume.toJSON(), { "/one.csv": "1", "/two.csv": "2", "/keep": "untouched", "/merged.xml": bytes, "/collision.xml": collisionBytes });
  } finally { await shell.dispose(); }
});
const glpk = '\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 2 X_1 - X_2\n\nSubject to\n C_0: 3 X_1 + X_2 <= 9\n C_1: X_1 <= 4\n\nBounds\n X_1 >= 0\n X_2 >= 0\n\nEnd\n';
const lp = '/* Created by Gnumeric 1.12.61 */\n\n/* Object function */\nmin: 2 B10 - B11;\n\n/* Constraints */\nB10 >= 0;\nB11 >= 0;\nCONSTR_0: 3 B10 + B11 <= 9;\nCONSTR_0: B10 <= 4;\n\n/* Declarations */\n\n/* The End */\n';

for (const [format, expected] of [['Gnumeric_glpk:glpk', glpk], ['Gnumeric_lpsolve:lpsolve', lp]]) test(`ssconvert ${format} uses SDK engine and preserves replay namespace`, async () => {
  const volume = Volume.fromJSON({ '/original.mps': mps, '/keep': 'untouched' });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec(`ssconvert -I Gnumeric_mps:mps -T ${format} /original.mps /result`);
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ''); assert.equal(command.stdout, '');
    assert.equal(volume.readFileSync('/result', 'utf8'), expected);
    const replay = await shell.exec(`ssconvert -I Gnumeric_mps:mps -T ${format} /original.mps fd://1`);
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ''); assert.equal(replay.stdout, expected);
    const checkpoint = await shell.exec('ssconvert -I Gnumeric_mps:mps -T Gnumeric_XmlIO:sax:0 /original.mps /checkpoint.xml');
    assert.equal(checkpoint.exitCode, 0, checkpoint.stderr); assert.equal(checkpoint.stderr, '');
    const restored = await shell.exec(`ssconvert -T ${format} /checkpoint.xml fd://1`);
    assert.equal(restored.exitCode, 0, restored.stderr); assert.equal(restored.stderr, ''); assert.equal(restored.stdout, expected);
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode(mps)] }, importType: 'Gnumeric_mps:mps', exportType: format!,
      destination: { kind: 'stream', sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []); assert.deepEqual(chunks, [new TextEncoder().encode(expected)]);
    assert.equal(volume.readFileSync('/original.mps', 'utf8'), mps); assert.equal(volume.readFileSync('/keep', 'utf8'), 'untouched');
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ['/checkpoint.xml', '/keep', '/original.mps', '/result']);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test('ssconvert graph image command and SDK preserve target IDs, reversed ties and failure namespaces', async () => {
  const graph = (name: string) => `<g:SheetObjectGraph Name="${name}" AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="0 0 71 35"><GogObject type="GogGraph"/></g:SheetObjectGraph>`;
  const original = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects>${graph('First')}${graph('Last')}</g:Objects><g:Cells/></g:Sheet><g:Sheet><g:Name>Two</g:Name><g:Objects>${graph('Later')}</g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`;
  const volume = Volume.fromJSON({ '/original.gnumeric': original });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const bad = await shell.exec('ssconvert --export-graphs -T bad /original.gnumeric /bad-%n-%o.bin');
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, '[GOImage::get_format_from_name] Unknown format name (bad)\nFailed to write file:///bad-0-Last.bin: Unknown image format\n[GOImage::get_format_from_name] Unknown format name (bad)\nFailed to write file:///bad-1-First.bin: Unknown image format\n');
  assert.equal(volume.readFileSync('/bad-0-Last.bin').length, 0);
  assert.equal(volume.readFileSync('/bad-1-First.bin').length, 0);
  assert.equal(volume.existsSync('/bad-2-Later.bin'), false);
  const good = await shell.exec('ssconvert --export-graphs -T svg /original.gnumeric /graph-%n-%o.svg');
  assert.equal(good.exitCode, 0, good.stderr);
  assert.equal(good.stdout, ''); assert.equal(good.stderr, '');
  assert.match(volume.readFileSync('/graph-2-Later.svg', 'utf8'), /width="71" height="35"/u);
  volume.mkdirSync('/denied-0.svg');
  const denied = await shell.exec('ssconvert --export-graphs -T svg /original.gnumeric /denied-%n.svg');
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stderr, 'Failed to write file:///denied-0.svg: /denied-0.svg: Is not a regular file\n');
  assert.equal(volume.statSync('/denied-0.svg').isDirectory(), true);
  assert.equal(volume.existsSync('/denied-1.svg'), true);
  assert.equal(volume.existsSync('/denied-2.svg'), false);
  const engine = createEngine({ ...binding, filesystem: createResourceIO({ cwd: '/', filesystem: {
    async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
    async write(path, bytes) { volume.writeFileSync(path, bytes); }
  } }) });
  try {
    const sdkFiles: string[] = [];
    const result = await engine.exportGraphs({ input: { kind: 'stream', source: [new TextEncoder().encode(original)], filename: '/original.gnumeric' }, graph: { template: '/sdk-%n-%o.svg', format: 'svg' } }, { signal: new AbortController().signal });
    for (const artifact of result.artifacts) sdkFiles.push(artifact.uri);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(sdkFiles, ['file:///sdk-0-Last.svg', 'file:///sdk-1-First.svg', 'file:///sdk-2-Later.svg']);
    assert.equal(volume.readFileSync('/sdk-0-Last.svg', 'utf8'), volume.readFileSync('/graph-0-Last.svg', 'utf8'));
  } finally { await engine.dispose(); }
});

test('ssconvert opaque background pixels use the same command and SDK renderer through replay', async () => {
  const original = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Background</g:Name><g:Objects><g:SheetObjectGraph Name="Solid" AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="0 0 72 36"><GogObject type="GogGraph"><property name="style" type="GogStyle"><line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" back="12:34:56:FF" fore="0:0:0:FF" auto-pattern="0"/></fill></property></GogObject></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>';
  const volume = Volume.fromJSON({ '/background.gnumeric': original });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  for (let replay = 0; replay < 2; replay++) {
    const command = await shell.exec('ssconvert --export-graphs -T png /background.gnumeric /command-%n.png');
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stdout, ''); assert.equal(command.stderr, '');
  }
  const engine = createEngine({ ...binding, filesystem: createResourceIO({ cwd: '/', filesystem: {
    async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
    async write(path, bytes) { volume.writeFileSync(path, bytes); }
  } }) });
  try {
    const result = await engine.exportGraphs({ input: { kind: 'stream', source: [new TextEncoder().encode(original)], filename: '/background.gnumeric' }, graph: { template: '/sdk-%n.png', format: 'png' } }, { signal: new AbortController().signal });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.artifacts.map(artifact => artifact.uri), ['file:///sdk-0.png']);
    assert.deepEqual(volume.readFileSync('/sdk-0.png'), volume.readFileSync('/command-0.png'));
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ['/background.gnumeric', '/command-0.png', '/sdk-0.png']);
  } finally { await engine.dispose(); }
});
