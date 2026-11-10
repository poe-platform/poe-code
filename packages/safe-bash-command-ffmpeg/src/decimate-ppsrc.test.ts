import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const duplicate = [20, 50, 50, 100, 140, 170, 170, 205, 221];
const unique = [20, 50, 65, 100, 140, 170, 180, 205, 221];
function y4m(values: number[]) {
  return Buffer.concat([
    Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
    ...values.flatMap(value => [Buffer.from("FRAME\n"), Buffer.alloc(1024, value), Buffer.alloc(2048, 128)])
  ]);
}

async function run(filters: string[]) {
  const volume = Volume.fromJSON({ "/unique.y4m": y4m(unique), "/dup.y4m": y4m(duplicate), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/unique.y4m", "-i", "/dup.y4m", ...filters,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Byte-for-byte native FFmpeg 7.0.2 references, including incomplete-cycle EOF behavior.
for (const [filters, levels, digest] of [
  [["-filter_complex", "[1:v][0:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[out]"],
    [20, 50, 100, 140, 170, 205], "854e82385e0be2b824d68d715c5a215200a98134c555e93a6ad198ee7172321c"],
  [["-filter_complex", "[0:v][1:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[out]"],
    [50, 50, 100, 170, 170, 205], "172bd0f0d775e0c43dbd8887feb6174fcb432650b7504593c1d032f442e1c70a"],
  [["-map", "1:v", "-vf", "decimate=cycle=4:ppsrc=0"],
    [20, 50, 100, 140, 170, 205, 221], "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23"],
  [["-filter_complex", "[1:v:0][0:v:0]decimate=4:ppsrc=true[out]", "-map", "[out]"],
    [20, 50, 100, 140, 170, 205], "854e82385e0be2b824d68d715c5a215200a98134c555e93a6ad198ee7172321c"],
  [["-filter_complex", "[1:v]decimate=cycle=4:ppsrc=0[out]", "-map", "[out]"],
    [20, 50, 100, 140, 170, 205, 221], "a54694732c7bf725a01acc3b2be367b1cad13baecfe0abaa5293c23e2e488c23"],
  [["-filter_complex", "[1:v][0:v]decimate=cycle=4:ppsrc=1,select='between(t,0.25,0.41)'[out]", "-map", "[out]"],
    [100, 140]],
] as const) {
  it(`decimate clean source preserves native bytes: ${filters.join(" ")}`, async () => {
    const { result, stderr, output } = await run([...filters]);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, levels.length * 3072);
    assert.deepEqual(Array.from({ length: levels.length }, (_, index) => output[index * 3072]), levels);
    if (digest) assert.equal(createHash("sha256").update(output).digest("hex"), digest);
  });
}

for (const filters of [
  ["-vf", "decimate=cycle=4:ppsrc=1"],
  ["-vf", "decimate=cycle=4:ppsrc=2"],
  ["-vf", "decimate=cycle=4:ppsrc="],
  ["-filter_complex", "[0:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[out]"],
  ["-filter_complex", "[0:v][1:v]decimate=cycle=4:ppsrc=0[out]", "-map", "[out]"],
  ["-filter_complex", "[0:v][2:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[out]"],
  ["-filter_complex", "[0:a][1:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[out]"],
  ["-filter_complex", "[0:v][1:v]decimate=cycle=4:ppsrc=1[out]", "-map", "[missing]"],
]) {
  it(`decimate rejects invalid options and connections without overwriting output: ${filters.join(" ")}`, async () => {
    const { result, stderr, output } = await run(filters);
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("decimate:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
