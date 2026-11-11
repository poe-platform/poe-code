import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function drawbox(format: string, size: number, filter: string) {
  const input = Buffer.from(Array.from({ length: size }, (_, i) => (7 + 29 * i) % 256));
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "4x4", "-framerate", "2", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(output);
}

// Exact raw output captured from FFmpeg 7.0.2.
for (const [format, size, filter, expected] of [
  ["gray", 16, "drawbox=x=hsub:y=vsub:w=1:h=1:t=fill:c=white", "ff24415e7b98b5d2ef0c294663809dba"],
  ["yuv420p", 24, "drawbox=x=hsub:y=vsub:w=1:h=1:t=fill:c=white", "0724415e7bebb5d2ef0c294663809dba80f4112e806885a2"],
  ["gray", 16, "setsar=2,drawbox=x=sar:y=dar:w=1:h=1:t=fill:c=white", "0724415e7b98b5d2ef0cff4663809dba"]
] as const) {
  it(`${format} ${filter} matches native raw bytes`, async () => {
    assert.equal((await drawbox(format, size, filter)).toString("hex"), expected);
  });
}

for (const [format, size, x, y] of [
  ["gray", 16, 0, 0], ["rgba", 64, 0, 0], ["yuv420p", 24, 1, 1],
  ["yuv422p", 32, 1, 0], ["yuv444p", 48, 0, 0]
] as const) {
  it(`${format} exposes chroma subsampling exponents in positional geometry`, async () => {
    const expected = await drawbox(format, size, `drawbox=${x}:${y}:1:1:white:fill`);
    assert.deepEqual(await drawbox(format, size, "drawbox=hsub:vsub:1:1:white:fill"), expected);
  });
}

for (const [prefix, expression, literal] of [
  ["", "x=sar:y=dar:w=1:h=1:t=fill", "x=1:y=1:w=1:h=1:t=fill"],
  ["setsar=0,", "x=sar:y=dar:w=1:h=1:t=fill", "x=1:y=1:w=1:h=1:t=fill"],
  ["setsar=2,", "x=0:y=0:w=sar+2:h=dar+2:t=sar/2", "x=0:y=0:w=4:h=4:t=1"],
  ["setsar=2,crop=4:2,", "x=sar:y=dar/4:w=1:h=1:t=fill", "x=2:y=1:w=1:h=1:t=fill"],
  ["", "x=0:y=0:w=iw-hsub:h=ih-vsub:t=hsub+1", "x=0:y=0:w=3:h=3:t=2"]
]) {
  it(`drawbox uses incoming format and aspect after ${prefix || "raw input"}: ${expression}`, async () => {
    const expected = await drawbox("yuv420p", 24, `${prefix}drawbox=${literal}:c=white`);
    assert.deepEqual(await drawbox("yuv420p", 24, `${prefix}drawbox=${expression}:c=white`), expected);
  });
}

it("drawbox runtime geometry commands use incoming subsampling and aspect", async () => {
  const expected = await drawbox("yuv420p", 24, "setsar=2,drawbox=x=1:y=2:w=1:h=1:t=fill:c=white");
  const actual = await drawbox("yuv420p", 24,
    "setsar=2,sendcmd=c='0 drawbox x hsub;0 drawbox y dar',drawbox=x=0:y=0:w=1:h=1:t=fill:c=white");
  assert.deepEqual(actual, expected);
});
