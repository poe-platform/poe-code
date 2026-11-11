import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference: 1 kHz PCM16, four-sample frames.
const samples = [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0];
for (const complex of [false, true]) {
  for (const target of ["silenceremove", "silenceremove@s"]) {
    it(`silenceremove continues after a non-runtime command (complex=${complex}, target=${target})`, async () => {
      const outputs: number[][] = [];
      for (const commands of [
        "",
        `0.004 ${target} stop_duration 0.002`,
        `0.008 ${target} stop_threshold 1`,
        `0.004 ${target} stop_duration 0.002;0.008 ${target} stop_threshold 1`
      ]) {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
          sampleRate: 1000, channels: [Float64Array.from(samples, sample => sample / 32768)]
        }, { bitsPerSample: 16 })) });
        const filter = `asetnsamples=4:0,${commands ? `asendcmd=c='${commands}',` : ""}${target}=window=0:stop_periods=-1`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, `${commands}: ${stderr}`);
        assert.equal(stderr, "");
        const output = Buffer.concat(chunks);
        outputs.push(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)));
      }
      assert.deepEqual(outputs[0], [0, 0, 100, 200, 300, 400, 500, 600, 700, 800]);
      assert.deepEqual(outputs[1], outputs[0]);
      assert.deepEqual(outputs[2], [0, 0, 100, 200, 300]);
      assert.deepEqual(outputs[3], outputs[2]);
    });
  }
}
