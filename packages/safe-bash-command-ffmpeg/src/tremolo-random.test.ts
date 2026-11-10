import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 8192 mono PCM16 samples of 8192 at 8 kHz,
// evaluated in 128-sample frames. Hashes were identical across native processes.
for (const [filter, hash] of [
  ["tremolo=enable=random(0)", "7072c3ac3d4050d2a621ac6776cbbafa92cfa049949826a2ea48b5c1f1ec2f06"],
  ["tremolo=enable=randomi(0\\,0\\,1)", "7072c3ac3d4050d2a621ac6776cbbafa92cfa049949826a2ea48b5c1f1ec2f06"],
  ["tremolo", "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["anull", "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["tremolo=enable=mod(n\\,2)", "00673418ba16cb5ea0cdfc8fc1029dcd1c9f0b42cbd4b0d337cc51a5814bd30b"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const command = createFfmpegCommand();
      for (let repeat = 0; repeat < 2; repeat++) {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(8192).fill(0.25)] }));
        const filters = `asetnsamples=n=128,${filter}`;
        let stderr = "";
        const result = await command.execute({
          args: ["-y", "-v", "error", "-i", "/tone.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filters}[out]`, "-map", "[out]"]
            : ["-af", filters]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(pcm.length, 16384);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      }
    });
  }
}
