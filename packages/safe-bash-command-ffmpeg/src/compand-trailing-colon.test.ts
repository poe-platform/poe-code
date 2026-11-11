import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const options of ["gain=6", "0", "0:0.8:-70/-70|-60/-20|1/0:0.01:6:0:0"]) {
    it(`compand accepts a terminal colon after ${options} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], sample => sample / 32768)
      ] }));
      const outputs: Buffer[] = [];
      for (const suffix of ["", ":"]) {
        const filter = `compand=${options}${suffix}`;
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s32le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        outputs.push(Buffer.concat(stdout));
      }
      assert.equal(outputs[0]!.length, 32);
      assert.deepEqual(outputs[1], outputs[0]);
      if (options === "gain=6") {
        // FFmpeg 7.0.2 s32le output for the same eight PCM16 input samples.
        assert.equal(outputs[1]!.toString("hex"), "c2d21c00f7ef0bffd5f9c003319879e9ffffff7f00000080553889166d43c000");
      }
    });
  }

  for (const options of [":", "gain=6::", "gain=6::volume=0", "gain=6:decays=:"]) {
    it(`compand still rejects empty options in ${options} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `compand=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 234, stderr);
      assert.equal(Buffer.concat(stdout).length, 0);
      assert.ok(stderr.includes("compand: attacks and decays must have matching channel counts"), stderr);
    });
  }
}
