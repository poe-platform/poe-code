import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 8000, -2000, 4000, 10000, -6000, -9000, -1000];
// Native FFmpeg 7.0.2 accepts reordered inputs for weighted mixing, but rejects pure routing.
for (const layout of ["FR+FL", "BC+LFE", "stereo"]) {
  for (const weighted of [false, true]) {
    for (const complex of [false, true]) {
      for (const target of ["pipe:1", "/out.pcm"]) {
        it(`handles reordered pan input ${layout} (weighted=${weighted}, graph=${complex}, target=${target})`, async () => {
          const input = Buffer.alloc(samples.length * 2);
          samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
          const volume = Volume.fromJSON({ "/in.pcm": input });
          const filter = `channelmap=0|1:channel_layout=${layout},pan=stereo|c0=${weighted ? "0.5*" : ""}c1|c1=c0`;
          const stdout: Uint8Array[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.pcm",
              ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
              "-f", "s16le", target],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          const rejected = !weighted && layout !== "stereo";
          assert.equal(result.exitCode, rejected ? 234 : 0, stderr);
          const output = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
            rejected ? [] : weighted
              ? [4000, 1000, 2000, -2000, -3000, 10000, -500, -9000]
              : [8000, 1000, 4000, -2000, -6000, 10000, -1000, -9000]);
          if (rejected) assert.ok(stderr.includes("pan: unsupported input channel layout"), stderr);
          else assert.equal(stderr, "");
          assert.deepEqual(volume.readFileSync("/in.pcm"), input);
        });
      }
    }
  }
}
