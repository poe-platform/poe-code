import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { image2Ast } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg preserves these RGB_ALPHA samples, including RGB under zero alpha.
const pixels = Buffer.from("2040600080c0107f050703ffadcdec21", "hex");
const input = Buffer.concat([
  Buffer.from("P7\nWIDTH 2\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
  pixels
]);

for (const [filename, inputArgs] of [
  ["/in.alpha.pam", []],
  ["/input", []],
  ["pipe:0", []],
  ["/in.alpha.pam", ["-f", "image2"]],
  ["/in%d.pam", []]
] as const) {
  for (const explicitPixelFormat of [false, true]) {
    it(`preserves PAM RGBA bytes from ${filename} ${inputArgs.join(" ")} (${explicitPixelFormat ? "explicit" : "default"} pixel format)`, async () => {
      const volume = Volume.fromJSON({ "/in.alpha.pam": input, "/input": input, "/in1.pam": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...inputArgs, "-i", filename, ...(explicitPixelFormat ? ["-pix_fmt", "rgba"] : []), "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(output), pixels);
    });
  }
}

it("reports PAM alpha in image2 metadata and rejects truncated rasters", () => {
  const plugin = image2Ast();
  assert.equal(plugin.detect(input), true);
  const track = plugin.parse(input).tracks[0]!;
  assert.equal(track.codecDescriptions[0]?.codecName, "pam");
  assert.equal(track.codecDescriptions[0]?.pixFmt, "rgba");
  assert.equal(track.width, 2);
  assert.equal(track.height, 2);
  assert.throws(() => plugin.parse(input.subarray(0, input.length - 1)), /Truncated PAM/);
});
