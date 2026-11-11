import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight PCM16 frames at 44100 Hz, negotiated to stereo.
for (const [layout, exitCode, hex] of [
  ["FC+LFE", 0, "000000008fff8fff270027005a015a0135013501b801b801f200f200c601c601"],
  ["FL+FC", 234, ""],
  ["stereo", 0, "000000003eff60ff0e006400b8017e0246019d02b801ea03a300ca02f3013a04"],
  ["downmix", 0, "000000003eff60ff0e006400b8017e0246019d02b801ea03a300ca02f3013a04"]
] as const) {
  for (const complex of [false, true]) {
    it(`earwax negotiates ${layout} (${complex ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.raw", Buffer.from("14ecc8e74feeffe88af036eac5f26deb00f5a4ec3bf7dbed76f912efb1fb49f0", "hex"));
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "2", "-ch_layout", layout,
          "-i", "/in.raw", ...(complex ? ["-filter_complex", "[0:a]earwax[a]", "-map", "[a]"]
            : ["-af", "earwax"]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), hex);
    });
  }
}
