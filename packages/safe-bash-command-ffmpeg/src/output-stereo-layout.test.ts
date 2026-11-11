import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");
// Native FFmpeg 7.0.2 output, including mono-to-stereo gain and PCM16 rounding.
const stereo = Buffer.from("7afa7afa90fa90faa6faa6fabcfabcfad1fad1fae7fae7fafdfafdfa13fb13fb29fb29fb3ffb3ffb55fb55fb6bfb6bfb", "hex");

for (const option of ["-ch_layout", "-channel_layout", "-ac"]) {
  for (const layout of ["mono", "stereo"]) {
    it(`matches native PCM bytes for output ${option} ${layout}`, async () => {
      const volume = Volume.fromJSON({});
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0",
          option, option === "-ac" ? (layout === "mono" ? "1" : "2") : layout, "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(stdout), layout === "mono" ? input : stereo);
    });
  }
}
