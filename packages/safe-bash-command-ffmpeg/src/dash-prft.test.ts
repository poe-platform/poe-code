import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.mp4", "-c", "copy", "-f", "dash",
      "-seg_duration", "1", ...options, "/out.mpd"],
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
  return { ...result, stderr };
}

for (const [options, count] of [
  [["-write_prft", "1", "-streaming", "1", "-utc_timing_url", "https://example.invalid/time"], 8],
  [["-streaming", "1", "-utc_timing_url", "https://example.invalid/time"], 0],
  [["-write_prft", "0", "-ldash", "1", "-utc_timing_url", "https://example.invalid/time"], 0],
  [["-ldash", "1", "-utc_timing_url", "https://example.invalid/time"], 8],
  [["-write_prft", "1", "-streaming", "1"], 0],
  [["-write_prft", "1", "-utc_timing_url", "https://example.invalid/time"], 0]
] as const) {
  it(`writes ${count} producer times for ${options.join(" ")}`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({ width: 32, height: 24, frameCount: 8, fps: 8, includeAudio: false })) });
    const result = await run(volume, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    const bytes = volume.readFileSync("/chunk-stream0-00001.m4s") as Buffer;
    const boxes = parseMp4Boxes(bytes);
    assert.equal(boxes.filter(box => box.type === "prft").length, count);
    const manifest = volume.readFileSync("/out.mpd", "utf8") as string;
    assert.equal(manifest.includes("<UTCTiming"), options.some(option => option === "-utc_timing_url"));
  });
}

for (const option of ["-write_prft", "-streaming", "-ldash"]) {
  it(`rejects invalid ${option} before writing output`, async () => {
    const volume = Volume.fromJSON({ "/out.mpd": "keep" });
    const result = await run(volume, [option, "2"]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(`invalid ${option.slice(1)}`));
    assert.deepEqual(volume.toJSON(), { "/out.mpd": "keep" });
  });
}
