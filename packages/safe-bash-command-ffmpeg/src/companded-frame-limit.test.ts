import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg SHA-256 for mono PCM16 samples 0..5999, encoded as G.711.
const golden = {
  alaw: {
    512: "99ffc60cd0b81cfacf047730bbddbd52303b66da36544ed2a147b79dc7381ccf",
    1024: "fd8626d212e549b9fb925cb4d857653c92f9a29328c72b5cfd64d193c33990a2",
    4096: "0cdbb1104b7dd0f1f2e746d1179b96f4b9e99da5364bed42446fa35be5553d3d",
    6000: "40cd39c80f0f9cdefb4aa9f4555dd5c79b15b0cb839615df871ea7d8d792898b"
  },
  mulaw: {
    512: "1c1c4964f9fb41e8728624b4d3de45c0dec9caae22aa3bd29ad1d31de8a28fb0",
    1024: "45a0a9b100d557269a950636a4084c0ebd9f0abb06a3da405f77c97ab6481082",
    4096: "9757af63f5be379c0dd6d9539291a7a0c1e6716d78b0fb79c17e1fcdf039954e",
    6000: "d8a42ea5b53a44de33704cbf2d213674956cbe1ecc52a59ae74098eacd36a5a5"
  }
};

for (const format of ["alaw", "mulaw"] as const) for (const sampleRate of [8000, 44100]) {
  for (const limit of [0, 1, 2, undefined]) for (const copy of [false, true]) {
    it(`limits raw ${format} ${copy ? "copy" : "encoding"} at ${sampleRate} Hz to ${limit ?? "all"} frames`, async () => {
      const input = Buffer.from(encodeWav({ sampleRate,
        channels: [Float64Array.from({ length: 6000 }, (_, i) => i / 32768)] }));
      const volume = Volume.fromJSON({ "/in.wav": input });
      const run = async (args: string[]) => {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      };
      if (copy) await run(["-i", "/in.wav", "-c:a", `pcm_${format}`, "/companded.wav"]);
      await run(["-i", copy ? "/companded.wav" : "/in.wav", ...(copy ? ["-c:a", "copy"] : []),
        ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", format, "/out.raw"]);
      const output = volume.readFileSync("/out.raw") as Buffer;
      const length = limit === undefined ? 6000 : Math.min(6000, limit * (sampleRate === 8000 ? 512 : 4096));
      assert.equal(output.length, length);
      if (length > 0) assert.equal(createHash("sha256").update(output).digest("hex"),
        golden[format][length as keyof typeof golden.alaw]);
    });
  }
}
