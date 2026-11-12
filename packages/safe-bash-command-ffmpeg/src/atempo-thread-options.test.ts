import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 700 mono PCM16LE samples at 8 kHz.
const cases: [string, number][] = [
  ["1", 0],
  ["1:threads=1", 0],
  ["1:thread_type=slice", 0],
  ["tempo=1:threads=1:thread_type=slice", 0],
  ["threads=0:thread_type=none", 0],
  ["threads=default:thread_type=default:tempo=1", 0],
  ["1:threads=1+1:thread_type=+slice-slice", 0],
  ["1:threads=-1", 222],
  ["1:threads=2147483648", 222],
  ["1:threads=bogus", 234],
  ["1:threads=", 234],
  ["1:threads=bogus:threads=1", 234],
  ["1:thread_type=0.5", 222],
  ["1:thread_type=4294967296", 222],
  ["1:thread_type=bogus", 234],
  ["1:thread_type=", 234],
  ["1:threads=1:unknown=1", 8]
];

for (const graph of [false, true]) {
  for (const [options, status] of cases) {
    it(`atempo=${options} preserves native status and PCM (graph=${graph})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(700 * 2);
      for (let i = 0; i < 700; i++) input.writeInt16LE(i * 701 % 30001 - 15000, i * 2);
      await fs.writeFile("/in.raw", input);
      await fs.writeFile("/out.raw", Buffer.from("KEEP"));
      const filter = `atempo=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
      const output = Buffer.from(await fs.readFile("/out.raw"));
      if (status === 0) {
        assert.equal(output.length, 700 * 2);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "e208502386bc6c7aa6ec54379c1cc39ba0c50b3ecef842ded8c1f3fc1ebf8471");
      } else {
        assert.equal(output.toString(), "KEEP");
      }
    });
  }
}
