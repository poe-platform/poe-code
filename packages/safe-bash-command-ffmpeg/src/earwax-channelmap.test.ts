import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: four PCM16 frames at 44100 Hz after channelmap.
for (const [layout, exitCode, hex] of [
  ["FL+FR", 0, "00000000c1fffa003e00cb0011fde3fc"],
  ["FR+FL", 234, ""],
  ["FC+LFE", 0, "00000000b000b0007bff7bff49fc49fc"],
  ["BL+BR", 234, ""]
] as const) {
  for (const complex of [false, true]) {
    it(`earwax negotiates channelmap ${layout} (${complex ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.raw", Buffer.from("401f30f8a00fe02e80c1b80b0000d8dc", "hex"));
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "2",
          "-i", "/in.raw", ...(complex ? ["-filter_complex", `[0:a]channelmap=0|1:${layout},earwax[a]`, "-map", "[a]"]
            : ["-af", `channelmap=0|1:${layout},earwax`]), "-f", "s16le", "pipe:1"],
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
