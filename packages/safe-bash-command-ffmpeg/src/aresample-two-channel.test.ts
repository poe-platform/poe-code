import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("14ecc8e74feeffe88af036eac5f26deb00f5a4ec3bf7dbed76f912efb1fb49f0", "hex");
// Complete signed PCM16 output from native FFmpeg 7.0.2 at 44100 Hz.
const centerStereo = Buffer.from("eaf1eaf17ef37ef311f511f5a5f6a5f639f839f8cdf9cdf960fb60fbf4fcf4fc", "hex");

for (const filter of ["aresample=ochl=stereo", "aresample=out_chlayout=stereo", "aformat=channel_layouts=stereo"]) {
  for (const graph of [false, true]) {
    for (const [layout, expected] of [
      ["FC+LFE", centerStereo], ["downmix", input], ["stereo", input], ["FL+FC", undefined]
    ] as const) {
      it(`${filter} remixes ${layout} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "2", "-ch_layout", layout,
            "-i", "/in.raw", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[a]`, "-map", "[a]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (expected) {
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(Buffer.concat(stdout), expected);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.equal(Buffer.concat(stdout).length, 0);
          assert.ok(stderr.includes("unsupported input channel layout"), stderr);
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
