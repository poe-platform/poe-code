import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputHex = "14ecc8e74feeffe88af036eac5f26deb00f5a4ec3bf7dbed76f912efb1fb49f0";
// Native FFmpeg 7.0.2 applies layout rematrixing after pure channel mapping.
for (const [layout, filter, exitCode, outputHex] of [
  ["FC+LFE", "pan=stereo|c0=c0|c1=c1", 0, "eaf1eaf17ef37ef311f511f5a5f6a5f639f839f8cdf9cdf960fb60fbf4fcf4fc"],
  ["FL+FC", "pan=stereo|c0=c0|c1=c1", 234, ""],
  ["stereo", "pan=stereo|c0=c0|c1=c1", 0, inputHex],
  ["downmix", "pan=stereo|c0=c0|c1=c1", 0, inputHex],
  ["FC+LFE", "anull", 0, inputHex],
  ["FC+LFE", "pan=FC+LFE|c0=c0|c1=c1", 0, inputHex],
  ["FC+LFE", "pan=stereo|c0=c1|c1=c0", 0, "e0eee0eebcefbcef98f098f074f174f150f250f22cf32cf307f407f4e3f4e3f4"],
  ["FC+LFE", "pan=stereo|c1=c1", 0, "0000000000000000000000000000000000000000000000000000000000000000"],
  ["FC+LFE", "pan=stereo|FL=FC|FR=LFE", 0, "eaf1eaf17ef37ef311f511f5a5f6a5f639f839f8cdf9cdf960fb60fbf4fcf4fc"],
  ["FC+LFE", "pan=downmix|c0=c0|c1=c1", 0, "eaf1eaf17ef37ef311f511f5a5f6a5f639f839f8cdf9cdf960fb60fbf4fcf4fc"],
  ["FC+LFE", "pan=stereo|c0=0.5*c0|c1=0.5*c1", 0, "0af6e4f328f780f445f81bf563f9b7f580fa52f69efbeef6bbfc89f7d9fd25f8"],
  ["FL+FC", "pan=stereo|c0=0.5*c0|c1=0.5*c1", 0, "0af6e4f328f780f445f81bf563f9b7f580fa52f69efbeef6bbfc89f7d9fd25f8"],
  ["FL+FC", "pan=mono|c0=c0", 0, "14ec4fee8af0c5f200f53bf776f9b1fb"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches pan input layout ${layout}: ${filter} (graph=${complex})`, async () => {
      const input = Buffer.from(inputHex, "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "2", "-ch_layout", layout,
          "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(Buffer.concat(stdout), Buffer.from(outputHex, "hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
