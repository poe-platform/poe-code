import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(72 * 4);
for (let i = 0; i < 72; i++) {
  input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
  input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
}

for (const graph of [false, true]) {
  for (const [command, expectedStatus] of [
    ["", 0],
    ["0.003 stereowiden@w bad 0", 0],
    ["0.003 stereowiden@w delay 0", 0],
    ["0.003 stereowiden bad 0", 0],
    ["0.003 stereowiden delay 0", 0],
    ["0.003 stereowiden@w feedback 0.3", 0],
    ["0.003 stereowiden@other feedback 0", 0],
    ["0 stereowiden@w feedback 0.3;0.003 stereowiden@w bad 0;0.004 stereowiden@w delay 0", 0],
    ["invalid stereowiden@w bad 0", 1],
    ["-1 stereowiden@w bad 0", 1],
    ["0 stereowiden@w", 1],
    ["0 stereowiden@w bad 0 extra", 1],
    ["0 [leave] stereowiden@w bad 0", 1]
  ] as const) {
    it(`${expectedStatus ? "rejects malformed schedule" : "retains native PCM after"} ${command || "no command"} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      const filter = `asetnsamples=n=8:p=0,${command ? `asendcmd=c='${command}',` : ""}stereowiden@w=delay=1`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, expectedStatus, stderr);
      const output = fs.readFileSync("/out");
      if (expectedStatus !== 0) {
        assert.equal(output.toString(), "KEEP");
        return;
      }
      assert.equal(output.length, 288);
      // Native FFmpeg 7.0.2: rejected runtime commands leave all PCM bytes unchanged.
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a");
    });
  }
}
