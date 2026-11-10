import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7 emits four six-sample frames: the ten input samples and 14 zeros.
const input = Buffer.alloc(20);
for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);

for (const graph of [false, true]) {
  for (const middle of [
    "apad=packet_size=2",
    "apad=packet_size=2,anull",
    "apad=packet_size=2:pad_len=64,anull",
    "apad@pad=2,anull@pass,acopy,volume=1,anull"
  ]) {
    it(`accounts for downstream frame size across ${middle} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=3:p=0,${middle},asetnsamples=n=6:p=0`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-frames:a", "4", "-f", "s16le", "-"],
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
      const expected = Buffer.alloc(48);
      input.copy(expected);
      assert.deepEqual(Buffer.concat(stdout), expected);
    });
  }
}
