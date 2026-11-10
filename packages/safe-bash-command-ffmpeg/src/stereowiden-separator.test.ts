import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [options, valid] of [
    ["delay=1", true],
    ["delay=1:", true],
    ["1:0.3:0.3:0.8", true],
    ["1:0.3:0.3:0.8:", true],
    ["delay=1::", false],
    ["1:0.3:0.3:0.8::", false],
    ["delay=1::feedback=0.3", false],
    ["1::0.3:0.8", false]
  ] as const) {
    it(`stereowiden=${options} preserves separator semantics (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(288);
      for (let i = 0; i < 72; i++) {
        input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
        input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=n=8:p=0,stereowiden=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 288);
        // Native FFmpeg 7.0.2 output for both named and positional forms.
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a");
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
    });
  }
}
