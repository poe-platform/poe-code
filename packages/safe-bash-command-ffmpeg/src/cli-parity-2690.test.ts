import { Volume } from "memfs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import {
  createFfmpegCommand,
} from "./index.js";

function createTestVfs(initialFiles: Record<string, Uint8Array | string> = {}) {
  const volume = new Volume();
  const store = new Map<string, Uint8Array>();
  const set = store.set.bind(store);
  store.set = (path, data) => {
    volume.mkdirSync(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true });
    volume.writeFileSync(path, data);
    return set(path, data);
  };
  for (const [path, data] of Object.entries(initialFiles)) {
    store.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
  }
  return {
    store,
    fs: {
      async readFile(path: string) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); },
      async writeFile(path: string, data: Uint8Array) { store.set(path, data); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async stat(path: string) { return volume.statSync(path); }
    }
  };
}

async function runCmd(
  cmdDef: ReturnType<typeof createFfmpegCommand>,
  args: string[],
  vfs: ReturnType<typeof createTestVfs>,
  stdinBytes = new Uint8Array(0)
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes: Uint8Array }> {
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];
  const controller = new AbortController();

  const res = await cmdDef.execute({
    args,
    cwd: "/",
    env: {},
    fs: vfs.fs as never,
    signal: controller.signal,
    stdin: (async function* () {
      if (stdinBytes.byteLength > 0) yield stdinBytes;
    })() as never,
    stdout: {
      async write(chunk: Uint8Array) {
        outChunks.push(chunk);
      }
    } as never,
    stderr: {
      async write(chunk: Uint8Array) {
        errChunks.push(chunk);
      }
    } as never
  } as never);

  const concat = (arr: Uint8Array[]) => {
    const total = arr.reduce((a, b) => a + b.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of arr) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  };

  const stdoutBytes = concat(outChunks);
  const stderrBytes = concat(errChunks);
  return {
    exitCode: res.exitCode,
    stdout: new TextDecoder().decode(stdoutBytes),
    stderr: new TextDecoder().decode(stderrBytes),
    stdoutBytes
  };
}

for (const args of [
  ['-t', '3', '-i'], ['-to', '3', '-i'], ['-i']
]) {
  it(`generates requested lavfi duration ${args.join(' ')}`, async () => {
    const vfs = createTestVfs();
    const suffix = args.length === 1 ? ['-to', '3'] : [];
    const result = await runCmd(createFfmpegCommand(), ['-f', 'lavfi', ...args, 'color=c=red:s=2x2:r=10', ...suffix, '/out.mp4'], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(parseMp4(vfs.store.get('/out.mp4')!).tracks[0]!.samples.length, 30);
  });
}

it('resolves explicit HLS segments from cwd and creates their parent directory', async () => {
  const vfs = createTestVfs({ '/in.mp4': createSyntheticMp4({width: 2, height: 2, fps: 2, durationSeconds: 1}) });
  const directories = new Set(['/']);
  Object.assign(vfs.fs, { async mkdir(path: string) { directories.add(path); } });
  const write = vfs.fs.writeFile;
  vfs.fs.writeFile = async (path, data) => {
    assert.ok(directories.has(path.slice(0, path.lastIndexOf('/')) || '/'), `missing parent for ${path}`);
    await write(path, data);
  };
  const result = await runCmd(createFfmpegCommand(), ['-i', '/in.mp4', '-hls_segment_filename', 'hls/nested/seg_%03d.ts', 'hls/index.m3u8'], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(vfs.store.has('/hls/nested/seg_000.ts'));
  assert.ok(new TextDecoder().decode(vfs.store.get('/hls/index.m3u8')).includes('nested/seg_000.ts'));
});

it('honors independent input/output start numbers and reads beyond 1000 frames', async () => {
  const vfs = createTestVfs();
  const cmd = createFfmpegCommand();
  assert.equal((await runCmd(cmd, ['-f', 'lavfi', '-i', 'color=s=1x1:r=1:d=1', '/pixel.png'], vfs)).exitCode, 0);
  for (let i = 5; i < 1006; i++) vfs.store.set(`/frame_${String(i).padStart(4, '0')}.png`, vfs.store.get('/pixel.png')!);
  const result = await runCmd(cmd, ['-start_number', '5', '-i', 'frame_%04d.png', '-start_number', '20', 'out_%04d.png'], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(vfs.store.has('/out_0020.png'));
  assert.ok(vfs.store.has('/out_1020.png'));
  assert.equal([...vfs.store.keys()].filter(p => p.startsWith('/out_')).length, 1001);
});

it('returns failure and preserves existing output with -n', async () => {
  const vfs = createTestVfs({'/out.mp4': 'existing'});
  const result = await runCmd(createFfmpegCommand(), ['-n', '-f', 'lavfi', '-i', 'color=s=2x2', '/out.mp4'], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('already exists'));
  assert.equal(new TextDecoder().decode(vfs.store.get('/out.mp4')), 'existing');
});

it('fails rather than silently truncating sequences at consumer frame limits', async () => {
  const vfs = createTestVfs();
  await runCmd(createFfmpegCommand(), ['-f', 'lavfi', '-i', 'color=s=1x1:r=1:d=1', '/pixel.png'], vfs);
  for (let i = 0; i < 4; i++) vfs.store.set(`/frame_${i}.png`, vfs.store.get('/pixel.png')!);
  const result = await runCmd(createFfmpegCommand({ limits: { maxFrames: 2 } }), ['-i', 'frame_%d.png', '/out.mp4'], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(!vfs.store.has('/out.mp4'));
});

// Native FFmpeg reference PNGs for a white 4x4 box at (2,2) on a black 16x10 canvas.
// Generated with the same lavfi source/filter chain and -frames:v 1 -f image2pipe -vcodec png.
for (const [angle, reference] of [
  ["0", "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAK0lEQVR4nGNkYGD4z0ABYKFEM4oB//+jOoSRkZHOLhh4A4j1M+1cMGAGAACzeAQobtWGlgAAAABJRU5ErkJggg=="],
  ["PI/2", "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAKklEQVR4nGNkYGD4z4AD/P+PKsXIyIihhgWXZmIBbQ3A5mT6umDUAOIAAP+UBCi0tkJ2AAAAAElFTkSuQmCC"],
  ["-PI/2", "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAJElEQVR4nGNkYGD4z0ABYKFE86gBtDTg/3/UmGVkZKSzC0gBAL1OBCWBjEyUAAAAAElFTkSuQmCC"],
  ["PI", "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAKElEQVR4nGNkYGD4z0ABYKFE8xAz4P9/1KBiZGSkswsG3gCYn6nuAgDLdAQoQiHNmAAAAABJRU5ErkJggg=="],
  ["0.4", "iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAhklEQVR4nMWPwQkDIRBFfyQVWIAN2IhgE4JWYC8eBC3BSuxArMOri7IG9hCipzz4MDD8x8wLQMeN9x6MMYQQkFLCDu81UEphjAEhBEII1FohpUQpZU+gtZ7lRe/9Z/kh4Jw/FuONHT4CpRScc/OSkRjjmWCQc56x1qK1di5Y7Ja/Ck74v+ACCQYrW7VA+6kAAAAASUVORK5CYII="],
] as const) {
  it(`matches native rotate=${angle} pixels and default canvas`, async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    for (const argument of [angle, `angle=${angle}`, `a=${angle}`, `(${angle}) * 2 / 2 + 0 - 0`, ...(angle === "0.4" ? ["4e-1"] : [])]) {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=black:s=16x10:r=1:d=1",
        "-vf", `format=rgba,drawbox=x=2:y=2:w=4:h=4:color=white:t=fill,rotate=${argument}`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = decodeImage(vfs.store.get("/out.png")!);
      const expected = decodeImage(Buffer.from(reference, "base64"));
      assert.equal(actual.width, expected.width);
      assert.equal(actual.height, expected.height);
      for (let i = 0; i < expected.data.length; i++) {
        assert.ok(Math.abs(actual.data[i]! - expected.data[i]!) <= 1,
          `${argument}, channel ${i}: ${actual.data[i]} != ${expected.data[i]}`);
      }
    }
  });
}

it("rejects invalid rotate angles without replacing output", async () => {
  for (const angle of ["garbage", "1/0", "PI/", "0junk", "(", "1e999"]) {
    const vfs = createTestVfs({ "/out.png": "existing" });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-f", "lavfi", "-i", "color=s=16x10:r=1:d=1", "-vf", `rotate=${angle}`, "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 1, angle);
    assert.ok(result.stderr.includes("rotate:"), result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")!), "existing");
  }
});
