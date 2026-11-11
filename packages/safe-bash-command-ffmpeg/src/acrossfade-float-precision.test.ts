import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 rounds float32 transitions before widening for float64 output.
for (const [input, output, expected] of [
  ["f32", "f64le", "00000080499cb93f000000409be3cabf00000000479ac93f000000e05aa1d13f00000000479ac93f000000409be3cabf00000080499cb93f"],
  ["f32", "f32le", "4ce2cc3dda1c57be38d24c3ed70a8d3e38d24c3eda1c57be4ce2cc3d"],
  ["f64", "f64le", "bd564277499cb93f1c446b459be3cabff1c0edf6469ac93fb28d65e75aa1d13ff1c0edf6469ac93f1c446b459be3cabfbd564277499cb93f"]
] as const) {
  for (const endian of ["le", "be"]) {
    it(`acrossfade preserves ${input}${endian} precision when exporting ${output}`, async () => {
      const volume = Volume.fromJSON({});
      const first = Buffer.from(input === "f32"
        ? "4ce2cc3dda1c57beaa9d993e4390d33e45f007bf"
        : "bd564277499cb93f1c446b459be3cabfb5503239b533d33f8b54185b0872da3fae2afbae08fee0bf", "hex");
      const bytesPerSample = input === "f32" ? 4 : 8;
      if (endian === "be") {
        if (input === "f32") first.swap32();
        else first.swap64();
      }
      const second = Buffer.concat(Array.from({ length: 5 }, (_, index) =>
        first.subarray((4 - index) * bytesPerSample, (5 - index) * bytesPerSample)));
      volume.writeFileSync("/0.pcm", first);
      volume.writeFileSync("/1.pcm", second);
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", input + endian, "-ar", "8000", "-ac", "1", "-i", "/0.pcm",
          "-f", input + endian, "-ar", "8000", "-ac", "1", "-i", "/1.pcm",
          "-filter_complex", "[0:a][1:a]acrossfade=ns=3:o=1:c1=tri:c2=tri[o]",
          "-map", "[o]", "-f", output, "pipe:1"],
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
