import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputHex = "e803401f30f8a00f102790e8d8dc18fc";
// Native FFmpeg remixes pure stereo routing to center and silent LFE.
for (const [layout, filter, exitCode, outputHex, format = "s16le", sourceHex = inputHex] of [
  ["stereo", "pan=FC+LFE|c0=c1|c1=c0", 0, "94110000e8030000d007000078ec0000"],
  ["stereo", "pan=FC+LFE|c0=c0|c1=c1", 0, "94110000e8030000d007000078ec0000"],
  ["stereo", "pan=FC+LFE|c0=c1", 0, "a00f0000d007000048f400000cfe0000"],
  ["stereo", "pan=FC+LFE|c0=c0|c1=c0", 0, "e803000030f8000010270000d8dc0000"],
  ["stereo", "pan=FC+LFE|c0=0.5*c1|c1=c0", 0, "a00fe803d00730f848f410270cfed8dc"],
  ["stereo", "pan=stereo|c0=c1|c1=c0", 0, "401fe803a00f30f890e8102718fcd8dc"],
  ["stereo", "channelmap=0|1:channel_layout=FC+LFE,pan=stereo|c0=c1|c1=c0", 0, "191619160c0b0c0b6def6def3dfd3dfd"],
  ["stereo", "pan=FC+LFE|c0=c1|c1=c0", 0, "dbea223f00000000c2d0103e00000000c2d0903e00000000f20435bf00000000", "f32le", "cdcccc3dcdcc4c3fcdcc4cbecdcccc3e0000803f9a9919bf666666bfcdccccbd"],
  ["stereo", "pan=FC+LFE|c0=c1|c1=c0", 0, "6c4f3f5c5b5de43f00000000000000000a63ff51181ac23f00000000000000000b63ff51181ad23f0000000000000000cd3b7f669ea0e6bf0000000000000000", "f64le", "9a9999999999b93f9a9999999999e93f9a9999999999c9bf9a9999999999d93f000000000000f03f333333333333e3bfcdccccccccccecbf9a9999999999b9bf"]
] as const) {
  for (const complex of [false, true]) {
    it(`remixes pan output layout ${layout}: ${filter} (graph=${complex})`, async () => {
      const input = Buffer.from(sourceHex, "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", format, "-ar", "44100", "-ac", "2", "-ch_layout", layout,
          "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", format, "pipe:1"],
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
      assert.equal(stderr, "");
      const actual = Buffer.concat(stdout);
      const expected = Buffer.from(outputHex, "hex");
      assert.equal(actual.length, expected.length);
      if (format === "s16le") assert.deepEqual(actual, expected);
      else {
        // Native floating-point SIMD can differ by one ULP from scalar arithmetic.
        const width = format === "f32le" ? 4 : 8;
        for (let offset = 0; offset < expected.length; offset += width) {
          const value = width === 4 ? actual.readFloatLE(offset) : actual.readDoubleLE(offset);
          const reference = width === 4 ? expected.readFloatLE(offset) : expected.readDoubleLE(offset);
          if (reference === 0) assert.equal(value, 0);
          else assert.ok(Math.abs(value - reference) <= (width === 4 ? 1e-7 : 1e-15));
        }
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
