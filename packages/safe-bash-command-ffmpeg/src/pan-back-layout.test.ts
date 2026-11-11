import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputHex = "401f30f8a00fe02e80c1b80b0000d8dc";
// Native FFmpeg rejects back-only stereo rematrixing, but accepts mono selection.
for (const [layout, filter, exitCode, outputHex] of [
  ["FL+FR", "pan=stereo|c0=FL|c1=FR", 0, inputHex],
  ["FR+FL", "pan=stereo|c0=FL|c1=FR", 234, ""],
  ["FC+LFE", "pan=stereo|c0=FL|c1=FR", 0, "00000000000000000000000000000000"],
  ["BL+BR", "pan=stereo|c0=FL|c1=FR", 234, ""],
  ["BL+BR", "pan=stereo|c0=c0|c1=c1", 234, ""],
  ["BL+BR", "pan=mono|c0=c1", 0, "30f8e02eb80bd8dc"],
  ["BL+BR", "pan=BL+BR|c0=c0|c1=c1", 0, inputHex],
  ["BL+BR", "pan=stereo|c0=0.5*c0|c1=0.5*c1", 0, "a00f18fcd0077017c0e0dc0500006cee"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches pan input layout ${layout}: ${filter} (graph=${complex})`, async () => {
      const input = Buffer.from(inputHex, "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "16000", "-ac", "2",
          "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]channelmap=0|1:${layout},${filter}[s]`, "-map", "[s]"] : ["-af", `channelmap=0|1:${layout},${filter}`]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(outputHex, "hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
