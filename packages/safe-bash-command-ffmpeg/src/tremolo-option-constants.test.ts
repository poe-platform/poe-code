import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8192 mono PCM16 samples of 8192 at 8 kHz.
for (const [filter, exitCode, hash] of [
  ["tremolo=d=min", 0, "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["tremolo=d=max", 0, "0517546525d7d18e5a6f4148f4e976747c46d1c78e86bf0450d517df520682fb"],
  ["tremolo=d=default", 0, "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["tremolo=f=default", 0, "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["tremolo=f=min", 0, "abfe3a8bebcad2ce3064be1f633986a373566a0717f8a0ccae0845f71e3f044d"],
  ["tremolo=f=max", 0, "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["tremolo=d=max(0\\,0.5)", 234],
  ["tremolo=f=min(5\\,10)", 234],
  ["tremolo=f=none", 222],
  ["tremolo=f=all", 222],
  ["tremolo=d=0", 0, "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["tremolo=d=1", 0, "0517546525d7d18e5a6f4148f4e976747c46d1c78e86bf0450d517df520682fb"],
  ["tremolo=f=0.1", 0, "abfe3a8bebcad2ce3064be1f633986a373566a0717f8a0ccae0845f71e3f044d"],
  ["tremolo=f=20000", 0, "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["tremolo=enable=max(0\\,1)", 0, "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["tremolo=enable=min(1\\,2)", 0, "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native status and destination bytes (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000, channels: [new Float64Array(8192).fill(8192 / 32768)]
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
      if (exitCode === 0) {
        assert.equal(output.length, 16384);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      } else assert.equal(output.toString(), "KEEP");
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
