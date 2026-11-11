import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output and exit statuses from native FFmpeg 7.0.2.
for (const [layout, exitCode, hex] of [
  ["FL+FR", 0, "b80bb80b401f401f9ce69ce66cee6cee"],
  ["FR+FL", 234, ""],
  ["FC+LFE", 0, "191619160c0b0c0bced3ced300000000"],
  ["BL+BR", 234, ""]
] as const) for (const graph of [false, true]) for (const existing of [false, true]) {
  it(`haas respects ${layout} (${graph ? "graph" : "simple"}, ${existing ? "existing" : "new"} output)`, async () => {
    const input = encodeWav({ sampleRate: 16000, channels: [
      Float64Array.from([8000, 4000, -16000, 0], value => value / 32768),
      Float64Array.from([-2000, 12000, 3000, -9000], value => value / 32768)
    ] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    if (existing) volume.writeFileSync("/out.raw", "KEEP");
    const filter = `channelmap=0|1:${layout},haas`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(hex, "hex"));
    assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  });
}
