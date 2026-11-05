import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createSyntheticMp4, decodeH264Samples, mp4Ast, parseMp4, serializeMp4, parseMpegTs, parseWav } from "@poe-code/mp4-ast";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  createFfmpegCommand,
  evalSyncFfmpeg,
  createFfmpegCommands,
  createFfprobeCommand,
  type FfmpegCommandsOptions
} from "./index.js";

describe("tile frame grouping", () => {
  // Native FFmpeg with RGB input: occupied cells are white, unused cells black.
  for (const [options, occupied] of [
    ["", [4]],
    [":nb_frames=0", [4]],
    [":nb_frames=1", [1, 1, 1, 1]],
    [":nb_frames=2", [2, 2]],
    [":nb_frames=3", [3, 1]],
    [":nb_frames=4", [4]]
  ] as const) {
    it(`matches native sheet counts and cells for tile=2x2${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=white:s=16x16:r=1:d=4",
        "-vf", `tile=2x2${options}`, "/out_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, occupied.length);
      for (const [index, count] of occupied.entries()) {
        const sheet = decodeImage(vfs.store.get(`/out_${index + 1}.png`)!);
        assert.equal(sheet.width, 32);
        assert.equal(sheet.height, 32);
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const cell = Math.floor(y / 16) * 2 + Math.floor(x / 16);
            const offset = (y * 32 + x) * 4;
            const value = cell < count ? 255 : 0;
            assert.deepEqual([...sheet.data.subarray(offset, offset + 4)], [value, value, value, 255]);
          }
        }
      }
    });
  }
});

describe("tile background", () => {
  for (const [option, background] of [
    ["", [0, 0, 0, 255]],
    [":color=yellow", [255, 255, 0, 255]],
    [":color=0xff0000@0.5", [255, 0, 0, 127]]
  ] as const) {
    it(`fills margins, gaps and unused tiles with ${option || "default black"}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const blue = [0, 0, 255, 255];
      const vfs = createTestVfs({
        "/in.png": encodeImage({
          width: 16, height: 16, channels: 4, format: "png", space: "srgb",
          depth: "uchar", density: 72, hasAlpha: true,
          data: Uint8Array.from(Array(256).fill(blue).flat())
        }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/in.png",
        "-vf", `tile=2x2:padding=4:margin=4${option}`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 44);
      assert.equal(image.height, 44);
      for (let y = 0; y < 44; y++) {
        for (let x = 0; x < 44; x++) {
          const offset = (y * 44 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x >= 4 && x < 20 && y >= 4 && y < 20 ? blue : background,
            `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

describe("overlay alpha", () => {
  // Decoded native FFmpeg PNG pixels for a green overlay on opaque red.
  for (const [alpha, expected] of [
    [0, [255, 0, 0, 255]],
    [128, [127, 128, 0, 255]],
    [255, [0, 255, 0, 255]]
  ] as const) {
    it(`matches native PNG pixels with overlay alpha ${alpha}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const red = [255, 0, 0, 255];
      const vfs = createTestVfs({
        "/base.png": encodeImage({ width: 8, height: 8, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(64).fill(red).flat()) }, { format: "png" }).data,
        "/logo.png": encodeImage({ width: 2, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(4).fill([0, 255, 0, alpha]).flat()) }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/base.png", "-i", "/logo.png",
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=rgb",
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 8);
      assert.equal(image.height, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x < 2 && y < 2 ? expected : red, `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

describe("overlay offsets", () => {
  for (const [options, ox, oy] of [
    ["x=2:y=2:format=rgb", 2, 2],
    ["y=3:x=2:format=rgb", 2, 3],
    ["2:3:format=rgb", 2, 3],
    ["2:y=3:format=rgb", 2, 3],
    ["y=2:format=rgb", 0, 2],
    ["x=2:format=rgb", 2, 0],
    ["format=rgb", 0, 0]
  ] as const) {
    it(`positions PNG pixels for ${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const red = [255, 0, 0, 255];
      const green = [0, 255, 0, 255];
      const vfs = createTestVfs({
        "/base.png": encodeImage({ width: 8, height: 8, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(64).fill(red).flat()) }, { format: "png" }).data,
        "/logo.png": encodeImage({ width: 2, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(4).fill(green).flat()) }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/base.png", "-i", "/logo.png",
        "-filter_complex", `[0:v][1:v]overlay=${options}`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 8);
      assert.equal(image.height, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x >= ox && x < ox + 2 && y >= oy && y < oy + 2 ? green : red,
            `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

function createTestVfs(initialFiles: Record<string, Uint8Array | string> = {}) {
  const store = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(initialFiles)) {
    const key = k.startsWith("/") ? k : `/${k}`;
    store.set(key, typeof v === "string" ? new TextEncoder().encode(v) : v);
  }

  return {
    store,
    fs: {
      async mkdir() {},
      async readFile(path: string) {
        const key = path.startsWith("/") ? path : `/${path}`;
        const val = store.get(key);
        if (!val) {
          const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        }
        return val;
      },
      async writeFile(path: string, data: Uint8Array) {
        const key = path.startsWith("/") ? path : `/${path}`;
        store.set(key, data);
      },
      async stat(path: string) {
        const key = path.startsWith("/") ? path : `/${path}`;
        const val = store.get(key);
        if (!val) {
          const err = new Error(`ENOENT: ${path}`) as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        }
        return { type: "file" as const, size: val.byteLength, mode: 0o644, mtimeMs: 0 };
      }
    }
  };
}

async function runCmd(
  cmdDef: ReturnType<typeof createFfmpegCommand>,
  args: string[],
  vfs: ReturnType<typeof createTestVfs>,
  stdinBytes = new Uint8Array(0),
  signal = new AbortController().signal
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes: Uint8Array }> {
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];

  const res = await cmdDef.execute({
    args,
    cwd: "/",
    env: {},
    fs: vfs.fs as never,
    signal,
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

describe("aliceblue color source", () => {
  for (const [color, alpha] of [["aliceblue", 255], ["AliceBlue", 255], ["aliceblue@0.5", 127]] as const) {
    it(`renders ${color} with the native RGB values`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", `color=c=${color}:s=16x16:r=1:d=1`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let offset = 0; offset < image.data.length; offset += 4) {
        assert.deepEqual([...image.data.subarray(offset, offset + 4)], [240, 248, 255, alpha]);
      }
    });
  }
});

describe("pad background alpha", () => {
  for (const [color, alpha] of [["red@0.5", 127], ["red@0", 0], ["0xff000080", 128], ["red", 255]] as const) {
    for (const filter of [
      `pad=4:4:1:1:color=${color}`,
      `pad=4:4:1:1:${color}`,
      `pad=4:4:x=(ow-iw)/2:y=(oh-ih)/2:color=${color}`,
      `pad=4:4:(out_w-in_w)/2:(out_h-in_h)/2:${color}`
    ]) {
      it(`preserves border and source RGBA pixels for ${filter}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 2, height: 2, channels: 4,
          data: new Uint8Array([255, 128, 64, 0].flatMap((a) => [0, 0, 255, a])),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", filter, "-frames:v", "1", "-update", "1", "/pad.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/pad.png")!);
        assert.equal(output.width, 4);
        assert.equal(output.height, 4);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const offset = (y * 4 + x) * 4;
            const source = x >= 1 && x <= 2 && y >= 1 && y <= 2;
            const expected = source ? [0, 0, 255, [255, 128, 64, 0][(y - 1) * 2 + x - 1]] : [255, 0, 0, alpha];
            assert.deepEqual([...output.data.subarray(offset, offset + 4)], expected);
          }
        }
      });
    }
  }
});

describe("pad position expressions", () => {
  for (const [position, left, top] of [
    ["-1:-1", 1, 1],
    ["-2:0", 1, 0],
    ["0:-3", 0, 1],
    ["x=-1:y=2", 1, 2],
    ["x=2:y=-1", 2, 1],
    ["0:0", 0, 0],
    ["2:2", 2, 2],
    ["(ow-iw)/2:(oh-ih)/2", 1, 1]
  ] as const) {
    for (const size of [5, 6]) {
      it(`places source pixels for pad=${size}:${size}:${position}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 3, height: 3, channels: 4,
          data: new Uint8Array(Array.from({ length: 9 }, () => [0, 0, 255, 255]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", `pad=${size}:${size}:${position}:color=red`,
          "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/pad.png")!);
        assert.equal(output.width, size);
        assert.equal(output.height, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const source = x >= left && x < left + 3 && y >= top && y < top + 3;
            assert.deepEqual([...output.data.subarray(offset, offset + 4)],
              source ? [0, 0, 255, 255] : [255, 0, 0, 255], `pixel (${x}, ${y})`);
          }
        }
      });
    }
  }

  for (const expression of ["unknown", "1junk", "1/0", "(ow-iw", "sin(0)"]) {
    for (const axis of ["x", "y"]) {
      it(`rejects unsupported ${axis}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/pad.png": "original" });
        const original = vfs.store.get("/pad.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=blue:s=2x2:r=1:d=1",
          "-vf", `pad=4:4:${axis}=${expression}`, "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("pad: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/pad.png"), original);
      });
    }
  }
});

describe("pad dimensions", () => {
  for (const filter of ["pad=8:8", "pad=8:32", "pad=32:8", "pad=w=iw/2:h=ih", "pad=width=iw:height=ih/2"]) {
    for (const existing of [false, true]) {
      it(`rejects ${filter} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const vfs = createTestVfs(existing ? { "/pad.png": "original" } : {});
        const original = vfs.store.get("/pad.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
          "-vf", filter, "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Padded dimensions cannot be smaller than input dimensions"), result.stderr);
        assert.equal(result.stdoutBytes.length, 0);
        assert.deepEqual(vfs.store.get("/pad.png"), original);
      });
    }
  }

  for (const [filter, width, height] of [
    ["pad=16:16", 16, 16],
    ["pad=32:24", 32, 24],
    ["pad=0:24", 16, 24],
    ["pad=32:0", 32, 16],
    ["scale=16:24,pad=32:0", 32, 24]
  ] as const) {
    it(`accepts ${filter}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
        "-vf", filter, "-frames:v", "1", "/pad.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/pad.png")!);
      assert.equal(image.width, width);
      assert.equal(image.height, height);
    });
  }
});

describe("video filter separators", () => {
  it("accepts the quoted select expression when extracting a PNG", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=16x16:rate=4:duration=1",
      "-vf", "select='not(mod(n,2))'", "-frames:v", "1", "/safe.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    assert.equal(decodeImage(vfs.store.get("/safe.png")!).width, 16);
  });

  for (const expression of ["'not(mod(n,2))'", "not(mod(n\\,2))", "'not(mod(n,'2'))'"]) {
    it(`preserves expression commas in ${expression} and runs the following filter`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "testsrc=size=16x16:rate=4:duration=1",
        "-vf", `select=${expression},scale=8:8`, "/selected_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()], ["/selected_1.png", "/selected_2.png", "/selected_3.png"]);
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      assert.equal(decodeImage(vfs.store.get("/selected_1.png")!).width, 8);
    });
  }
});

describe("transpose directions", () => {
  // Native FFmpeg's pixel order for a 3x2 image containing rows 1,2,3 / 4,5,6.
  for (const [dir, order] of [
    [0, [1, 4, 2, 5, 3, 6]],
    [1, [4, 1, 5, 2, 6, 3]],
    [2, [3, 6, 2, 5, 1, 4]],
    [3, [6, 3, 5, 2, 4, 1]]
  ] as const) {
    for (const filter of [`transpose=${dir}`, `transpose=dir=${dir}`]) {
      it(`matches native decoded pixels for ${filter}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const pixel = (n: number) => [n * 30, n * 20, n * 10, 255];
        const input = encodeImage({
          width: 3, height: 2, channels: 4,
          data: new Uint8Array([1, 2, 3, 4, 5, 6].flatMap(pixel)),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-v", "error", "-i", "/input.png", "-vf", filter, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, 2);
        assert.equal(output.height, 3);
        assert.deepEqual(output.data, new Uint8Array(order.flatMap(pixel)));
      });
    }
  }
});

describe("drawbox position expressions", () => {
  for (const options of [
    "x=iw-2:y=ih-2:w=2:h=2:color=red:t=fill",
    "x=iw-w:y=ih-h:w=2:h=2:color=red:t=fill",
    "x=iw-w:y=ih-h:w=iw/2:h=ih/2:color=red:t=fill",
    "in_w-w:in_h-h:in_w/2:in_h/2:red:fill",
    "in_w-2:in_h-2:2:2:red:fill",
    "x=(iw-2)/2+1:y=ih/2:w=2:h=2:color=red:t=fill",
    "x=2.9:y=2.1:w=2:h=2:color=red:t=fill"
  ]) {
    it(`places the box in the bottom-right corner for ${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=white:s=8x8:r=1:d=1",
        "-vf", `scale=4:4,drawbox=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const offset = (y * 4 + x) * 4;
          assert.deepEqual([...image.data.slice(offset, offset + 4)],
            x >= 2 && y >= 2 ? [255, 0, 0, 255] : [255, 255, 255, 255], `pixel (${x},${y})`);
        }
      }
    });
  }

  for (const expression of ["unknown", "1junk", "1/0", "(iw-2", "sin(0)"]) {
    for (const axis of ["x", "y"]) {
      it(`rejects ${axis}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/out.png": "original" });
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=white:s=4x4:r=1:d=1",
          "-vf", `drawbox=${axis}=${expression}:w=2:h=2:t=fill`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("drawbox: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), original);
      });
    }
  }
});

describe("drawbox dimension expressions", () => {
  // Native FFmpeg on an opaque black 8x8 RGBA input produces these box sizes.
  for (const [dimensions, size] of [
    ["w=4:h=4", 4],
    ["w=iw/2:h=ih/2", 4],
    ["w=iw-2:h=ih-2", 6],
    ["width=in_w/2:height=in_h/2", 4],
    ["w=iw/3:h=ih/3", 2],
    ["w=0:h=0", 8]
  ] as const) {
    it(`matches native pixels for ${dimensions}`, async () => {
      const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(8 * 8 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const input = encodeImage({
        width: 8, height: 8, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `drawbox=x=1:y=1:${dimensions}:color=red:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...output.data.slice(offset, offset + 4)],
            x >= 1 && x < 1 + size && y >= 1 && y < 1 + size
              ? [255, 0, 0, 255] : [0, 0, 0, 255], `pixel (${x},${y})`);
        }
      }
    });
  }

  for (const dimension of ["w", "h", "width", "height"]) {
    for (const expression of ["unknown", "1junk", "1/0", "(iw-2"]) {
      it(`rejects ${dimension}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/out.png": "original" });
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=black:s=8x8:r=1:d=1",
          "-vf", `drawbox=${dimension}=${expression}:t=fill`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("drawbox: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), original);
      });
    }
  }
});

describe("drawbox thickness", () => {
  for (const [options, thickness] of [
    ["x=2:y=2:w=12:h=12:color=red:t=1", 1],
    ["x=2:y=2:w=12:h=12:color=red:thickness=2", 2],
    ["2:2:12:12:red:1", 1],
    ["x=2:y=2:w=12:h=12:color=red", 3],
    ["x=2:y=2:w=12:h=12:color=red:t=fill", 12],
    ["x=2:y=2:w=12:h=12:color=red:t=0", 0],
    ["x=2:y=2:w=12:h=12:color=red:t=1.5", 1]
  ] as const) {
    it(`matches native decoded pixels for ${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1:d=1",
        "-vf", `drawbox=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 16);
      assert.equal(image.height, 16);
      // Native FFmpeg's RGB output has the same border mask (YUV conversion
      // slightly changes the red channel, so compare foreground membership).
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const border = x >= 2 && x < 14 && y >= 2 && y < 14
            && Math.min(x - 2, y - 2, 13 - x, 13 - y) < thickness;
          assert.equal(image.data[(y * 16 + x) * 4]! > 200, border, `pixel (${x},${y})`);
        }
      }
    });
  }
});

describe("safe-bash-command-ffmpeg (ffmpeg & ffprobe)", () => {
  it("inspects MP4 streams and format with ffprobe in json, default, csv, and flat formats", async () => {
    const mp4 = createSyntheticMp4({
      width: 128,
      height: 72,
      fps: 10,
      frameCount: 8,
      includeAudio: true,
      metadata: { title: "Test Clip" }
    });
    const vfs = createTestVfs({ "/clip.mp4": mp4 });
    const ffprobe = createFfprobeCommand();

    // JSON output
    const jsonRes = await runCmd(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "/clip.mp4"],
      vfs
    );
    assert.equal(jsonRes.exitCode, 0);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.streams.length, 2);
    assert.equal(parsed.streams[0].codec_name, "h264");
    assert.equal(parsed.streams[0].width, 128);
    assert.equal(parsed.streams[0].height, 72);
    assert.equal(parsed.format.tags.title, "Test Clip");

    // Single value extraction (-of default=noprint_wrappers=1:nokey=1 -select_streams v:0 -show_entries stream=width)
    const widthRes = await runCmd(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "/clip.mp4"
      ],
      vfs
    );
    assert.equal(widthRes.exitCode, 0);
    assert.equal(widthRes.stdout.trim(), "128");
  });

  it("merges multiple MP4 videos via -f concat, concat: protocol, and -filter_complex concat", async () => {
    const clip1 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 5 });
    const clip2 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 7 });
    const listTxt = "ffconcat version 1.0\nfile '/clip1.mp4'\nfile '/clip2.mp4'\n";
    const vfs = createTestVfs({
      "/clip1.mp4": clip1,
      "/clip2.mp4": clip2,
      "/list.txt": listTxt
    });
    const ffmpeg = createFfmpegCommand();

    // 1. -f concat -safe 0 -i /list.txt -c copy /merged_concat_demuxer.mp4
    const r1 = await runCmd(
      ffmpeg,
      ["-f", "concat", "-safe", "0", "-i", "/list.txt", "-c", "copy", "/merged_concat_demuxer.mp4"],
      vfs
    );
    assert.equal(r1.exitCode, 0);
    const doc1 = parseMp4(vfs.store.get("/merged_concat_demuxer.mp4")!);
    assert.equal(doc1.tracks.find((t) => t.type === "video")?.samples.length, 12);

    // 2. concat:/clip1.mp4|/clip2.mp4
    const r2 = await runCmd(
      ffmpeg,
      ["-i", "concat:/clip1.mp4|/clip2.mp4", "-c", "copy", "/merged_protocol.mp4"],
      vfs
    );
    assert.equal(r2.exitCode, 0);
    const doc2 = parseMp4(vfs.store.get("/merged_protocol.mp4")!);
    assert.equal(doc2.tracks.find((t) => t.type === "video")?.samples.length, 12);

    // 3. -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
    const r3 = await runCmd(
      ffmpeg,
      [
        "-i",
        "/clip1.mp4",
        "-i",
        "/clip2.mp4",
        "-filter_complex",
        "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
        "/merged_filter.mp4"
      ],
      vfs
    );
    assert.equal(r3.exitCode, 0);
    const doc3 = parseMp4(vfs.store.get("/merged_filter.mp4")!);
    assert.equal(doc3.tracks.find((t) => t.type === "video")?.samples.length, 12);
  });

  it("decides supported formats strictly from the registered AST plugins", async () => {
    const clip = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 4 });
    const vfs = createTestVfs({ "/clip.mp4": clip });

    // Configure ffmpeg with ONLY mp4Ast()
    const mp4OnlyFfmpeg = createFfmpegCommand({ asts: [mp4Ast()] });

    // MP4 -> MP4 succeeds
    const okRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/copy.mp4"], vfs);
    assert.equal(okRes.exitCode, 0);

    // MP4 -> MKV fails because mkvAst() is not registered
    const failRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/out.mkv"], vfs);
    assert.equal(failRes.exitCode, 1);
    assert.ok((failRes.stderr).includes("format AST not registered"));

    // Registered formats include real AAC-to-WAV extraction.
    const fullFfmpeg = createFfmpegCommand({ asts: allMediaAsts() });
    for (const ext of ["mkv", "webm", "ts", "avi", "flv", "y4m", "gif"]) {
      const res = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", `/out.${ext}`], vfs);
      assert.equal(res.exitCode, 0);
      assert.ok((vfs.store.get(`/out.${ext}`)?.byteLength ?? 0) > 10);
    }
    const wav = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", "/out.wav"], vfs);
    assert.equal(wav.exitCode, 0, wav.stderr);
    assert.ok(parseWav(vfs.store.get("/out.wav")!).durationSeconds > 0);
  });

  it("supports lavfi sources, video filters (scale, crop, pad, hflip, hstack), and image sequence extraction", async () => {
    const vfs = createTestVfs();
    const ffmpeg = createFfmpegCommand();

    // Generate MP4 from lavfi testsrc + scale + pad
    const genRes = await runCmd(
      ffmpeg,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x48:rate=10:duration=0.5",
        "-vf",
        "scale=32:24,pad=48:32:8:4:black,hflip",
        "/filtered.mp4"
      ],
      vfs
    );
    assert.equal(genRes.exitCode, 0);
    const filteredDoc = parseMp4(vfs.store.get("/filtered.mp4")!);
    const vTrack = filteredDoc.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.width, 48);
    assert.equal(vTrack.height, 32);
    assert.equal(vTrack.samples.length, 5);

    // Extract frames to PNG sequence
    const seqRes = await runCmd(
      ffmpeg,
      ["-i", "/filtered.mp4", "/frame_%03d.png"],
      vfs
    );
    assert.equal(seqRes.exitCode, 0);
    assert.equal(vfs.store.has("/frame_001.png"), true);
    assert.equal(vfs.store.has("/frame_005.png"), true);

    // Re-assemble PNG sequence back to MP4
    const assembleRes = await runCmd(
      ffmpeg,
      ["-framerate", "10", "-i", "/frame_%03d.png", "/reassembled.mp4"],
      vfs
    );
    assert.equal(assembleRes.exitCode, 0);
    const reassembledDoc = parseMp4(vfs.store.get("/reassembled.mp4")!);
    assert.equal(reassembledDoc.tracks[0]?.samples.length, 5);
  });

  it("enforces consumer-defined resource limits and opt-in/opt-out feature flags", async () => {
    const clip = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 10 });
    const vfs = createTestVfs({ "/clip.mp4": clip });

    let capturedStats: FfmpegCommandsOptions["onMetrics"] extends ((s: infer S) => void) | undefined ? S | undefined : never;
    const boundedFfmpeg = createFfmpegCommand({
      limits: cloudflareWorkerLimits({ maxFrames: 4 }),
      onMetrics(stats) {
        capturedStats = stats;
      }
    });

    // Stream copy (`-c copy`) does NOT decode frames, so 10-frame clip succeeds even with maxFrames: 4!
    const copyRes = await runCmd(boundedFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/copied.mp4"], vfs);
    assert.equal(copyRes.exitCode, 0);
    assert.equal(capturedStats?.decodedFrames, 0);

    // Pixel filter (`-vf negate`) decodes frames and hits maxFrames: 4 limit
    const filterRes = await runCmd(boundedFfmpeg, ["-i", "/clip.mp4", "-vf", "negate", "/neg.mp4"], vfs);
    assert.equal(filterRes.exitCode, 1);
    assert.ok((filterRes.stderr).includes("maxFrames"));

    // Opt-out of videoTranscode (`features: { videoTranscode: false }`)
    const remuxOnlyFfmpeg = createFfmpegCommand({
      features: { videoTranscode: false }
    });
    const optOutRes = await runCmd(remuxOnlyFfmpeg, ["-i", "/clip.mp4", "-vf", "scale=32:32", "/scaled.mp4"], vfs);
    assert.equal(optOutRes.exitCode, 1);
    assert.ok((optOutRes.stderr).includes("disabled by consumer feature configuration"));
  });

  it("supports vstack and stream-selective concat=n=2:v=1:a=0 in -filter_complex and .ffmpeg/.ffprobe properties", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const clip1 = createSyntheticMp4({ width: 32, height: 16, fps: 5, frameCount: 2, includeAudio: true });
    const clip2 = createSyntheticMp4({ width: 32, height: 16, fps: 5, frameCount: 2, includeAudio: true });
    const vfs = createTestVfs({ "/c1.mp4": clip1, "/c2.mp4": clip2 });

    const concatRes = await runCmd(
      ffmpeg,
      ["-i", "/c1.mp4", "-i", "/c2.mp4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "/video_only.mp4"],
      vfs
    );
    assert.equal(concatRes.exitCode, 0);
    const probeRes = await runCmd(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "/video_only.mp4"],
      vfs
    );
    const parsed = JSON.parse(probeRes.stdout);
    assert.equal(parsed.streams.length, 1);
    assert.equal(parsed.streams[0].codec_type, "video");
    assert.equal(parsed.streams[0].nb_frames, "4");

    const vstackRes = await runCmd(
      ffmpeg,
      ["-i", "/c1.mp4", "-i", "/c2.mp4", "-filter_complex", "[0:v][1:v]vstack=inputs=2", "/vstacked.mp4"],
      vfs
    );
    assert.equal(vstackRes.exitCode, 0);
    const vstackDoc = parseMp4(vfs.store.get("/vstacked.mp4")!);
    assert.equal(vstackDoc.tracks[0]!.width, 32);
    assert.equal(vstackDoc.tracks[0]!.height, 32);
  });

  it("converts .srt/.vtt subtitles, muxes mov_text/S_TEXT, burns drawtext/subtitles, builds tile contact sheets, and resamples WAV (-ar 16000 -ac 1)", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const video = createSyntheticMp4({ width: 32, height: 24, fps: 5, frameCount: 4, includeAudio: true });
    const srt = "1\n00:00:00,100 --> 00:00:00,700\nTEST SUB\n";
    const vfs = createTestVfs({ "/v.mp4": video, "/s.srt": srt });

    // 1. .srt -> .vtt
    const r1 = await runCmd(ffmpeg, ["-i", "/s.srt", "/s.vtt"], vfs);
    assert.equal(r1.exitCode, 0);
    assert.ok((new TextDecoder().decode(vfs.store.get("/s.vtt")!)).includes("WEBVTT"));

    // 2. Mux video + srt -> subbed.mp4 & extract back to .srt
    const r2 = await runCmd(ffmpeg, ["-i", "/v.mp4", "-i", "/s.srt", "-c", "copy", "/subbed.mp4"], vfs);
    assert.equal(r2.exitCode, 0);
    const r2b = await runCmd(ffmpeg, ["-i", "/subbed.mp4", "/out.srt"], vfs);
    assert.equal(r2b.exitCode, 0);
    assert.ok((new TextDecoder().decode(vfs.store.get("/out.srt")!)).includes("00:00:00,100 --> 00:00:00,700"));

    // 3. drawtext + subtitles + tile=2x2 contact sheet
    const r3 = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-vf", "drawtext=text='F%{n}':x=2:y=2:fontsize=8:box=1,subtitles=/s.srt,tile=2x2", "-frames:v", "1", "/sheet.png"],
      vfs
    );
    assert.equal(r3.exitCode, 0);
    const sheetProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "/sheet.png"], vfs)).stdout);
    assert.equal(sheetProbe.streams[0].width, 64);
    assert.equal(sheetProbe.streams[0].height, 48);

    // 4. Resample actual PCM audio rather than an undecoded AAC track.
    assert.equal((await runCmd(ffmpeg, ["-f", "lavfi", "-i", "sine=frequency=220:duration=1", "/source.wav"], vfs)).exitCode, 0);
    const r4 = await runCmd(ffmpeg, ["-i", "/source.wav", "-ar", "16000", "-ac", "1", "/audio.wav"], vfs);
    assert.equal(r4.exitCode, 0);
    const wavProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "/audio.wav"], vfs)).stdout);
    assert.equal(wavProbe.streams[0].sample_rate, "16000");
    assert.equal(wavProbe.streams[0].channels, 1);
    assert.ok(parseWav(vfs.store.get("/audio.wav")!).tracks[0]!.decodedAudio!.channelData[0]!.some(sample => Math.abs(sample) > .1));
  });

  it("segments MP4 into HLS (.m3u8 + .ts) and rejoins back to MP4, probes chapters, and applies xfade/setpts/reverse", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const video = createSyntheticMp4({ width: 32, height: 24, fps: 10, durationSeconds: 2, includeAudio: true });
    const ffmeta = ";FFMETADATA1\ntitle=Demo\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Outro\n";
    const vfs = createTestVfs({ "/v.mp4": video, "/m.ffmeta": ffmeta });

    // 1. HLS segmenting & re-joining
    const hlsRes = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_filename", "/seg_%03d.ts", "/index.m3u8"],
      vfs
    );
    assert.equal(hlsRes.exitCode, 0);
    assert.equal(vfs.store.has("/seg_000.ts"), true);
    // There is no second IDR inside this two-second GOP.
    assert.equal(vfs.store.has("/seg_001.ts"), false);
    assert.match(new TextDecoder().decode(vfs.store.get("/index.m3u8")!), /#EXTINF:2\.000000,/);

    const rejoinRes = await runCmd(ffmpeg, ["-i", "/index.m3u8", "-c", "copy", "/rejoined.mp4"], vfs);
    assert.equal(rejoinRes.exitCode, 0);
    const rejoinDoc = parseMp4(vfs.store.get("/rejoined.mp4")!);
    assert.equal(rejoinDoc.tracks.find((t) => t.type === "video")!.samples.length, 20);

    // 2. Chapters muxing & ffprobe -show_chapters
    const chMux = await runCmd(ffmpeg, ["-i", "/v.mp4", "-i", "/m.ffmeta", "-c", "copy", "/ch.mp4"], vfs);
    assert.equal(chMux.exitCode, 0);
    const chProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_chapters", "/ch.mp4"], vfs)).stdout);
    assert.equal(chProbe.chapters.length, 2);
    assert.equal(chProbe.chapters[0].tags.title, "Intro");
    assert.equal(chProbe.chapters[1].tags.title, "Outro");

    // 3. xfade + setpts + reverse
    const xfRes = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-i", "/v.mp4", "-filter_complex", "[0:v][1:v]xfade=transition=fade:duration=0.4:offset=1.6", "-vf", "setpts=0.5*PTS,reverse", "/xf.mp4"],
      vfs
    );
    assert.equal(xfRes.exitCode, 0);
    const xfDoc = parseMp4(vfs.store.get("/xf.mp4")!);
    assert.equal(xfDoc.tracks.find((t) => t.type === "video")!.samples.length, 36);
  });
});

it("negative maps match input, subtitle, absolute and typed stream indices in order", async () => {
  const bytes = createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true });
  for (const [maps, expected] of [
    [["0", "1", "-1:a"], ["video", "audio", "video"]],
    [["0", "-0:1"], ["video"]],
    [["0", "-0:a:0"], ["video"]],
    [["0", "-0:a", "0:a"], ["video", "audio"]],
    [["0", "1", "-1"], ["video", "audio"]]
  ] as const) {
    const vfs = createTestVfs({ "/a.mp4": bytes, "/b.mp4": bytes });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/a.mp4", "-i", "/b.mp4", ...maps.flatMap(m => ["-map", m]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.type), expected);
  }
  const vfs = createTestVfs({ "/a.mp4": bytes, "/s.srt": "1\n00:00:00,000 --> 00:00:01,000\nHello\n" });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/s.srt", "-i", "/a.mp4", "-map", "0", "-map", "1", "-map", "-0:s", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.type), ["video", "audio"]);
});

it("HLS copies each video sample once and cuts at keyframes", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 20, includeAudio: true }));
  const bytes = serializeMp4({ ...doc, tracks: doc.tracks.map(t => t.type === "video" ? {
    ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: i === 0 || i === 16 }))
  } : t) });
  const vfs = createTestVfs({ "/a.mp4": bytes });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/a.mp4", "-c", "copy", "-hls_time", "0.5", "/out.m3u8"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const playlist = new TextDecoder().decode(vfs.store.get("/out.m3u8"));
  assert.ok(playlist.includes("#EXT-X-TARGETDURATION:2"), playlist);
  assert.ok(playlist.includes("#EXTINF:1.600000,"), playlist);
  assert.ok(playlist.includes("#EXTINF:0.400000,"), playlist);
  const segments = [...vfs.store.entries()].filter(([path]) => path.endsWith(".ts"));
  assert.equal(segments.length, 2);
  assert.equal(segments.reduce((sum, [, bytes]) => sum + parseMpegTs(bytes).tracks.find(t => t.type === "video")!.samples.length, 0), 20);
});

it("scales default subtitle lettering and bottom spacing with video height", async () => {
  for (const height of [360, 720]) {
    const width = height * 16 / 9;
    const source = parseMp4(createSyntheticMp4({ width, height, frameCount: 1, fps: 1, includeAudio: false }));
    const data = new Uint8Array(width * height * 4);
    for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
    const input = serializeMp4({ ...source, tracks: [{ ...source.tracks[0]!, samples: [], decodedVideoFrames: [{ width, height, data, ptsSeconds: 0, durationSeconds: 1, keyframe: true }] }] });
    const vfs = createTestVfs({ "/input.mp4": input, "/captions.srt": "1\n00:00:00,000 --> 00:00:01,000\nHI\n" });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "subtitles=/captions.srt", "/output.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/output.mp4")!).tracks[0]!;
    const frame = [...decodeH264Samples(output.samples, output.codecDescriptions, width, height, output.timescale)][0]!;
    const visibleRows = [];
    for (let y = 0; y < height; y++) {
      if (frame.data.subarray(y * width * 4, (y + 1) * width * 4).some((value, offset) => offset % 4 === 0 && value > 180)) visibleRows.push(y);
    }
    assert.ok(visibleRows.length >= height * .035, `${visibleRows.length}-pixel letters at ${height}p are too small`);
    assert.ok(visibleRows.length <= height * .08, "Subtitle lettering should not dominate the frame");
    assert.ok(visibleRows[0]! >= height * .75, "Subtitles should remain near the bottom");
    assert.ok(visibleRows.at(-1)! < height * .98, "Subtitles need bottom spacing");
  }
});

it("burns captions at presentation times through media offsets and leading empty edits", async () => {
  for (const delay of [0, .2]) {
    const source = parseMp4(createSyntheticMp4({ width: 64, height: 32, frameCount: 10, fps: 10, includeAudio: false }));
    const track = source.tracks[0]!;
    const decodedVideoFrames = Array.from({ length: 10 }, (_, index) => {
      const data = new Uint8Array(64 * 32 * 4);
      for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
      return { width: 64, height: 32, data, ptsSeconds: .2 + index / 10, durationSeconds: .1, keyframe: true };
    });
    const edits = [
      ...(delay ? [{ segmentDuration: Math.round(delay * source.timescale), mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 }] : []),
      { segmentDuration: source.duration, mediaTime: Math.round(.2 * track.timescale), mediaRateInteger: 1, mediaRateFraction: 0 }
    ];
    const input = serializeMp4({ ...source, tracks: [{ ...track, samples: [], decodedVideoFrames, editList: edits }] });
    const vfs = createTestVfs({ "/input.mp4": input, "/captions.srt": "1\n00:00:00,300 --> 00:00:00,600\nHI\n" });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "subtitles=/captions.srt", "/output.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/output.mp4")!).tracks[0]!;
    const frames = [...decodeH264Samples(output.samples, output.codecDescriptions, 64, 32, output.timescale)];
    assert.equal(frames.length, 10);
    const visible = frames.flatMap((frame, index) => frame.data.some((value, offset) => offset % 4 === 0 && value > 180) ? [index] : []);
    assert.deepEqual(visible, delay ? [1, 2, 3] : [3, 4, 5]);
  }
});

describe("decoded audio editing", () => {
  for (const filter of ["volume=1", "areverse"]) {
    it(`preserves every PCM sample at unchanged rate with ${filter}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 800 }, (_, i) => 0.125 * Math.sin(2 * Math.PI * 1000 * i / 8000))] });
      const expected = parseWav(input).tracks[0]!.decodedAudio!;
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(actual.sampleRate, 8000);
      assert.equal(actual.channels, 1);
      assert.equal(actual.channelData[0]!.length, 800);
      assert.deepEqual(actual.channelData[0], filter === "areverse" ? expected.channelData[0]!.slice().reverse() : expected.channelData[0]);
    });
  }

  it("matches constant volume gains when evaluating arithmetic on a sine wave", async () => {
    const input = encodeWav({ sampleRate: 16000, channels: [Float64Array.from({ length: 8000 }, (_, i) => 0.125 * Math.sin(2 * Math.PI * 440 * i / 16000))] });
    const vfs = createTestVfs({ "/input.wav": input });
    for (const [expression, gain] of [["0.5+0.25", "0.75"], ["0.5+0.25*2", "1"], ["(0.5+0.25)/2", "0.375"], ["1-0.25-0.25", "0.5"], ["-0.5+1", "0.5"]]) {
      for (const [value, path] of [[expression, "/expression.wav"], [gain, "/constant.wav"]]) {
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", `volume=${value}`, "-c:a", "pcm_s16le", path!], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const actual = parseWav(vfs.store.get("/expression.wav")!).tracks[0]!.decodedAudio!;
      const expected = parseWav(vfs.store.get("/constant.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(actual.sampleRate, 16000);
      assert.equal(actual.channelData[0]!.length, 8000);
      assert.deepEqual(actual.channelData, expected.channelData, expression);
    }
  });

  for (const expression of ["banana", "1junk", "", "dB", "bananadB", "6junkdB", "NaN", "Infinity", "1/0", "(1+2", "sin(0)"]) {
    for (const existing of [false, true]) {
      it(`rejects volume=${expression} with existing output=${existing}`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(0.125)] });
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/input.wav": input, ...(existing ? { "/output.wav": original } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("volume"), result.stderr);
        assert.deepEqual(vfs.store.get("/output.wav"), existing ? original : undefined);
      });
    }
  }

  for (const [expression, gain] of [["0", 0], ["0.5", 0.5], ["2", 2], ["1e-1", 0.1], ["(1+2)/2", 1.5], ["6dB", 10 ** (6 / 20)], ["-6dB", 10 ** (-6 / 20)]] as const) {
    it(`applies volume=${expression} to decoded samples`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(0.125)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, 80);
      assert.ok(samples.every(sample => Math.abs(sample - 0.125 * gain) < 0.0001));
    });
  }

  for (const tempo of [0.5, 8, 100]) {
    it(`honors atempo=${tempo} without clamping`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(16000).fill(0.25)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `atempo=${tempo}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channelData[0]!.length, Math.round(16000 / tempo));
    });
  }

  for (const tempo of ["0.25", "0", "-1", "100.1", "Infinity", "NaN", "", "8junk", "0.25,atempo=4"]) {
    it(`rejects invalid atempo=${tempo} without writing output`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `atempo=${tempo}`, "/output.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("atempo"), result.stderr);
      assert.ok(result.stderr.includes("[0.5, 100]"), result.stderr);
      assert.equal(vfs.store.has("/output.wav"), false);
    });
  }

  for (const [filter, tempo, rate] of [["atempo=2", 2, 16000], ["atempo=0.5", 0.5, 16000], ["atempo=2,atempo=2", 4, 8000]] as const) {
    it(`preserves pitch and stereo alignment with ${filter} at ${rate} Hz`, async () => {
      const tone = Float64Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000));
      const input = encodeWav({ sampleRate: 16000, channels: [tone, tone.map(value => -value)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-ar", String(rate), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      const left = audio.channelData[0]!;
      const right = audio.channelData[1]!;
      assert.equal(left.length, Math.round(rate / tempo));
      const start = Math.floor(left.length * 0.2);
      const end = Math.floor(left.length * 0.8);
      let crossings = 0;
      let energy = 0;
      for (let i = start; i < end; i++) {
        if (left[i - 1]! <= 0 && left[i]! > 0) crossings++;
        energy += left[i]! ** 2;
        assert.ok(Math.abs(left[i]! + right[i]!) < 0.0001, "Stereo channels must remain aligned");
      }
      const pitch = crossings * rate / (end - start);
      assert.ok(Math.abs(pitch - 440) < 10, `Expected 440 Hz, got ${pitch} Hz`);
      assert.ok(energy / (end - start) > 0.08, "Stretching must retain the tone's amplitude");
    });
  }

  it("preserves mono pitch when doubling tempo", async () => {
    const tone = Float64Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 16000, channels: [tone] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=2", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(output.channels, 1);
    const samples = output.channelData[0]!;
    assert.equal(samples.length, 8000);
    let crossings = 0;
    for (let i = 1600; i < 6400; i++) if (samples[i - 1]! <= 0 && samples[i]! > 0) crossings++;
    assert.ok(Math.abs(crossings / 0.3 - 440) < 10);
  });

  it("keeps silence and very short constant audio finite when slowing down", async () => {
    for (const [length, amplitude] of [[1, 0.5], [160, 0.5], [16000, 0]] as const) {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(length).fill(amplitude)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=0.5", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, length * 2);
      assert.ok(samples.every(sample => Math.abs(sample - amplitude) < 0.0001));
    }
  });

  it("defers audio filters to the async command without writing output", () => {
    const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
    for (const filter of ["no_such_filter", "volume=0.5"]) {
      let writes = 0;
      const result = evalSyncFfmpeg(["-y", "-i", "/input.wav", "-af", filter, "/output.wav"], undefined,
        () => input, () => { writes++; return true; });
      assert.equal(writes, 0);
      assert.equal(result, undefined);
    }
  });

  for (const filter of ["no_such_filter", "highpass=f=200", "volume=0.5,no_such_filter,areverse"]) {
    for (const existing of [false, true]) {
      it(`rejects unsupported audio filter ${filter} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/input.wav": input, ...(existing ? { "/output.wav": original } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
        assert.equal(result.exitCode, 1, result.stderr);
        assert.ok(result.stderr.includes("Unsupported audio filter:"), result.stderr);
        assert.ok(result.stderr.includes(filter.includes("no_such_filter") ? "no_such_filter" : "highpass"), result.stderr);
        assert.deepEqual(vfs.store.get("/output.wav"), existing ? original : undefined);
        assert.deepEqual(vfs.store.get("/input.wav"), input);
      });
    }
  }

  for (const [options, sampleRate, channels, samples] of [
    [["-ar", "8000"], 8000, 1, 80],
    [["-ac", "2"], 16000, 2, 160],
    [["-af", "volume=0.5"], 16000, 1, 160],
    [["-af", "atempo=2"], 16000, 1, 80]
  ] as const) {
    it(`preserves short PCM duration when converting with ${options.join(" ")}`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", ...options, "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.sampleRate, sampleRate);
      assert.equal(output.channels, channels);
      for (const channel of output.channelData) assert.equal(channel.length, samples);
    });
  }

  for (const [left, right, expected] of [[0.5, -0.5, 0], [0, 0.5, 0.25], [0.5, 0.5, 0.5]] as const) {
    it(`mixes stereo ${left}, ${right} to mono ${expected}`, async () => {
      const input = encodeWav({
        sampleRate: 8000,
        channels: [new Float64Array(800).fill(left), new Float64Array(800).fill(right)]
      });
      const vfs = createTestVfs({ "/stereo.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/stereo.wav", "-ac", "1", "/mono.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/mono.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.sampleRate, 8000);
      assert.equal(output.channels, 1);
      assert.equal(output.channelData[0]!.length, 800);
      assert.ok(output.channelData[0]!.every(sample => sample === expected));
    });
  }

  for (const channels of [1, 2]) {
    for (const reversals of [1, 2, 3, 4]) {
      it(`applies ${reversals} areverse filters to ${channels} PCM channels`, async () => {
        const input = encodeWav({
          sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) =>
            Float64Array.from({ length: 80 }, (_, i) => (channel === 0 ? i : -i) / 256))
        });
        const source = parseWav(input).tracks[0]!.decodedAudio!;
        const vfs = createTestVfs({ "/input.wav": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.wav", "-af", Array(reversals).fill("areverse").join(","),
          "-c:a", "pcm_s16le", "/output.wav"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(output.sampleRate, source.sampleRate);
        assert.equal(output.channels, channels);
        for (const [channel, samples] of output.channelData.entries()) {
          const expected = source.channelData[channel]!.slice();
          if (reversals % 2 === 1) expected.reverse();
          assert.deepEqual(samples, expected);
        }
      });
    }
  }

  it("mutes audible PCM samples with volume=0 without changing their count", async () => {
    const vfs = createTestVfs();
    const command = createFfmpegCommand();
    const generated = await runCmd(command, ["-f", "lavfi", "-i", "sine=frequency=440:duration=0.1:sample_rate=8000", "/input.wav"], vfs);
    assert.equal(generated.exitCode, 0, generated.stderr);
    const input = parseWav(vfs.store.get("/input.wav")!).tracks[0]!.decodedAudio!;
    assert.ok(input.channelData[0]!.some(value => value !== 0));

    const result = await runCmd(command, ["-v", "error", "-i", "/input.wav", "-af", "volume=0", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(output.sampleRate, input.sampleRate);
    assert.equal(output.channels, input.channels);
    for (const [channel, samples] of output.channelData.entries()) {
      assert.equal(samples.length, input.channelData[channel]!.length);
      assert.ok(samples.every(value => value === 0));
    }
  });

  it("rejects corrupt audio instead of replacing it with silence or a tone", async () => {
    for (const options of [[], ["-ar", "16000"], ["-af", "volume=0.5"]]) {
      const original = new Uint8Array([1, 2, 3]);
      const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2, includeAudio: true }));
      const broken = { ...source, tracks: source.tracks.map(track => track.type !== "audio" ? track : {
        ...track, samples: track.samples.map(sample => ({ ...sample, data: Uint8Array.of(255) }))
      }) };
      const vfs = createTestVfs({ "/input.mp4": serializeMp4(broken), "/output.wav": original });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.mp4", "-vn", ...options, "/output.wav"], vfs);
      assert.equal(result.exitCode, 1, JSON.stringify(options));
      assert.match(result.stderr, /requires decoded PCM audio|AAC/);
      assert.deepEqual(vfs.store.get("/output.wav"), original);
    }
  });

  it("trims and repeats WAV waveforms through ffmpeg options", async () => {
    const vfs = createTestVfs();
    const command = createFfmpegCommand();
    const generated = await runCmd(command, ["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-y", "/four.wav"], vfs);
    assert.equal(generated.exitCode, 0, generated.stderr);
    for (const [args, duration] of [
      [["-i", "/four.wav", "-ss", "1", "-t", "1"], 1],
      [["-ss", "1", "-i", "/four.wav", "-to", "2"], 2],
      [["-stream_loop", "2", "-i", "/four.wav"], 12],
      [["-i", "concat:/four.wav|/four.wav"], 8],
      [["-i", "/four.wav", "-af", "volume=0.5", "-t", "1"], 1],
      [["-i", "/four.wav", "-af", "atempo=2.0,areverse"], 2]
    ] as const) {
      const result = await runCmd(command, [...args, "-y", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!);
      assert.equal(output.durationSeconds, duration, args.join(" "));
      assert.ok(output.tracks[0]!.decodedAudio!.channelData[0]!.some((value) => value !== 0));
    }
  });
});


describe("native ffmpeg parity", () => {
  for (const position of ["x=n*4:y=0", "0:n*4"]) {
    it(`evaluates crop position ${position} per frame`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=black:s=16x16:r=3:d=1",
        "-vf", `drawbox=x=0:y=0:w=4:h=4:c=red:t=fill,crop=8:8:${position}`,
        "-frames:v", "3", "/frame-%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/frame-${frame}.png`)!);
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual([...output.data.slice(0, 4)], frame === 1 ? [255, 0, 0, 255] : [0, 0, 0, 255]);
      }
    });
  }

  for (const position of ["x=iw-ow:y=ih-oh", "in_w-out_w:in_h-out_h", "(iw-ow)/2+1:(ih-oh)*1", "2:2"]) {
    it(`evaluates crop position ${position}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(4 * 4 * 4);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) data.set(x >= 2 && y >= 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], (y * 4 + x) * 4);
      }
      const input = encodeImage({
        width: 4, height: 4, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `crop=2:2:${position}`, "-frames:v", "1", "/crop.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/crop.png")!);
      assert.equal(output.width, 2);
      assert.equal(output.height, 2);
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: 4 }, () => [0, 0, 255, 255]).flat()));
    });
  }

  for (const position of ["x=unknown:y=0", "x=0:y=2garbage", "x=iw/:y=0", "x=1/0:y=0", "x=sin(1):y=0"]) {
    for (const existing of [false, true]) {
      it(`rejects crop position ${position} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const vfs = createTestVfs(existing ? { "/crop.png": "original" } : {});
        const original = vfs.store.get("/crop.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=red:s=4x4:r=1:d=1",
          "-vf", `crop=2:2:${position}`, "-frames:v", "1", "/crop.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("crop:"), result.stderr);
        assert.deepEqual(vfs.store.get("/crop.png"), original);
      });
    }
  }

  for (const crop of ["100:100", "100:8", "8:100", "-1:8", "8:-1", "w=iw*2:h=ih"]) {
    for (const existing of [false, true]) {
      it(`rejects invalid crop ${crop} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs(existing ? { "/crop.png": original } : {});
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
          "-vf", `crop=${crop}`, "-frames:v", "1", "/crop.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Invalid too big or non positive size"), result.stderr);
        assert.equal(result.stdoutBytes.length, 0);
        assert.deepEqual(vfs.store.get("/crop.png"), existing ? original : undefined);
      });
    }
  }

  for (const [crop, width, height] of [["16:16", 16, 16], ["8:4", 8, 4], ["w=iw/2:h=ih/2", 8, 8]] as const) {
    it(`preserves valid crop dimensions for ${crop}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
        "-vf", `crop=${crop}`, "-frames:v", "1", "/crop.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = decodeImage(vfs.store.get("/crop.png")!);
      assert.equal(actual.width, width);
      assert.equal(actual.height, height);
    });
  }

  for (const [inputWidth, inputHeight, dimension, expected] of [
    [4, 3, "-2", 2],
    [5, 3, "-2", 4],
    [3, 2, "-2", 4],
    [4, 3, "-1", 3]
  ] as const) {
    for (const transpose of [false, true]) {
      const width = transpose ? inputHeight : inputWidth;
      const height = transpose ? inputWidth : inputHeight;
      const scale = transpose ? `2:${dimension}` : `${dimension}:2`;
      it(`rounds aspect scale ${scale} for ${width}x${height} to the nearest multiple`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width, height, channels: 4,
          data: new Uint8Array(width * height * 4).fill(255),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, transpose ? 2 : expected);
        assert.equal(output.height, transpose ? expected : 2);
      });
    }
  }

  for (const [scale, width, height] of [
    ["1:1", 1, 1],
    ["1:3", 1, 3],
    ["3:1", 3, 1],
    ["iw/16:ih/10", 1, 1],
    ["iw*0.0625:ih*0.1", 1, 1],
    ["-1:1", 2, 1],
    ["1:-1", 1, 1],
    ["-2:1", 2, 1],
    ["1:-2", 1, 2]
  ] as const) {
    it(`preserves small scale dimensions for ${scale}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      // Native FFmpeg: -f lavfi -i color=c=red:s=16x10:r=1:d=1
      // -vf scale=1:1 -frames:v 1 -f image2pipe -c:v png pipe:1
      const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC", "base64"));
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x10:r=1:d=1",
        "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(actual.width, width);
      assert.equal(actual.height, height);
      if (scale === "1:1") {
        assert.equal(actual.width, native.width);
        assert.equal(actual.height, native.height);
      }
      for (let offset = 0; offset < actual.data.length; offset++) {
        // Allow native lavfi's YUV-to-RGB conversion rounding.
        assert.ok(Math.abs(actual.data[offset]! - native.data[offset % 4]!) <= 2);
      }
    });
  }

  for (const color of ["notacolor", "#xyzxyz", "0x12345", "1234567", "notacolor@0.5"]) {
    it(`rejects invalid lavfi color ${color} without writing output`, async () => {
      for (const initialFiles of [{}, { "/out.png": "existing image" }]) {
        const vfs = createTestVfs(initialFiles);
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", `color=c=${color}:s=16x16:r=1:d=1`,
          "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`Invalid color: ${color}`), result.stderr);
        assert.equal(vfs.store.get("/out.png"), original);
      }
    });
  }

  for (const [color, expected] of [
    ["red@0.5", [127, 0, 127, 255]],
    ["red@0x80", [128, 0, 126, 255]],
    ["red", [255, 0, 0, 255]],
    ["red@0", [0, 0, 255, 255]]
  ] as const) {
    it(`matches native drawbox ${color} on a one-pixel RGB PNG`, async () => {
      const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 1, height: 1, channels: 3, data: new Uint8Array([0, 0, 255]),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `drawbox=x=0:y=0:w=1:h=1:color=${color}:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...decodeImage(vfs.store.get("/out.png")!).data], [...expected]);
    });
  }

  for (const replace of ["1", "0", undefined]) {
    for (const alpha of [0, 127, 255]) {
      it(`drawbox replace=${replace} on destination alpha ${alpha}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 4, height: 4, channels: 4,
          data: new Uint8Array(Array.from({ length: 16 }, () => [0, 0, 255, alpha]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf",
          `drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill${replace === undefined ? "" : `:replace=${replace}`}`,
          "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const image = decodeImage(vfs.store.get("/out.png")!);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
            const expected = inside
              ? replace === "1" ? [255, 0, 0, 127] : [127, 0, 127, alpha]
              : [0, 0, 255, alpha];
            const offset = (y * 4 + x) * 4;
            assert.deepEqual([...image.data.subarray(offset, offset + 4)], expected);
          }
        }
      });
    }
  }

  it("preserves destination alpha when blending drawbox", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=blue@0.5:s=4x4:r=1:d=1",
      "-vf", "drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill",
      "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const image = decodeImage(vfs.store.get("/out.png")!);
    assert.deepEqual(Array.from(image.data.slice(20, 24)), [127, 0, 127, 127]);
  });

  for (const alpha of ["", "-0.1", "1.1", "0x100", "nope"]) {
    it(`rejects invalid drawbox alpha ${JSON.stringify(alpha)}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=black:s=4x4:r=1:d=1",
        "-vf", `drawbox=color=red@${alpha}:t=fill`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("Invalid color alpha"), result.stderr);
      assert.equal(vfs.store.has("/out.png"), false);
    });
  }

  it("blends drawbox alpha colors over the short lavfi clip like native FFmpeg", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    // FFmpeg: -f lavfi -i color=c=black:s=4x4:r=1:d=1
    // -vf drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill -frames:v 1 out.png
    const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAGUlEQVR4nGMMY0AAFiBWBbNuQzgoMrdhHAA4UwI/yaxwoAAAAABJRU5ErkJggg==", "base64"));
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=4x4:r=1:d=1",
      "-vf", "drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill",
      "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, native.width);
    assert.equal(actual.height, native.height);
    for (let channel = 0; channel < 4; channel++) {
      // Native lavfi uses YUV; allow its conversion rounding at pixel (1, 1).
      assert.ok(Math.abs(actual.data[20 + channel]! - native.data[20 + channel]!) <= 6,
        `channel ${channel}: ${actual.data[20 + channel]} vs ${native.data[20 + channel]}`);
    }
  });

  for (const [color, expected] of [
    ["red@0", [0, 0, 255, 255]],
    ["red@1", [255, 0, 0, 255]],
    ["red", [255, 0, 0, 255]],
    ["red@0.5", [127, 0, 127, 255]],
    ["#ff0000@0.5", [127, 0, 127, 255]],
    ["0xff0000@0x80", [128, 0, 126, 255]],
    ["0xff000080", [128, 0, 126, 255]],
    ["ff000080@0", [0, 0, 255, 255]]
  ] as const) {
    it(`drawbox blends ${color} over blue and leaves pixels outside the box unchanged`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=blue:s=4x4:r=1:d=1",
        "-vf", `drawbox=x=1:y=1:w=2:h=2:color=${color}:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const offset = (y * 4 + x) * 4;
          assert.deepEqual(Array.from(image.data.slice(offset, offset + 4)),
            x >= 1 && x < 3 && y >= 1 && y < 3 ? [...expected] : [0, 0, 255, 255]);
        }
      }
    });
  }

  for (const [format, expected] of [
    ["csv=p=0", "HelloWorld\n"],
    ["compact=p=0", "tag:title=HelloWorld\n"],
    ["flat", 'format.tags.title="HelloWorld"\n']
  ]) {
    it(`retains format tags in ${format}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.2",
        "-metadata", "title=HelloWorld", "/tagged.mp4"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const probe = await runCmd(createFfprobeCommand(), [
        "-show_entries", "format_tags=title", "-of", format!, "/tagged.mp4"
      ], vfs);
      assert.equal(probe.exitCode, 0, probe.stderr);
      assert.equal(probe.stdout, expected);
    });
  }
  for (const flags of [[], ["-nostdin"], ["-n"]]) {
    it(`preserves existing output with ${flags.join(" ") || "no overwrite flag"}`, async () => {
      const original = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/out.mp4": original });
      const result = await runCmd(createFfmpegCommand(), [
        ...flags, "-f", "lavfi", "-i", "color=c=red:s=16x16:d=0.1", "/out.mp4"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /already exists/);
      assert.deepEqual(vfs.store.get("/out.mp4"), original);
    });
  }
  it("replaces existing output with -y", async () => {
    const vfs = createTestVfs({ "/out.mp4": new Uint8Array([1, 2, 3]) });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=16x16:d=0.1", "/out.mp4"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(vfs.store.get("/out.mp4")!.length > 3);
  });
});

for (const [format, expected] of [
  ["csv=p=0", "eng\n"],
  ["compact=p=0", "tag:language=eng\n"],
  ["flat", 'streams.stream.0.tags.language="eng"\n']
]) {
  it(`retains selected stream tags in ${format}`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: false }));
    const bytes = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, language: "eng" })) });
    const result = await runCmd(createFfprobeCommand(), [
      "-show_entries", "stream_tags=language", "-of", format!, "/tagged.mp4"
    ], createTestVfs({ "/tagged.mp4": bytes }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}


it("preserves solid lavfi pixels across multiple H.264 frames", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand(), [
    "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1", "-c:v", "libx264", "/red.mp4"
  ], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const doc = parseMp4(vfs.store.get("/red.mp4")!, { decodeFrames: true });
  const frames = doc.tracks[0]!.decodedVideoFrames!;
  assert.equal(frames.length, 10);
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      assert.ok(frame.data[i]! >= 250, `red at ${i / 4}: ${frame.data.slice(i, i + 4)}`);
      assert.ok(frame.data[i + 1]! <= 3);
      assert.ok(frame.data[i + 2]! <= 3);
      assert.equal(frame.data[i + 3], 255);
    }
  }
});

it("extracts gapped MKV subtitles with their explicit end timestamps", async () => {
  const srt = "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,500\nSecond\n";
  const vfs = createTestVfs({ "/in.srt": srt });
  const ffmpeg = createFfmpegCommand();
  assert.equal((await runCmd(ffmpeg, ["-i", "/in.srt", "-c", "copy", "/sub.mkv"], vfs)).exitCode, 0);
  const result = await runCmd(ffmpeg, ["-i", "/sub.mkv", "/out.srt"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const text = new TextDecoder().decode(vfs.store.get("/out.srt"));
  assert.ok(text.includes("00:00:00,000 --> 00:00:01,000"), text);
  assert.ok(text.includes("00:00:03,000 --> 00:00:04,500"), text);
});

for (const format of ["hls", "dash"]) {
  it(`probes and remuxes actual ${format} segments without inventing streams`, async () => {
    const source = createSyntheticMp4({ width: 128, height: 96, fps: 25, frameCount: 50, includeAudio: false });
    const vfs = createTestVfs({ "/in.mp4": source });
    const filename = format === "hls" ? "/stream/out.m3u8" : "/stream/out.mpd";
    const ffmpeg = createFfmpegCommand();
    const mux = await runCmd(ffmpeg, ["-i", "/in.mp4", "-c", "copy", "-f", format, filename], vfs);
    assert.equal(mux.exitCode, 0, mux.stderr);
    if (format === "dash") {
      assert.ok(vfs.store.has("/stream/init-stream0.m4s"));
      assert.ok(vfs.store.has("/stream/chunk-stream0-00001.m4s"));
    }
    const probe = await runCmd(createFfprobeCommand(), ["-of", "json", "-show_streams", "-show_format", filename], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.equal(result.streams.length, 1);
    assert.equal(result.streams[0].width, 128);
    assert.equal(result.streams[0].height, 96);
    assert.equal(result.streams[0].r_frame_rate, "25/1");
    assert.equal(Number(result.format.duration), 2);
    const remux = await runCmd(ffmpeg, ["-i", filename, "-c", "copy", "/joined.mp4"], vfs);
    assert.equal(remux.exitCode, 0, remux.stderr);
    const actual = parseMp4(vfs.store.get("/joined.mp4")!);
    const original = parseMp4(source);
    assert.equal(actual.tracks[0]!.samples.length, 50);
    assert.deepEqual(actual.tracks[0]!.samples.map(s => s.data), original.tracks[0]!.samples.map(s => s.data));
  });
}

it("reads multiple HLS fMP4 segments through both commands and preserves their packets", async () => {
  const segment = createSyntheticMp4({ width: 32, height: 24, fps: 25, frameCount: 25, includeAudio: true, fragmented: true });
  const playlist = "#EXTM3U\n#EXTINF:1,\nparts/one.m4s\n#EXTINF:1,\nparts/two.m4s\n#EXT-X-ENDLIST\n";
  const vfs = createTestVfs({ "/hls/media.playlist": playlist, "/hls/parts/one.m4s": segment, "/hls/parts/two.m4s": segment });
  const probe = await runCmd(createFfprobeCommand(), ["-of", "json", "/hls/media.playlist"], vfs);
  assert.equal(probe.exitCode, 0, probe.stderr);
  const streams = JSON.parse(probe.stdout).streams;
  assert.equal(streams.length, 2);
  assert.equal(streams[0].r_frame_rate, "25/1");
  const result = await runCmd(createFfmpegCommand(), ["-i", "/hls/media.playlist", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const track = parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!;
  const original = parseMp4(segment).tracks[0]!;
  assert.equal(track.samples.length, 50);
  assert.ok(track.samples.every((s, i) => Buffer.from(s.data).equals(original.samples[i % 25]!.data)));
});

for (const command of [createFfmpegCommand, createFfprobeCommand]) {
  it(`${command.name} fails on missing HLS segments instead of returning synthetic media`, async () => {
    const vfs = createTestVfs({ "/hls/index.m3u8": "#EXTM3U\n#EXTINF:1,\nmissing.ts\n" });
    const args = command === createFfmpegCommand ? ["-i", "/hls/index.m3u8", "/out.mp4"] : ["/hls/index.m3u8"];
    const result = await runCmd(command(), args, vfs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("/hls/missing.ts"), result.stderr);
    assert.equal(vfs.store.has("/out.mp4"), false);
  });
}

it("extracts real pixels from native CABAC H.264", async () => {
  const { decodeImage } = await import("@poe-code/image-ast/portable");
  const native = Buffer.from("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", "base64");
  const vfs = createTestVfs({ "/native.mp4": native });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/native.mp4", "-frames:v", "1", "/frame.png"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const image = decodeImage(vfs.store.get("/frame.png")!);
  assert.equal(image.width, 64);
  assert.equal(image.height, 48);
  assert.deepEqual(Array.from(image.data.slice(0, 4)), [254, 0, 0, 255]);
});

for (const [extension, flags, codec, sampleRate] of [
  ["ogg", [], "vorbis", 44100],
  ["ogg", ["-c:a", "libopus"], "opus", 48000],
  ["opus", [], "opus", 48000]
] as const) {
  it(`encodes ${extension} with ${flags.join(" ") || "default codec"}`, async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "sine=f=440:r=44100:d=0.1", ...flags, "/audio." + extension], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const probe = await runCmd(createFfprobeCommand(), ["-show_streams", "-of", "json", "/audio." + extension], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, codec);
    assert.equal(Number(stream.sample_rate), sampleRate);
    // Native ffprobe includes the Opus pre-skip in the reported Ogg duration.
    assert.equal(Number(stream.duration), codec === "opus" ? 0.1065 : 0.1);
  });
}


it("escapes tag separators, quotes and newlines like native ffprobe", async () => {
  const vfs = createTestVfs();
  const title = "Hello, \"World\"|line\nnext\\tab\tend";
  const encoded = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "color=s=16x16:r=1:d=1", "-metadata", "title=" + title, "/tagged.mp4"], vfs);
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const expected = {
  "csv=p=0": "\"Hello, \"\"World\"\"|line\nnext\\tab\tend\"\n",
  "compact=p=0": "tag:title=Hello, \"World\"\\|line\\nnext\\\\tab\tend\n",
  "flat": "format.tags.title=\"Hello, \\\"World\\\"|line\\nnext\\\\tab\tend\"\n"
};
  for (const [format, output] of Object.entries(expected)) {
    const result = await runCmd(createFfprobeCommand(), ["-show_entries", "format_tags=title", "-of", format, "/tagged.mp4"], vfs);
    assert.equal(result.stdout, output, format);
  }
});

for (const frequency of ["frequency=0", "f=0"]) {
  it(`generates silent lavfi sine audio for ${frequency}`, async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i",
      `sine=${frequency}:sample_rate=16000:duration=0.1`, "/silence.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/silence.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channelData.length, 1);
    const samples = audio.channelData[0]!;
    assert.equal(samples.length, 1600);
    assert.ok(samples.every(sample => sample === 0), "every decoded sample must be silent");
  });
}

it("matches native lavfi sine waveform amplitude", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand(), [
    "-v", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:sample_rate=16000:duration=0.1", "/tone.wav"
  ], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(vfs.store.get("/tone.wav")!).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channelData.length, 1);
  const samples = audio.channelData[0]!;
  assert.equal(samples.length, 1600);
  const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  // Native FFmpeg pcm_s16le output for this source; allow two PCM quantization steps.
  const tolerance = 2 / 32768;
  assert.ok(Math.abs(peak - 0.124969482421875) <= tolerance, `peak: ${peak}`);
  assert.ok(Math.abs(rms - 0.08836870456) <= tolerance, `rms: ${rms}`);
});

it("matches native short sine and anullsrc sample counts and channel defaults", async () => {
  for (const [source, channels] of [["sine", 1], ["anullsrc", 2]] as const) {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", `${source}=sample_rate=16000:duration=0.01`, "/tone.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const track = parseWav(vfs.store.get("/tone.wav")!).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.channels, channels);
    assert.equal(track.codecDescriptions[0]!.sampleRate, 16000);
    for (const channel of track.decodedAudio!.channelData) {
      assert.equal(channel.length, 160);
    }
  }
});

it("matches native ffprobe flat numeric and string field types", async () => {
  const vfs = createTestVfs({ "/clip.mp4": createSyntheticMp4({ width: 80, height: 60, frameCount: 1, includeAudio: false }) });
  const result = await runCmd(createFfprobeCommand(), ["-of", "flat", "-show_entries", "stream=codec_name,width,height", "/clip.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'streams.stream.0.codec_name="h264"\nstreams.stream.0.width=80\nstreams.stream.0.height=60\n');
});


describe("animated GIF and lavfi source regressions", () => {
  for (const args of [["-vf", "fps=10"], ["-r", "10"]]) {
    it(`resamples variable-duration GIF frames by presentation time with ${args.join(" ")}`, async () => {
      // Three 4x4 frames: red for 0.1s, green for 0.9s, blue for 0.1s.
      const input = Buffer.from("R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAFoAAAAsAAAAAAQABACAAIAAAAAAAgSEjwkFACH5BAAKAAAALAAAAAAEAAQAgAAA/wAAAAIEhI8JBQA7", "base64");
      const vfs = createTestVfs({ "/input.gif": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.gif", ...args, "/frame-%02d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const frames = [...vfs.store.entries()].filter(([path]) => path.endsWith(".png"));
      assert.equal(frames.length, 11);
      const pixels = frames.sort(([a], [b]) => a.localeCompare(b)).map(([, bytes]) => [...decodeImage(bytes).data.slice(0, 3)]);
      assert.deepEqual(pixels, [[255, 0, 0], ...Array.from({ length: 9 }, () => [0, 128, 0]), [0, 0, 255]]);
    });
  }

  for (const [option, filter] of [
    ["-vf", "not_a_video_filter"],
    ["-filter:v", "palettegen"],
    ["-vf", "paletteuse"],
    ["-filter_complex", "[0:v]scale=8:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"]
  ]) {
    it(`rejects unsupported video filter ${filter} without replacing an existing output`, async () => {
      const original = new Uint8Array([17, 29, 43]);
      const vfs = createTestVfs({
        "/input.mp4": createSyntheticMp4({ width: 16, height: 12, frameCount: 2, includeAudio: false }),
        "/output.gif": original
      });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.mp4", option!, filter!, "/output.gif"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /unsupported video filter/i);
      assert.deepEqual(vfs.store.get("/output.gif"), original);
    });
  }

  it("keeps the null video filter as an explicit no-op", async () => {
    const vfs = createTestVfs({ "/input.mp4": createSyntheticMp4({ width: 16, height: 12, frameCount: 2, includeAudio: false }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "null", "-frames:v", "1", "/output.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const before = parseMp4(vfs.store.get("/input.mp4")!).tracks[0]!;
    const expected = [...decodeH264Samples(before.samples, before.codecDescriptions, 16, 12, before.timescale)];
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const actual = decodeImage(vfs.store.get("/output.png")!);
    assert.deepEqual(actual.data, expected[0]!.data);
  });

  it("encodes every filtered frame and probes animation timing", async () => {
    const vfs = createTestVfs();
    const source = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "testsrc=size=16x12:rate=4:duration=1.5", "master.mp4"], vfs);
    assert.equal(source.exitCode, 0, source.stderr);
    const encode = await runCmd(createFfmpegCommand(), ["-i", "master.mp4", "-vf", "fps=8,scale=8:6", "-loop", "0", "preview.gif"], vfs);
    assert.equal(encode.exitCode, 0, encode.stderr);
    const probe = await runCmd(createFfprobeCommand(), ["-show_format", "-show_streams", "-show_frames", "-of", "json", "preview.gif"], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.equal(result.streams[0].nb_frames, "12");
    assert.equal(result.streams[0].width, 8);
    assert.equal(result.streams[0].height, 6);
    assert.equal(result.frames.length, 12);
    assert.ok(Math.abs(Number(result.format.duration) - 1.5) <= 0.01);
  });

  it("renders static SMPTE bars with distinct upper, middle and lower bands", async () => {
    const vfs = createTestVfs();
    for (const name of ["smptebars", "testsrc"]) {
      const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", `${name}=size=28x12:rate=2:duration=1`, `${name}_%d.ppm`], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.notDeepEqual(vfs.store.get("/smptebars_1.ppm"), vfs.store.get("/testsrc_1.ppm"));
    assert.deepEqual(vfs.store.get("/smptebars_1.ppm"), vfs.store.get("/smptebars_2.ppm"));
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const image = decodeImage(vfs.store.get("/smptebars_1.ppm")!);
    const pixel = (x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
    assert.deepEqual(pixel(0, 0), [191, 191, 191]);
    assert.deepEqual(pixel(0, 8), [0, 0, 191]);
    assert.deepEqual(pixel(7, 11), [255, 255, 255]);
  });
});

it("extracts external AAC to WAV and leaves existing output intact on corrupt AAC", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../mp4-ast/src/fixtures/aac-external.mp4", import.meta.url));
  const command = createFfmpegCommand();
  const vfs = createTestVfs({ "/demo.mp4": source });
  const result = await runCmd(command, ["-y", "-i", "demo.mp4", "-vn", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const wav = vfs.store.get("/audio.wav")!;
  const audio = parseWav(wav).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 24000);
  assert.equal(audio.channelData[0]!.length, 192000);
  const parsed = parseMp4(source);
  const broken = { ...parsed, tracks: parsed.tracks.map(track => track.type !== "audio" ? track : {
    ...track, samples: track.samples.map((sample, index) => index === 20 ? { ...sample, data: Uint8Array.of(255) } : sample)
  }) };
  vfs.store.set("/demo.mp4", serializeMp4(broken));
  const failure = await runCmd(command, ["-y", "-i", "demo.mp4", "-vn", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(failure.exitCode, 1);
  assert.match(failure.stderr, /AAC/);
  assert.deepEqual(vfs.store.get("/audio.wav"), wav);
  vfs.store.set("/control.wav", wav);
  const control = await runCmd(command, ["-y", "-i", "control.wav", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(parseWav(vfs.store.get("/audio.wav")!).durationSeconds, 8);
});

// ffmpeg -f lavfi -i testsrc2=size=64x48:rate=10:duration=1 -c:v libx264 -bf 3 -g 30 fixture.mp4
const seekH264 = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACCNtZGF0AAACrAYF//+o3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTMwIGtleWludF9taW49MyBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTMwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAA/9liIQBf9RXbEfXd6NKk0vP473I5OWavVQJvghQBgab84741ZLDhyrwf6orDB+FS1YJO+MkNgtoaIOfvzmFbng+jIOueTLixAi9p+POnD4QiJfSgwFTSVe9EkhkV2cVS6ZTt7Vr4wKZIRR1bdERzupZkxeI7tkxPAyEGbXF9T0/ZMzuxSlgSVYcwrtareCEA3Hz7r9S9zjzbkypCqOAWIRu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", "base64");

it("seeks H.264 B-frames in display order before limiting image output", async () => {
  const track = parseMp4(seekH264).tracks[0]!;
  assert.ok(track.samples.some(sample => sample.pts !== sample.dts));
  assert.ok(track.samples.some(sample => !sample.isKeyframe));
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const command = createFfmpegCommand({ asts: allMediaAsts() });
  assert.equal((await runCmd(command, ["-i", "in.mp4", "full_%03d.png"], vfs)).exitCode, 0);
  assert.equal([...vfs.store.keys()].filter(key => key.startsWith("/full_")).length, 10);
  const expected = vfs.store.get("/full_005.png")!;
  assert.notDeepEqual(expected, vfs.store.get("/full_001.png"));
  for (const seek of [["-ss", "0.4", "-i", "in.mp4"], ["-i", "in.mp4", "-ss", "0.4"]]) {
    for (const output of [["-frames:v", "1", "single.png"], ["sequence_%03d.png"], ["-frames:v", "1", "limited_%03d.png"], ["-vf", "scale=64:48", "-frames:v", "1", "filtered.png"]]) {
      const result = await runCmd(command, ["-y", ...seek, ...output], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const filename = output.at(-1)!.replace("%03d", "001");
      assert.deepEqual(vfs.store.get(`/${filename}`), expected, `${seek.join(" ")} ${output.join(" ")}`);
    }
  }
});

it("charges seek preroll to the decode budget and stops after the requested display frame", async () => {
  for (const [maxFrames, success] of [[4, false], [5, true]] as const) {
    const vfs = createTestVfs({ "in.mp4": seekH264 });
    const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts(), limits: { maxFrames } }),
      ["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs);
    assert.equal(result.exitCode === 0, success, result.stderr);
    assert.equal(vfs.store.has("/out.png"), success);
    if (!success) assert.match(result.stderr, /maxFrames/);
  }
});

it("rejects image extraction with no displayed frame", async () => {
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts() }),
    ["-ss", "2", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs);
  assert.notEqual(result.exitCode, 0);
  assert.equal(vfs.store.has("/out.png"), false);
});

it("cancels H.264 seeking before publishing an image", async () => {
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const controller = new AbortController();
  let turns = 0;
  registerYieldCheckpoint(controller.signal, () => {
    if (++turns === 4) controller.abort(new Error("cancel seek"));
  });
  try {
    const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts() }),
      ["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs, new Uint8Array(), controller.signal);
    assert.notEqual(result.exitCode, 0);
  } catch (error) {
    assert.match(String(error), /cancel seek/);
  }
  assert.ok(turns >= 4);
  assert.equal(vfs.store.has("/out.png"), false);
});

it("declines synchronous encoded image extraction so decoding stays cooperative", () => {
  let published = false;
  const result = evalSyncFfmpeg(["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"],
    undefined, () => seekH264, () => { published = true; return true; });
  assert.equal(result, undefined);
  assert.equal(published, false);
});

for (const [scale, width, height] of [["6:4", 6, 4], ["3:2", 3, 2], ["1:1", 1, 1]] as const) {
  it(`matches native default scale=${scale} pixels for a tiny RGB image`, async () => {
    const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
    const colors = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
    const input = encodeImage({
      width: 3, height: 2, channels: 4,
      data: new Uint8Array(colors.flatMap(color => [...color, 255])),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/input.png": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-i", "/input.png", "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, width);
    assert.equal(actual.height, height);
    // FFmpeg 9.0.1: bicubic support is capped to max(1, source dimension - 2).
    const expected = Array.from({ length: width * height }, (_, i) => {
      const x = Math.floor((i % width + 0.5) * 3 / width);
      const y = Math.min(1, Math.floor((Math.floor(i / width) + 0.5) * 2 / height));
      return [...colors[y * 3 + x]!, 255];
    }).flat();
    assert.deepEqual([...actual.data], expected);
  });
}

// Native FFmpeg 9.0.1 PNG reference pixels. Grayscale isolates the sampling
// curve from native RGB/YUV chroma conversion and subsampling.
for (const [width, height, pixels] of [
  [9, 8, [
    0,25,67,89,114,140,163,191,210,114,68,30,71,101,126,149,177,195,
    255,144,18,47,74,100,124,152,170,223,212,154,33,31,84,106,134,152,
    190,232,236,115,55,50,78,107,125,173,191,222,251,129,13,56,90,107,
    152,169,200,230,199,129,56,58,86,134,151,180,202,255,239,58,29,68
  ]],
  [3, 2, [115,88,151,190,144,86]]
] as const) {
  it(`matches native default bicubic sampling at 6x5 to ${width}x${height}`, async () => {
    const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({
      width: 6, height: 5, channels: 4,
      data: Uint8Array.from({ length: 120 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * 37 + 19) % 256),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/input.png": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.png", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, width);
    assert.equal(actual.height, height);
    assert.deepEqual([...actual.data], pixels.flatMap(value => [value, value, value, 255]));
  });
}

for (const [sourceRate, targetRate] of [[16000, 8000], [44100, 16000]] as const) {
  it(`low-pass filters audio downsampling from ${sourceRate} to ${targetRate}`, async () => {
    const channels = [1000, targetRate * 0.75].map(frequency =>
      Float64Array.from({ length: sourceRate }, (_, i) => 0.125 * Math.sin(2 * Math.PI * frequency * i / sourceRate)));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: sourceRate, channels }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", String(targetRate), "-c:a", "pcm_s16le", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, targetRate);
    assert.equal(audio.channels, 2);
    for (const [c, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, targetRate);
      const middle = samples.subarray(Math.floor(targetRate * 0.2), Math.floor(targetRate * 0.8));
      const rms = Math.sqrt(middle.reduce((sum, sample) => sum + sample * sample, 0) / middle.length);
      if (c === 0) assert.ok(Math.abs(rms - 0.125 / Math.SQRT2) < 0.001, `passband RMS: ${rms}`);
      else assert.ok(rms < 0.0001, `aliased RMS: ${rms}`);
    }
  });
}

describe("global metadata mapping", () => {
  for (const sync of [false, true]) {
    for (const [mapping, title] of [[undefined, "First"], ["0", "First"], ["1", "Second"], ["-1", undefined]] as const) {
      for (const override of [false, true]) {
        it(`${sync ? "sync" : "async"} maps metadata ${mapping ?? "by default"} with override=${override}`, async () => {
          const vfs = createTestVfs({
            "/first.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "First", artist: "Artist" } }),
            "/second.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "Second" } })
          });
          const args = ["-i", "/first.mp4", "-i", "/second.mp4",
            ...(sync ? [] : ["-map", "0:v"]),
            ...(mapping === undefined ? [] : ["-map_metadata", mapping]),
            ...(override ? ["-metadata", "title=Override"] : []), "-c", "copy", "/out.mp4"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const tags = parseMp4(vfs.store.get("/out.mp4")!).metadata;
          assert.equal(tags.title, override ? "Override" : title);
          assert.equal(tags.artist, mapping === "1" || mapping === "-1" ? undefined : "Artist");
        });
      }
    }
    for (const mapping of ["2", "oops", "1.5"]) {
      it(`${sync ? "sync" : "async"} rejects metadata source ${mapping} without writing output`, async () => {
        const vfs = createTestVfs({ "/first.mp4": createSyntheticMp4({ frameCount: 1 }) });
        const args = ["-i", "/first.mp4", "-map_metadata", mapping, "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
        } else {
          assert.notEqual((await runCmd(createFfmpegCommand(), args, vfs)).exitCode, 0);
        }
        assert.equal(vfs.store.has("/out.mp4"), false);
      });
    }
  }
});

describe("chapter mapping", () => {
  for (const sync of [false, true]) {
    for (const mapping of [undefined, "-1", "0", "1"]) {
      it(`${sync ? "sync" : "async"} serializes chapter mapping ${mapping ?? "by default"}`, async () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true, metadata: { title: "Keep me" } }));
        const chapters = [
          { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.04, title: "Opening" },
          { id: 1, startTimeSeconds: 0.04, endTimeSeconds: base.durationSeconds, title: "Ending" }
        ];
        const input = serializeMp4({ ...base, chapters });
        assert.equal(parseMp4(input).chapters?.length, 2);
        const vfs = createTestVfs({ "/in.mp4": input, "/empty.mp4": serializeMp4(base) });
        const args = ["-i", "/in.mp4", "-i", "/empty.mp4",
          ...(sync ? [] : ["-map", "0:a"]),
          ...(mapping === undefined ? [] : ["-map_chapters", mapping]),
          "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        assert.deepEqual(output.chapters?.map(ch => [ch.startTimeSeconds, ch.title]) ?? [],
          mapping === "-1" || mapping === "1" ? [] : chapters.map(ch => [ch.startTimeSeconds, ch.title]));
        assert.equal(output.metadata.title, "Keep me");
        assert.deepEqual(output.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]),
          base.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]));
      });
    }
    for (const mapping of ["2", "oops", "1.5", ""]) {
      it(`${sync ? "sync" : "async"} rejects invalid chapter source ${mapping}`, async () => {
        const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 1 }) });
        const args = ["-i", "/in.mp4", "-map_chapters", mapping, "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
        } else {
          assert.notEqual((await runCmd(createFfmpegCommand(), args, vfs)).exitCode, 0);
        }
        assert.equal(vfs.store.has("/out.mp4"), false);
      });
    }
  }
});


describe("stream language metadata", () => {
  for (const sync of [false, true]) {
    for (const [selector, expected] of [
      ["s:a:0", ["eng", "fra", "deu"]],
      ["s:a:1", ["eng", "eng", "fra"]],
      ["s:2", ["eng", "eng", "fra"]],
      ["s:a", ["eng", "fra", "fra"]],
      ["s", ["fra", "fra", "fra"]],
      ["s:a:9", ["eng", "eng", "deu"]]
    ] as const) {
      it(`${sync ? "sync" : "async"} applies ${selector} to output tracks`, async () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
        const audio = base.tracks.find(t => t.type === "audio")!;
        const input = serializeMp4({ ...base, tracks: [
          ...base.tracks.map(t => ({ ...t, language: "eng" })),
          { ...audio, id: 3, language: "deu" }
        ] });
        const vfs = createTestVfs({ "/in.mp4": input });
        const args = ["-i", "/in.mp4", "-c", "copy", "-metadata", "title=Global",
          `-metadata:${selector}`, "language=fra", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        assert.deepEqual(output.tracks.map(t => t.language), expected);
        assert.equal(output.metadata.title, "Global");
        assert.deepEqual(output.tracks.map(t => t.samples.map(s => s.data)),
          parseMp4(input).tracks.map(t => t.samples.map(s => s.data)));
      });
    }
  }
  it("selects output audio ordinals after mapping and honors the last language assignment", async () => {
    const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
    const audio = base.tracks.find(t => t.type === "audio")!;
    const vfs = createTestVfs({ "/in.mp4": serializeMp4({ ...base, tracks: [
      ...base.tracks, { ...audio, id: 3, language: "deu" }
    ] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4",
      "-map", "0:a:1", "-map", "0:a:0", "-c", "copy",
      "-metadata:s:a", "language=eng", "-metadata:s:a:0", "language=fra", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.language), ["fra", "eng"]);
  });
});

for (const [rate, nativePrefix] of [
  [16000, [0, 0.0546875, 0.16937255859375, 0.26300048828125]],
  [44100, [0, 0.007781982421875, 0.030029296875, 0.063751220703125]]
] as const) {
  for (const length of [8000, 8001]) it(`interpolates ${length} samples when resampling 8000 Hz to ${rate} Hz`, async () => {
    const tone = Float64Array.from({ length }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 8000));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [tone, tone.map(value => -value)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", String(rate), "-c:a", "pcm_s16le", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.equal(audio.channels, 2);
    for (const [channel, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, Math.round(length * rate / 8000));
      const sign = channel === 0 ? 1 : -1;
      // FFmpeg 9.0.2's reflected start boundary, including fractional phases.
      for (const [i, expected] of nativePrefix.entries()) {
        assert.ok(Math.abs(samples[i]! - sign * expected) < 0.003, `sample ${i}: ${samples[i]} versus ${sign * expected}`);
      }
      let squaredError = 0;
      for (let i = 200; i < rate - 200; i++) {
        squaredError += (samples[i]! - sign * 0.5 * Math.sin(2 * Math.PI * 440 * i / rate)) ** 2;
      }
      const rmsError = Math.sqrt(squaredError / (rate - 400));
      assert.ok(rmsError < 0.0001, `waveform RMS error: ${rmsError}`);
    }
  });
}

for (const length of [0, 80]) {
  for (const { args, rate, channels, gain, tempo } of [
    { args: [], rate: 8000, channels: 1, gain: 1, tempo: 1 },
    { args: ["-af", "volume=0.5"], rate: 8000, channels: 1, gain: 0.5, tempo: 1 },
    { args: ["-ar", "16000"], rate: 16000, channels: 1, gain: 1, tempo: 1 },
    { args: ["-ac", "2"], rate: 8000, channels: 2, gain: Math.SQRT1_2, tempo: 1 },
    { args: ["-af", "atempo=2,areverse"], rate: 8000, channels: 1, gain: 1, tempo: 2 }
  ]) {
    it(`preserves WAV sample count for ${length} samples with ${args.join(" ") || "no transform"}`, async () => {
      const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(length).fill(0.25)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", ...args, "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, rate);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      for (const samples of audio.channelData) {
        assert.equal(samples.length, length * rate / 8000 / tempo);
        for (const sample of samples) assert.ok(Math.abs(sample - 0.25 * gain) < 0.0001);
      }
    });
  }
}

it("preserves constant audio when upsampling clips shorter than the filter", async () => {
  for (const length of [1, 8]) {
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(length).fill(0.25)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", "16000", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(samples.length, length * 2);
    for (const sample of samples) assert.ok(Math.abs(sample - 0.25) < 0.0001);
  }
});

for (const codec of ["copy", "pcm_s16le"]) {
  it(`preserves PCM integers during WAV ${codec}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 160 }, (_, i) => [-1, -0.75, -0.5, 0, 0.5, 0.75, 1, 0.25][i % 8]!)
    ] });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", codec, "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseWav(vfs.store.get("/output.wav")!).tracks[0]!.samples.map(s => s.data),
      parseWav(input).tracks[0]!.samples.map(s => s.data));
  });
}

for (const bitsPerSample of [8, 24, 32] as const) {
  it(`copies ${bitsPerSample}-bit WAV packets with their original precision`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([-1, -0.5, 0, 1 / 2147483648, 1 - 1 / 2147483648])
    ] }, { bitsPerSample });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", "copy", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(vfs.store.get("/output.wav"), input);
  });
}

for (const channels of [2, 3]) {
  for (const level of [0.5, -0.5]) {
    it(`matches native mono upmix to ${channels} channels at ${level}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(level)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", "-ac", String(channels), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, 80);
        // Native FFmpeg maps mono to FL/FR at equal power and leaves LFE silent.
        const expected = channel < 2 ? level * Math.SQRT1_2 : 0;
        for (const sample of samples) assert.ok(Math.abs(sample - expected) <= 1 / 32768, `channel ${channel}: ${sample} versus ${expected}`);
      }
    });
  }
}

for (const channels of [3, 4]) {
  for (const levels of [[0.5, -0.5], [0.25, 0.5]]) {
    it(`matches native stereo upmix to ${channels} channels for ${levels}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: levels.map(level => new Float64Array(800).fill(level)) });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", "-ac", String(channels), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      // Native FFmpeg preserves FL/FR and leaves the added channels silent.
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, 800);
        const expected = levels[channel] ?? 0;
        for (const sample of samples) assert.ok(Math.abs(sample - expected) <= 1 / 32768, `channel ${channel}: ${sample} versus ${expected}`);
      }
    });
  }
}

// Header emitted by native FFmpeg 9 from a 0.1-second, 8000 Hz PCM16 5.1 WAV.
const surroundWavHeader = "52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff";

for (const mask of [0x3f, 0x60f]) {
  for (const [channel, expected] of [[0, 3393], [1, 3393], [2, 4799], [3, 0], [4, 2399], [5, 2399]]) {
    it(`matches native 5.1 mono downmix for mask ${mask}, channel ${channel}`, async () => {
      const header = Buffer.from(surroundWavHeader, "hex");
      const input = new Uint8Array(header.length + 800 * 12);
      input.set(header);
      const view = new DataView(input.buffer);
      view.setUint32(40, mask, true);
      for (let i = 0; i < 800; i++) view.setInt16(header.length + i * 12 + channel! * 2, 16384, true);
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ac", "1", "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!);
      assert.equal(output.durationSeconds, 0.1);
      const audio = output.tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 1);
      assert.equal(audio.channelData[0]!.length, 800);
      assert.ok(audio.channelData[0]!.every(sample => Math.abs(sample * 32768 - expected!) <= 1));
    });
  }
}

it("rejects unsupported surround downmix layouts without overwriting output", async () => {
  const header = Buffer.from(surroundWavHeader, "hex");
  const input = new Uint8Array(header.length + 800 * 12);
  input.set(header);
  new DataView(input.buffer).setUint32(40, 0x707, true);
  const vfs = createTestVfs({ "/input.wav": input, "/output.wav": "existing" });
  const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-ac", "1", "/output.wav"], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("Unsupported audio channel layout"), result.stderr);
  assert.equal(new TextDecoder().decode(vfs.store.get("/output.wav")), "existing");
});


describe("image sequence output synchronization", () => {
  for (const [filter, count] of [
    ["select='eq(n,1)+eq(n,3)'", 3],
    ["setpts=2*PTS", 7],
    ["select='eq(n,1)+eq(n,3)',setpts=PTS", 3],
    ["select='eq(n,1)+eq(n,3)',setpts=PTS-STARTPTS", 3],
    ["fps=2", 8], ["fps=0.5", 2], ["reverse", 4], ["trim=start=1:end=3", 2]
  ] as const) {
    it(`matches native default cadence for ${filter}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
        "-vf", filter, "/out_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()], Array.from({ length: count }, (_, i) => `/out_${i + 1}.png`));
    });
  }
  for (const flags of [["-fps_mode", "passthrough"], ["-vsync", "0"]]) {
    for (const [filter, count] of [["select='eq(n,1)+eq(n,3)'", 2], ["setpts=2*PTS", 4]] as const) {
      it(`honors ${flags.join(" ")} for ${filter}`, async () => {
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
          "-vf", filter, ...flags, "/out_%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(vfs.store.size, count);
      });
    }
  }
  it("limits synchronized output frames before numbering", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
      "-vf", "setpts=2*PTS", "-frames:v", "5", "-start_number", "7", "/out_%d.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...vfs.store.keys()], [7, 8, 9, 10, 11].map(i => `/out_${i}.png`));
  });
});


for (const [filter, indices] of [
  ["setpts=2*PTS", [0, 1, 1, 2, 2, 3, 3]],
  ["select='eq(n,1)+eq(n,3)'", [1, 3, 3]],
  ["setpts=0.25*PTS", [0, 1, 2]]
] as const) {
  it(`matches native frame identity from image input for ${filter}`, async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
    const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
      `/in_${i + 1}.png`, encodeImage({ width: 1, height: 1, data: Uint8Array.from(color),
        channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data
    ])));
    const result = await runCmd(createFfmpegCommand(), [
      "-framerate", "1", "-i", "/in_%d.png", "-vf", filter, "/out_%d.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = [...vfs.store.entries()].filter(([name]) => name.startsWith("/out_"));
    assert.deepEqual(output.map(([, data]) => [...decodeImage(data).data]), indices.map(i => colors[i]));
  });
}


it("bounds frames duplicated by output synchronization", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand({ limits: { maxFrames: 5 } }), [
    "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
    "-vf", "setpts=1000000*PTS", "/out_%d.png"
  ], vfs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /maxFrames/);
  assert.ok(vfs.store.size <= 5);
});
