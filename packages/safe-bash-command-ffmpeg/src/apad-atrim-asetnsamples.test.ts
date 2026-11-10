import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 retains the ten input samples followed by four silent samples.
const input = Buffer.alloc(20);
for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
const expected = Buffer.alloc(28);
input.copy(expected);

for (const graph of [false, true]) {
  for (const [padding, trim] of [
    ["", "duration=0.014"],
    ["", "end=0.014"],
    ["", "end_pts=14"],
    ["", "end_sample=14"],
    [":pad_len=12", "duration=0.014"]
  ]) {
    it(`apad${padding} honors ${trim} through asetnsamples (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `asetnsamples=n=3:p=0,apad=packet_size=2${padding},asetnsamples=n=3:p=0,atrim=${trim}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(Buffer.concat(output), expected);
    });
  }
}
