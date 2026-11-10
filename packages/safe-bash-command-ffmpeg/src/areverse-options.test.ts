import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const filter of [
    "areverse", "areverse=",
    "asetnsamples=n=3:p=0,areverse@flip", "asetnsamples=n=3:p=0,areverse@flip=",
    "areverse=unknown=1", "areverse@flip=unknown=1"
  ]) {
    it(`handles ${filter} options (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
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
      const invalid = filter.includes("unknown=");
      assert.equal(result.exitCode, invalid ? 1 : 0, stderr);
      // Native FFmpeg 7.0.2 reverses all ten samples, including the short final frame.
      assert.equal(Buffer.concat(stdout).toString("hex"), invalid ? "" : "10272823401f581b70178813a00fb80bd007e803");
      if (invalid) assert.ok(stderr.includes("Unsupported audio filter: areverse=unknown=1"), stderr);
      assert.equal(volume.readFileSync("/tags", "utf8"), "KEEP");
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
