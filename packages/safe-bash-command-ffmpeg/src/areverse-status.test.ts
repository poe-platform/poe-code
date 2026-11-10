import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 on Linux, with a two-sample tail after three-sample frames.
for (const [filter, status] of [
  ["areverse=unknown=1", 8],
  ["areverse@rev=bad", 234],
  ["areverse=enable=1", 176],
  ["areverse=threads=-1", 222],
  ["areverse=threads=2147483648", 222],
  ["areverse=threads=bad", 234],
  ["areverse=", 0],
  ["asetnsamples=n=3:p=0,areverse", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native status and output (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      await fs.writeFile("/in.raw", input);
      await fs.writeFile("/out", Buffer.from("KEEP"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[rev]`, "-map", "[rev]"] : ["-af", filter]),
          "-f", "s16le", "/out"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(Buffer.from(await fs.readFile("/out")).toString("hex"),
        status === 0 ? "f82a10272823401f581b70178813a00fb80bd007e803" : "4b454550");
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
