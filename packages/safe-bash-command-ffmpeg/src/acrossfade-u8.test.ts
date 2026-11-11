import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: u8 is not a supported acrossfade processing format.
for (const [first, second, output, expected] of [
  ["u8", "u8", "s16le", "0004001356fb552f56fb00130004"],
  ["u8", "u8", "s32le", "0000000400000013565555fb5555552f565555fb0000001300000004"],
  ["u8", "u8", "f32le", "0000003d0000183e555515bd5555bd3e555515bd0000183e0000003d"],
  ["u8", "u8", "u8", "84937baf7b9384"],
  ["u8", "u8", "f64le", "000000000000a03f000000000000c33faaaaaaaaaaaaa2bfaaaaaaaaaaaad73faaaaaaaaaaaaa2bf000000000000c33f000000000000a03f"],
  ["s16le", "s16le", "s16le", "810001011bab0b1a1bab01018100"],
  ["u8", "s16le", "s16le", "0004001356fbb0241bab01018100"],
  ["u8", "s32le", "s16le", "0004001355fbf71887fe2e012c01"]
] as const) {
  for (const simple of first === "u8" && second === "u8" ? [false, true] : [false]) {
    it(`acrossfade negotiates ${first}/${second} for ${output} output (${simple ? "simple" : "complex"} graph)`, async () => {
      const volume = Volume.fromJSON({});
      for (const [path, hex] of [
        ["/0.s16le", "81000101a88011276b42"],
        ["/0.u8", "849379c7e6"],
        ["/1.s16le", "6b421127a88001018100"],
        ["/1.s32le", "7d6ee7038f6ee703b9a4cbfd27d22e0128812c01"],
        ["/1.u8", "e6c7799384"]
      ] as const) volume.writeFileSync(path, Buffer.from(hex, "hex"));
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", first, "-ar", "8000", "-ac", "1", "-i", `/0.${first}`,
          ...simple ? ["-af", "asplit[a][b];[b]areverse[r];[a][r]acrossfade=ns=3:o=1:c1=tri:c2=tri"]
            : ["-f", second, "-ar", "8000", "-ac", "1", "-i", `/1.${second}`,
              "-filter_complex", "[0:a][1:a]acrossfade=ns=3:o=1:c1=tri:c2=tri[o]", "-map", "[o]"],
          "-f", output, "pipe:1"],
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
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
