import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exact stdout from native FFmpeg 7.0.2 for these concatenated PGM packets.
for (const fixture of [
  { name: "changing width", input: "50350a3220310a3235350a112250350a3320310a3235350a334455", filters: [], output: "11223355" },
  { name: "explicit scale", input: "50350a3220310a3235350a112250350a3320310a3235350a334455", filters: ["-vf", "scale=2:1"], output: "11223355" },
  { name: "unchanged dimensions", input: "50350a3220310a3235350a112250350a3220310a3235350a3344", filters: [], output: "11223344" }
]) {
  for (const source of ["/in.pgm", "pipe:0"]) {
    it(`keeps rawvideo frame dimensions for ${fixture.name} from ${source}`, async () => {
      const input = Buffer.from(fixture.input, "hex");
      const volume = Volume.fromJSON({ "/in.pgm": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "image2pipe", "-i", source, ...fixture.filters,
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {
          for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
        })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), fixture.output);
    });
  }
}
