import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 on Linux, mono PCM16LE at 8 kHz.
for (const [argument, status] of [
  ["0.49", 222], ["101", 222], ["notanumber", 234], ["1:enable=0", 176], ["1", 0]
] as const) {
  for (const named of [false, true]) {
    for (const graph of [false, true]) {
      const filter = `atempo=${named ? "tempo=" : ""}${argument}`;
      it(`${filter} preserves native status and output (${graph ? "graph" : "simple"})`, async () => {
        const fs = createMemoryFileSystem();
        const input = Buffer.alloc(4096 * 2);
        for (let i = 0; i < 4096; i++) input.writeInt16LE(((i % 32) - 16) * 800, i * 2);
        await fs.writeFile("/in.raw", input);
        await fs.writeFile("/out", Buffer.from("KEEP"));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
            "-f", "s16le", "/out"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        const output = Buffer.from(await fs.readFile("/out"));
        if (status === 0) {
          assert.equal(output.length, 4096 * 2);
          assert.equal(createHash("sha256").update(output).digest("hex"),
            "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e");
        } else {
          assert.equal(output.toString(), "KEEP");
        }
        assert.equal(result.exitCode, status, stderr);
      });
    }
  }
}
