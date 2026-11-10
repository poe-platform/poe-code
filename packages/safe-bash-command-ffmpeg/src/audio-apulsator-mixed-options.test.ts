import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16: 32 stereo frames of (10000, -8000) at 8 kHz.
for (const [mixed, named, hash] of [
  [
    "amount=0.5:width=1:level_in=0.5:0.25",
    "amount=0.5:width=1:level_in=0.5:level_out=0.25",
    "046d0f91b71a00a657a96d8896ea1c6a9667ddb17bdf2239bc129fa69b29e597"
  ],
  [
    "amount=0.5:width=1:0.25",
    "amount=0.5:width=1:level_in=0.25",
    "ae682758c8924ace0dbe51c0c41741be7d6514d02951f1a47303d5553c115656"
  ]
] as const) {
  for (const options of [mixed, named]) {
    for (const graph of [false, true]) {
      it(`apulsator=${options} matches native mixed-option PCM (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          new Float64Array(32).fill(10000 / 32768),
          new Float64Array(32).fill(-8000 / 32768)
        ] }, { bitsPerSample: 16 }));
        let stderr = "";
        const filter = `apulsator=${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(bytes.length, 128);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}
