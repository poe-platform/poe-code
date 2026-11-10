import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, eleven PCM16 samples reframed into 3, 3, 3, 2 samples.
const digests = {
  framecrc: ["0x0a4f0285", "0x075b01d1", "0x0467011d", "0x02cf0159"],
  framemd5: ["f4a9e5429ccc07128a627ced487596dc", "6eb625578300d972259c432476e73d69",
    "5882016e3a19e5d86741bcedd38d67d1", "4f8572fe416ae7faacf327aee9c2eb92"],
  framehash: ["31017f7f9619e1ee2eb0c416251cd4fedcc43f5d709aafe0b959703f0115584c",
    "911dbf3e276b20c7ec23abba599bf2c7724ec103a55becfb586fa4d903beb034",
    "e4c99daaa1016c0e9746d3ffec785ba8ed382205eae4e7b2506485f071f6b22c",
    "3b0810f53d157043a30d33dd1184627726d331679433b743531c34f5e8947540"]
};

for (const [expression, timestamps] of [
  ["-PTS", [0, 0, 0, 0]],
  ["-3+PTS", [-3, 0, 3, 6]]
] as const) {
  for (const format of ["framecrc", "framemd5", "framehash", "s16le"] as const) {
    it(`${format} keeps sample order for asetpts=${expression}`, async () => {
      const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027f82a", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-af", `asetnsamples=n=3:p=0,asetpts=${expression}`, "-f", format, "/out"],
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
      const output = volume.readFileSync("/out") as Buffer;
      if (format === "s16le") {
        assert.deepEqual(output, input);
        return;
      }
      const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"));
      assert.deepEqual(rows, timestamps.map((pts, index) => {
        const duration = index === 3 ? 2 : 3;
        return `0, ${String(pts).padStart(10)}, ${String(pts).padStart(10)}, ${String(duration).padStart(8)}, ${String(duration * 2).padStart(8)}, ${digests[format][index]}`;
      }));
    });
  }
}
