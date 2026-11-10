import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: mono PCM16 at 8 kHz. The f=5 control uses
// 8192 samples of 8192; the other cases use 16 samples of 16000.
for (const [filter, exitCode] of [
  ["tremolo=d=2", 222],
  ["tremolo=d=-1", 222],
  ["tremolo=f=0", 222],
  ["tremolo=f=20001", 222],
  ["tremolo=d=1/0", 222],
  ["tremolo=d=-1/0", 222],
  ["tremolo=f=1/0", 222],
  ["tremolo=f=-1/0", 222],
  ["tremolo=f=Inf", 222],
  ["tremolo=f=-Inf", 222],
  ["tremolo=d=+inf", 222],
  ["tremolo=d=-INF", 222],
  ["tremolo=f=Infinity", 222],
  ["tremolo=d=-iNfInItY", 222],
  ["tremolo=f=1e309", 222],
  ["tremolo=d=abs(-1/0)", 222],
  ["tremolo=f=0/0", 234],
  ["tremolo=d=0/0", 234],
  ["tremolo=f=NaN", 234],
  ["tremolo=d=NaN", 234],
  ["tremolo=foo=1", 8],
  ["tremolo=f=no", 234],
  ["tremolo=d=", 234],
  ["tremolo=d=1", 0],
  ["tremolo=f=5", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native status and destination bytes (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000, channels: [filter === "tremolo=f=5"
          ? new Float64Array(8192).fill(8192 / 32768)
          : new Float64Array(16).fill(16000 / 32768)]
      }, { bitsPerSample: 16 }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out") as Buffer;
      if (filter === "tremolo=f=5") {
        assert.equal(output.length, 16384);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de");
      } else {
        assert.equal(output.toString("hex"), exitCode === 0
          ? "803e803e803e7f3e7f3e7e3e7e3e7d3e7c3e7b3e7a3e793e773e763e743e723e" : "4b454550");
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
