import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2, stereo PCM16 at 8000 Hz.
for (const [option, exitCode] of [
  ["badkey=1", 8],
  ["phase=361", 222],
  ["level_in=0", 222],
  ["level_out=65", 222],
  ["mlev=0", 222],
  ["slev=65", 222],
  ["sclevel=101", 222],
  ["balance_in=-2", 222],
  ["balance_out=2", 222],
  ["mpan=2", 222],
  ["sbal=-2", 222],
  ["bmode_in=3", 222],
  ["bmode_out=-1", 222],
  ["mode=11", 222],
  ["base=2", 222],
  ["delay=21", 222],
  ["mode=bad", 234],
  ["muter=2", 234],
  ["phase=360", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves native stereotools status (${graph ? "graph" : "simple"}): ${option}`, async () => {
      const input = Buffer.alloc(64);
      for (let i = 0; i < 32; i++) {
        input.writeInt16LE(i % 2 === 0 ? 1000 + i * 231 : -300 - i * 111, i * 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const filter = `stereotools=${option}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      assert.deepEqual(Buffer.concat(output), exitCode === 0 ? input : Buffer.alloc(0));
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode !== 0) assert.ok(stderr.includes("stereotools"), stderr);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
