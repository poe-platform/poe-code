import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, parseMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/clean.mp4", readFileSync(new URL("../../mp4-ast/src/fixtures/dash-low-latency.mp4", import.meta.url)));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "clean.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, "out.mpd"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

// Reference: FFmpeg 7.0.2 with the same input and flags.
for (const [flags, streaming, bufferTime] of [
  [[], false, 2],
  [["-ldash", "0"], false, 2],
  [["-ldash", "1"], true, 1],
  [["-streaming", "1"], true, 2],
  [["-ldash", "0", "-streaming", "1"], true, 2],
  [["-ldash", "1", "-streaming", "0"], true, 1],
  [["-streaming", "0", "-ldash", "1"], true, 1],
  [["-ldash", "1", "-ldash", "0"], false, 2]
] as const) {
  it(`preserves DASH segment timing and applies low-latency buffering: ${flags.join(" ") || "defaults"}`, async () => {
    const { result, stderr, volume } = await run([...flags]);
    assert.equal(result.exitCode, 0, stderr);
    const xml = volume.readFileSync("/out.mpd", "utf8") as string;
    assert.equal(Number(xml.split('minBufferTime="PT')[1]!.split('S"')[0]), bufferTime);
    assert.ok(xml.includes('<S t="0" d="16384" r="3"'), xml);
    const initialization = volume.readFileSync("/init-stream0.m4s") as Buffer;
    const chunks: Uint8Array[] = [];
    for (let segment = 1; segment <= 4; segment++) {
      const bytes = volume.readFileSync(`/chunk-stream0-${String(segment).padStart(5, "0")}.m4s`) as Buffer;
      const boxes = parseMp4Boxes(bytes);
      assert.equal(boxes.filter(box => box.type === "moof").length, streaming ? 8 : 1);
      assert.equal(boxes.filter(box => box.type === "sidx").length, streaming ? 0 : 1);
      chunks.push(bytes);
    }
    const input = parseMp4(new Uint8Array(volume.readFileSync("/clean.mp4") as Buffer));
    const output = parseMp4(concatBytes([initialization, ...chunks]));
    assert.deepEqual(output.tracks[0]!.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]),
      input.tracks[0]!.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]));
  });
}

for (const value of ["2", "-1", "invalid"]) {
  it(`rejects invalid ldash=${value} before creating output`, async () => {
    const { result, stderr, volume } = await run(["-ldash", value]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("invalid ldash"), stderr);
    assert.deepEqual(volume.readdirSync("/"), ["clean.mp4"]);
  });
}
