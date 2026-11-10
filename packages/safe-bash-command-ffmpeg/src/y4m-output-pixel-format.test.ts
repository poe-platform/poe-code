import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
  ...Array.from({ length: 6 }, (_, frame) => [Buffer.from("FRAME\n"), Buffer.from(
    Array.from({ length: 3 }, (_, plane) => Array.from({ length: 4 }, (_, row) =>
      Array<number>(4).fill(plane === 0 ? 32 + 24 * frame + 3 * row
        : plane === 1 ? 35 + 9 * frame + row : 216 - 8 * frame - row))).flat(2)
  )]).flat()]);

async function run(filter: string, pixelFormat: string, target: string, muxer?: string) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", pixelFormat,
      ...(muxer ? ["-f", muxer] : []), target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  if (target === "-") assert.equal(volume.readFileSync("/out.y4m", "utf8"), "KEEP");
  return target === "-" ? Buffer.concat(chunks) : volume.readFileSync(target) as Buffer;
}

function payload(output: Buffer, chroma: string, frameBytes: number, frames: number) {
  const headerEnd = output.indexOf(10) + 1;
  assert.ok(output.subarray(0, headerEnd).toString().trim().split(" ").includes(`C${chroma}`),
    output.subarray(0, headerEnd).toString());
  assert.equal(output.length - headerEnd, frames * (6 + frameBytes));
  return Buffer.concat(Array.from({ length: frames }, (_, frame) => {
    const start = headerEnd + frame * (6 + frameBytes);
    assert.equal(output.subarray(start, start + 6).toString(), "FRAME\n");
    return output.subarray(start + 6, start + 6 + frameBytes);
  }));
}

for (const [filter, frames] of [
  ["tinterlace=4", 3], ["telecine=pattern=23", 7], ["null", 6]
] as const) {
  for (const target of ["/out.y4m", "-"]) {
    it(`encodes explicit YUV444 planes after ${filter} to ${target}`, async () => {
      const output = await run(filter, "yuv444p", target, target === "-" ? "yuv4mpegpipe" : undefined);
      payload(output, "444", 48, frames);
    });
  }

  for (const [format, chroma, frameBytes] of [
    ["yuv444p", "444", 48], ["yuv422p", "422", 32], ["yuv420p", "420jpeg", 24]
  ] as const) {
    it(`honors ${format} after ${filter} invalidates its native planes`, async () => {
      const chain = `${filter},format=rgba,negate`;
      const output = await run(chain, format, "/out.y4m", "yuv4mpegpipe");
      const raw = await run(`${chain},format=${format}`, format, "-", "rawvideo");
      assert.deepEqual(payload(output, chroma, frameBytes, frames), raw);
    });
  }
}
