import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and PCM16 control hash.
for (const graph of [false, true]) {
  for (const [filter, exitCode] of [
    ["haas=unknown=1", 8],
    ["haas=enable=0", 176],
    ["haas=level_in=0", 222],
    ["haas=level_in=nope", 234],
    ["haas", 0]
  ] as const) {
    it(`${filter} returns native status ${exitCode} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const channels = Array.from({ length: 2 }, (_, channel) =>
        Float64Array.from({ length: 1536 }, (_, frame) =>
          ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768));
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (exitCode !== 0) {
        assert.equal(output.toString(), "KEEP");
        assert.ok(stderr.startsWith("ffmpeg: haas:"), stderr);
      } else {
        assert.equal(stderr, "");
        assert.equal(output.length, 6144);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "ec2a6dc16866fc95105c82681d94ccd18a9f775f91dc25b3ad74b4e88305c294");
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
