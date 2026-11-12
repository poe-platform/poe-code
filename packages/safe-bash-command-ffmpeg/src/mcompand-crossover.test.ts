import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 references for 2048 deterministic mono samples.
for (const [filter, rate, hash] of [
  ["mcompand=args='0,0 6 -40/-40,0/0 4000'", 8000, null],
  ["mcompand=args='0,0 6 -40/-40,0/0 5000'", 8000, null],
  ["mcompand", 8000, null],
  ["mcompand=args='0,0 6 -40/-40,0/0 3000'", 8000, "a353c4c6f296b8a2853ca5d38c4878845a1bc3bc468caae5f9bd76ae71aac793"],
  ["mcompand", 48000, "3c9d69e48b03221c84997cff6b0705b4997d4de27ba42bec2a5d1f7c02722068"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} at ${rate} Hz matches native status and PCM (graph=${graph})`, async () => {
      const input = Buffer.alloc(4096);
      for (let i = 0; i < 2048; i++) input.writeInt16LE(i * 131 % 8191 - 4095, i * 2);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, hash === null ? 234 : 0, stderr);
      const output = Buffer.concat(chunks);
      if (hash === null) {
        assert.equal(output.length, 0);
        assert.ok(stderr.includes("crossover"), stderr);
      } else {
        assert.equal(stderr, "");
        assert.equal(output.length, 4096);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }
}
