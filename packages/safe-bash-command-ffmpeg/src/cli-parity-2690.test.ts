import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { Volume } from "memfs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
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

for (const maps of [["0:a:99"], ["0:v", "0:a:99"]]) {
  for (const existing of [false, true]) {
    it(`rejects unmatched required maps ${maps} and preserves output (${existing})`, async () => {
      const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ includeAudio: true }), ...(existing ? { "/out.mp4": "existing" } : {}) });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
      assert.equal(result.exitCode, 234);
      assert.ok(result.stderr.includes("matches no streams"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.mp4"), existing ? new TextEncoder().encode("existing") : undefined);
    });
  }
}

for (const [maps, expected] of [
  [["0:a:99?"], ["video", "audio"]],
  [["0:a:99?", "0:s?"], ["video", "audio"]],
  [["0:a:99?", "0:v"], ["video"]],
  [["0:a:1", "0:a:99?", "0:v"], ["audio", "video"]]
] as const) {
  it(`ignores unmatched optional maps ${maps} and publishes selected streams`, async () => {
    const doc = parseMp4(createSyntheticMp4({ includeAudio: true }));
    const audio = doc.tracks.find(track => track.type === "audio")!;
    const bytes = serializeMp4({ ...doc, tracks: [...doc.tracks, { ...audio, id: 3 }] });
    const vfs = createTestVfs({ "/in.mp4": bytes });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/out.mp4")!);
    assert.deepEqual(output.tracks.map(track => track.type), expected);
    assert.ok(output.tracks.every(track => track.samples.length > 0));
  });
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

// Native FFmpeg 9.0.1 RGBA output for the same 3x2 colors supplied as rgb24 rawvideo.
for (const [angle, pixels] of [
  ["PI/2", [255,127,127,191,95,63,191,95,63,127,127,255,63,95,191,63,95,191]],
  ["-PI/2", [63,95,191,63,95,191,127,127,255,191,95,63,191,95,63,255,127,127]],
  ["PI/4", [219,30,204,114,83,24,72,86,162,255,90,164,140,89,230,0,37,255]],
  ["-PI/4", [162,86,72,24,83,114,0,217,255,50,104,35,230,89,140,164,90,255]]
] as const) {
  it(`matches native rotate=${angle} boundary pixels on a 3x2 canvas`, async () => {
    const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({
      width: 3, height: 2, channels: 4,
      data: new Uint8Array([255,0,0,255,0,128,0,255,0,0,255,255,255,255,0,255,255,0,255,255,0,255,255,255]),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/input.png": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.png", "-vf", `rotate=${angle}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, 3);
    assert.equal(actual.height, 2);
    assert.deepEqual([...actual.data], pixels.flatMap((value, i) => i % 3 === 2 ? [value, 255] : [value]));
  });
}

// Native FFmpeg 9.0.1: -i h264-b-frames.mp4 -vf FILTER -frames:v 1 -f rawvideo -pix_fmt rgba.
// Deflated RGBA pixels; one-level tolerance covers decoder color-conversion rounding.
for (const [filter, compressed] of [
  [
    "rotate=PI/2",
    "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"
  ],
  [
    "rotate=-PI/2",
    "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"
  ],
  [
    "rotate=PI/4",
    "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"
  ],
  [
    "rotate=-PI/4",
    "eJy9mnt0lPWdhz/vzGRmyD2BILmQISE3EnIhyUwyt3dmMrlyCRAuy93FIuJyBwWFhCTcFTmCi4BlLXbdtXUR0KKo7crSU7dW0dba1tWjBym4tu6x9dIWOMbwWd/fO5PJJJlMEkIP5zmE5K/n+33eeX/vGwAQw8pBRkWdpi7isiBeO0tg1rkFdklW0VoEd8ZFcjZAL/JZKxWyPTeVv9u6ll/tiOWrc8GqHHBGObi+XsOfHJzCjMXzqZVthEseGCMTVYbds28Ud78/8FvqUS/Ih7mX/7xxs3jh3nU84nGwBhOF/3yAWzOS+EV7NP/UOoKPt0/jUw/O5Y8PTObaWgj3Qfn7Z3DL3Q9yRPRp6nWXVPTzCTQScAiiUcwkqZJOjUqDZiTX59t5oaWdx2fMpgwL7ShjtTSJbhRyTXYpm8vcbK+ewU3WahY2zWOCxTE4779jB4q73x94x+ce7B+LSSxHcZe/wur0TM6KGEE3KulAOT0oEtQjRlBtSKRXn8CIgkk353/LOjhIY8xpwnBJEGFY/K1/EwGZgJNJiGFOpIk7HOPYbk/nvlzwCQdYg0xWI0N4V2lsbJRG846kfO6113EaoimjROCEQ1CmtdER7WVshVsw9BnEqwyTv+Le5S/23uTDScAu3B/euJdnVs/g2bWz+HFbFT/dVced8lLWSll0wizan21I439t2MM3t+1jc5GdbqlUIEPu8lfQTDTfnL/LMWz+6enp1EVcEgT2rvaegGyO0U/k63el89Ey8DaM5lik8b4Sib/aM49/bhnDU06lg3E+MrmhcAafWLCONUiiEzbKcAh//wxurgNHMInxKkN0v3LlCtva2oR7YO+zxM4V/0TkMDOhgu9vLmJbuuqfgjFs1IObisCv2tIEO5xLuvyVHmoxWqC6B/xvvoNgf0l2DMk/KQG8/tfZ7OwYL6ira6A+wqj2LsmMxARGIZ+piKI9JZ8Xmhu4OA5Mwkg2TKrjK3s2cmF2AteUjeSrD9zNN3cu4x0p6NpvX949ZzC4Dnp7C3f/zwfpr7j7/Y8eBissVppMGcJfo3UzIaKERuR2+b+9fTrPb3AxLz6HyxuX8dzee7ilpoQWQMzgZ1sWsGkEaEa5z83Wr//gOxge//hR4F+uNbHjm/GCfbvL6ZVB2aViTgWLRoE/XW3myfkZPH97PC+2FJPtINvAX62I5mo9aM5bwEgUsxDgKksOn9l8t/g6EjYmRlTRqnELQrv7CddBGG+38rV9wP6Ku9//8BEI92pXwH+hexwPNy/iYzUxPDHXxNON4Mc7yoV751bw0/Zs/mZlHE2J1YzGJJYAXJiVxJd3bmJ1nIZGWAUlsAzIP3wHYfwVd0dlWO/YJPDL6zN4lSbB7gdKKXtUZ5dbotcB1nvA17cl8NllYOkYMFUCcwG2NzXwWusI/q1FT7ZJgjPrpvLx+WY+OjOHb+xayPzsxdSighrl+oGTRtiZGFHdqwNnSEJ1EGbvixZQf/ZMWP8vrjV2+T/yXQh3V5XqrlDthJjBuQ0R/M/1OjaWp7I8ReLMzGRO0oDn6yFmwBYIHptbyn+/Q+ZL9zTwOyYI957+Cj07COUfuoP+9664V/zh49DuXrDivVIe6UjjGVZyx74S2r2gSwY9LomyRyvwuiC4sBF85U5wmRlsmwm+un8un1pbySzE8L7ZS/nWznm8t1BiAlKYiFTqIzy+e6UziJ4dVGrdgtD7D8assdEZ5WVchVsgybKg195vkOjoCOlvfneS4O63QPe/Qbg7qlX37v7V37bfUAO+2zKCl/aO4vF1yVzpAJ+938uH5qQzHQZmIpIvr6tmW0WU8FdQ3fv3VyiCZUD+Mtxd/gq6AjNjLa6Af8+9K+7KDPrYu/m9ciZ9PpojPxvJrHvGETXgeBc4oSaCLqV/5fqvUql3gw0ecPM08CcHzby+28i3l4CLrOBiGzg5CayJB8/tWsEVxcrzh83n7eqBs08MsDNe308HkkPF928bHIKyiBI6Yq2MsngFWLSI+hdeCOz9Bimxt7/i7vfHSRC1KqkV6gyccsB/8vQRnOJVZ7CkXJ3BX9p1/Ov2CB5aP5YLK8HVlVqutUXwp3tXcUGGrtveB+5v6K+DHv7KuwW/v8VYRk2hTfgr7hWffBLkHuTvBcvfszHp80SBafN4ogGEW1JxSdR6tBzvBvPrdNzaAJ7bX8YDq1M43wLaXKDdDbZMUb//zr48vtaezl88NIlvPlxOr8dJo17Th/fwdOA/N/p/bpdUVqCZz+X+N+UPSdv/kOjs7HLv7q+4+/1xCqp7AyhV6wiPRvgrJFvALA/Y2gi++kglj9yTIVp3+JpYXg4xm6NN4JOLwEfmgHungnarmRmm1Jvy76+DUP7HEk7z+YLXmXDqspiB2H+3GWA0uPdELUd9MUowblMuUe/buwtMqlRJLQHTy8B4m0q5FZwxJ4ZVdrBalthoA6c7wDoZrHGA1Q7QY/WdEzyB+6XJZKLBYLjpDixaWdD9Pqjghk3Qhmb+SHdKESbxDd+L+4rXi0nnRbLy/UAHrqXghkMlwl3svR4BfxnM8ILT1mVzzj+ZOOPOZDZszGeCHZxQBJptqrty/18yBWxdmS78FWpldQb+z0u/v9VqFTO42Q4KUd6vv+L+y3Fv+Pw7+EHiVTGDuGcvihn4O/ijMYp/METSOXssU0tBuLSErGFaOTjBDf5sSyTPbzbwyd0T+cJjMj/bGccXp4MjS8HR5WCxA7TWSTyx38HnD9fw3n+M5cw+vHsy9A7U7wc6cAvsGpugGVt4Sv8Mb6BDQHR240avDv5Xb+TPARrSwaSJAX/FveVQPY81gctSweo8cGUj+Kdd8fx8TwJnri3mbWYwp0ydwcY5Oh65P4+NVnC6Lbz/0DsI+KsdWIL8Ffc3Mn8Rwr+zVwfL4mI5FcrzNygDzM0GCyaA9d+6PfXPZtYuHsXkEnBsMVjoBvfUgW8fyOL/7Y3m801gjE1FmUG5B7S7QIdbOSdLglD+A++g7+vATwRcjNXXcyV28vGYs/wanYIbPgLu9BHcwRRA4PDNIPk2MCsTnFMFnvyug5ZpWnFd1M2P44En53F3jToDxf+zB2OZMytO+CsdFNlBm6z6+2cQzj98B/376yALtuMYX57wzgD9Ax0UIo3FkomTAc7Wg9MBNgJ8uAD8485R/HVrDFsLwfXLI/kfT1Sz9j4zI+3gqpngjw5XMG+yJO4Pyr1C65GY4ZaYW2sImkHfc9AG0buDvs/FGri6kMQ75uMETjIFX9KdTH5iVOnZfagOijBWsDAG/PHqmXxuaQVfvMvJi1si+emuJH74YLKYwRQ3+A/TINwV1s0Gn95fxNFWdPkrJFdCzCB8B8H+vTvo319xV/1P0mB8QfgrnMfvB+HfyRLlXWN0Fn+7KpHPNYA/nJ/P703P4NfbY3itNYrftIMdbeBr20dzcylYVqSyvh585VAJRzbFifuk8O92TgzdgbZfAh2E2ruTknjH/DiBEwQ6fHQKBtuBRZfGf1m5g89PA5f52p8G9bn96rZI4a/wuwNZYgZtW03cuimF5x6dxJVeqO5yYP9d58SQHfTvH+gg1N4dPv8TNBrP9Ok/0A6O4ggroeGhBUv4zOJCce03ANyQp+OaBPAHk7X8W3s8r+9M5DsHbfzB8ji27KrgzodkZi5KpcbZ3bsb3Z8XXBIn1BgoK8/Mrv78e94XxtJg0HV5a8UMFO9jBJ7u5h3sP9AOjuJRgeJ/9PY7+MP5eZwhgasywbd23M4La3J5pxF8pQG8tiOB2z3gvNvAvBKwoBTCPaR/tw7U50aJDifCzKDnfaFCzCDQvcPn/zSNxucG5B+qA7+7wlQt+OKaRbzapuGF2eBdAF9bmswHap2sAjgP4M9Xl3JfVTbrAKZmgxkF+j66H2oHfd8X/e8XMsel0RAhib1rBrD3cB34vf3PfTUAl47R87N7wWvtWr7UFMnl4v8jQPgviwJ/fb/M7dZU4R87Rp3BgPwH1EFof5dXfW40jU0W7pGG8Hvvr4NtON7LfyPAFcq7+DHghc0NvL7NyDebwIXK7yfiwb054JX2Cn4na5w4H/pJzgFNE/vpQO4+o0F04D83e9X91zaAZ18eweZtW5mSljxg79686yP4fc+xdJOYwUyAq5PBLzdL7GiP4oU1Zr7f7OXlNgt3ZCDIXSE6WZ3BgPzlQXTgAd2+9q1O1f2rqzX84OIHYgZD878c0r/ZXMlNxaW8T2lAaSFFw7bSVO6pSGZLYTyXZZro6ubt8BGyg/7oowOHWxL4zweKuzID/96/uQFe74D4+wYltrS2MiUtbZDul0O+51X8WyxWHh+bLmYw2cdU31nA5SOUf68OBjgDfwfq+UAS5wNXlUa42xyBvXd3V/j9x1fEDAbnHtr/EMCPoqLZVl7B+wtLujoI5TtsHbhBbRWY4QHz6jVdn/eh9n6D2iDCd9C/d3d/hdYyi5iBv4PB+g+6AzcoecBkK5hZpZ4Pu1/vPffe07//DsLvvScHAX4YY+zqYIvy+X8rO3D78IAar4ZxC8Htv8xgZyf49deh9x6+g8F5d/c/2K2D76elixnckg5cvf2nPQb+65/dg/YP7mDwew/3eTDkDrI1NBUYqXFAENi77/cJHi1RpSPWgbqXjITypxPcT/AZmnhdzCC8vx9IUBmid6jPgyF3MEadQZC/Swr4K+5VOmpe1LPgUrHwlwgu+Y06A8V9oDNIHYth8x/uDlKzNcwoMKrvVRXE7jXEWlB3NtJnLan79/8ZRAeKu/AfJu/h7kB9XtAE/BV3j0a4F35U1rf/ADvwu98K/5vtoCcpuRIzioy+vesJ5ZoNYnAd3Grvm+2gr+cFZQaKe+FHxQPzD9HBcO79/wF3DVTX"
  ],
  [
    "format=rgba,rotate=PI/2",
    "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"
  ],
  [
    "rotate=PI/2,rotate=-PI/2",
    "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"
  ]
] as const) {
  it(`matches native YUV MP4 pixels for ${filter}`, async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
    const vfs = createTestVfs({ "/input.mp4": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.mp4", "-vf", filter, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, 64);
    assert.equal(actual.height, 48);
    const expected = inflateSync(Buffer.from(compressed, "base64"));
    assert.equal(actual.data.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assert.ok(Math.abs(actual.data[i]! - expected[i]!) <= 1,
        `channel ${i}: ${actual.data[i]} != ${expected[i]}`);
    }
  });
}
