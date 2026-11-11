import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 evaluates each scheduling expression with fresh registers.
const cases: [string, number][] = [
  ["threads=2", 0],
  ["threads=0", 0],
  ["threads=st(0\\,1)+ld(0)", 0],
  ["threads=ld(0)", 0],
  ["extra_hw_frames=st(0\\,2)", 0],
  ["thread_type=ld(0)", 0],
  ["thread_type=st(0\\,1)", 0],
  ["threads=st(0\\,1)-2*ld(0)", 222],
  ["threads=st(0\\,-1)-ld(0)", 0],
  ["threads=st(0\\,-2)-ld(0):extra_hw_frames=ld(0)", 0],
  ["extra_hw_frames=st(0\\,-2)", 222],
  ["threads=unknown", 234],
  ["thread_type=unknown", 234],
  ["extra_hw_frames=unknown", 234]
];

for (const graph of [false, true]) {
  for (const [options, exitCode] of cases) {
    it(`evaluates areverse ${options} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(26);
      const expected = Buffer.alloc(26);
      for (let i = 0; i < 13; i++) {
        input.writeInt16LE(i + 1, i * 2);
        expected.writeInt16LE(13 - i, i * 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `${graph ? "areverse@flip" : "areverse"}=${options}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(Buffer.concat(stdout), exitCode === 0 ? expected : Buffer.alloc(0));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
