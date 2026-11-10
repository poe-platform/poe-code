import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: stereo PCM16 at 44100 Hz, 1536 frames.
for (const graph of [false, true]) {
  for (const [filter, exitCode] of [
    ["earwax", 0],
    ["earwax=enable=0", 176],
    ["earwax=unknown=1", 8],
    ["earwax=foo", 234]
  ] as const) {
    it(`${filter} returns native status and preserves output on failure (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({
        sampleRate: 44100,
        channels: [0, 1].map(channel => Float64Array.from({ length: 1536 },
          (_, frame) => ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768))
      }, { bitsPerSample: 16 });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
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
      assert.equal(result.exitCode, exitCode, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (exitCode === 0) {
        assert.equal(output.length, 6144);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "1939dc79f772a387d5f452053f73d6c263ee685c9cd20ac2e066b06878ac916c");
      } else {
        assert.equal(output.toString(), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
