import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
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
  const output = volume.readFileSync("/out.y4m") as Buffer;
  const headerEnd = output.indexOf(10);
  const frames: Buffer[] = [];
  for (let offset = headerEnd + 1; offset < output.length; offset += 54) {
    assert.equal(output.subarray(offset, offset + 6).toString(), "FRAME\n");
    const frame = output.subarray(offset + 6, offset + 54);
    assert.equal(frame.length, 48);
    frames.push(frame);
  }
  return { header: output.subarray(0, headerEnd).toString().split(" "), frames };
}

for (const color of [false, true]) {
  const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
  ]));
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
  const bottom = Array.from({ length: 3 }, (_, pair) => Buffer.concat(
    Array.from({ length: 12 }, (_, row) => frames[pair * 2 + (1 - row % 2)]!.subarray(row * 4, row * 4 + 4))
  ));

  for (const mode of ["interleave_bottom", "mode=interleave_bottom", "5", "mode=5"]) {
    it(`weaves ${color ? "color" : "gray"} YUV rows bottom-first with ${mode}`, async () => {
      const output = await run(input, `tinterlace=${mode}`);
      assert.deepEqual(output.header.slice(0, 7), ["YUV4MPEG2", "W4", "H4", "F3:1", "Ib", "A1:1", "C444"]);
      assert.deepEqual(output.frames, bottom);
      assert.deepEqual(output.frames.slice(0, 2).map(frame => [frame[0], frame[4], frame[8], frame[12]]),
        [[56, 35, 62, 41], [104, 83, 110, 89]]);
      if (!color) {
        // Native Linux FFmpeg 7.0.2 payload hash, excluding Y4M framing.
        assert.equal(createHash("sha256").update(Buffer.concat(output.frames)).digest("hex"),
          "12c28b192d07e43673d583d073454ccc52f6dc93f0c74a9cd8fdf882af06a68d");
      }
    });
  }

  it(`preserves ${color ? "color" : "gray"} YUV input in the null control`, async () => {
    const output = await run(input, "null");
    assert.deepEqual(output.header.slice(0, 7), ["YUV4MPEG2", "W4", "H4", "F6:1", "Ip", "A1:1", "C444"]);
    assert.deepEqual(output.frames, frames);
    if (!color) {
      assert.equal(createHash("sha256").update(Buffer.concat(output.frames)).digest("hex"),
        "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0");
    }
  });

  it(`drops an unmatched ${color ? "color" : "gray"} frame and retains bottom-first metadata downstream`, async () => {
    const output = await run(input, "trim=end_frame=5,tinterlace=5,select=eq(interlace_type\\,BOTTOMFIRST)");
    assert.deepEqual(output.frames, bottom.slice(0, 2));
  });

  it(`retains the first timestamp in each ${color ? "color" : "gray"} frame pair`, async () => {
    const output = await run(input, "tinterlace=5,select=eq(t\\,1/3)");
    assert.deepEqual(output.frames, bottom.slice(1, 2));
  });
}
