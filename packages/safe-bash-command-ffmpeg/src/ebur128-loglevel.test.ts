import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [level, frameLog, count, summary] of [
  ["info", "verbose", 0, true], ["verbose", "verbose", 35, true],
  ["info", "info", 35, true], ["warning", "info", 0, false],
  ["quiet", "verbose", 0, false], ["info", "", 35, true],
  ["32", "32", 35, true], ["32", "40", 0, true], ["40", "40", 35, true]
] as const) {
  it(`ebur128 framelog=${frameLog || "default"} respects -v ${level}`, async () => {
    const channels = [Float64Array.from({ length: 28160 }, (_, i) =>
      i < 28000 ? Math.sin(2 * Math.PI * 440 * i / 8000) / 4 : 30000 / 32768)];
    const fs = Volume.fromJSON({});
    const input = encodeWav({ sampleRate: 8000, channels });
    fs.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", level,
        "-i", "/in.wav", "-af", frameLog ? `ebur128=framelog=${frameLog}` : "ebur128",
        "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr.split("\n").filter(line => line.includes("TARGET:")).length, count);
    assert.equal(stderr.includes("Summary:"), summary);
    if (summary) {
      assert.ok(stderr.includes("Integrated loudness:"));
      assert.ok(stderr.includes("Loudness range:"));
    } else assert.equal(stderr, "");
    assert.deepEqual(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio,
      parseWav(input).tracks[0]!.decodedAudio);
  });
}
