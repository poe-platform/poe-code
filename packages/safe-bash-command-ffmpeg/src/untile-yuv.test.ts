import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p", size = "2x2", y4m = false) {
  const volume = Volume.fromJSON({ "/in": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(y4m ? [] : ["-f", "rawvideo", "-pix_fmt", format, "-s", size, "-r", "5"]),
      "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out") as Buffer;
}

// Native FFmpeg: raw 4x4 input, untile=2x2, passthrough timestamps.
for (const [format, length, hex] of [
  ["yuv420p", 24, "1019343da0c4222b464fa9cd58617c85b2d66a738e97bbdf"],
  ["yuv422p", 32, "1019343da0b2e8fa222b464fa9bbf10358617c85c4d60c1e6a738e97cddf1527"],
  ["yuv444p", 48, "1019343da0a9c4cd3039545d222b464fb2bbd6df424b666f58617c85e8f10c1578819ca56a738e97fa031e278a93aeb7"]
] as const) {
  it(`preserves source ${format} samples when extracting cells`, async () => {
    const input = Uint8Array.from({ length }, (_, i) => (16 + 9 * i) % 256);
    assert.deepEqual(await run(input, "untile=2x2", format, "4x4"), Buffer.from(hex, "hex"));
  });
}

for (const depth of [10, 16]) {
  it(`preserves ${depth}-bit samples through tile and untile`, async () => {
    const payload = Buffer.alloc(96);
    for (let i = 0; i < 48; i++) payload.writeUInt16LE((129 + i * 13) << (depth - 10), i * 2);
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F5:1 Ip A1:1 C444p${depth}\nFRAME\n`),
      payload, Buffer.from("FRAME\n"), payload]);
    assert.deepEqual(await run(input, "tile=2x1,untile=2x1", `yuv444p${depth}le`, "4x4", true),
      Buffer.concat([payload, payload]));
  });
}

it("does not restore source samples after an RGB filter changes the image", async () => {
  const input = Uint8Array.from({ length: 48 }, (_, i) => (16 + 9 * i) % 256);
  assert.deepEqual(await run(input, "format=rgba,negate,untile=1x1", "yuv444p", "4x4"),
    await run(input, "format=rgba,negate", "yuv444p", "4x4"));
});

it("renders extracted native planes for downstream RGB filters", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F5:1 Ip A1:1 C444\nFRAME\n"),
    Buffer.from([50, 30, 212].flatMap(value => Array<number>(16).fill(value)))]);
  assert.deepEqual(await run(input, "untile=2x2,format=rgba", "rgba", "4x4", true),
    Buffer.from("ae0a00ff".repeat(16), "hex"));
});
