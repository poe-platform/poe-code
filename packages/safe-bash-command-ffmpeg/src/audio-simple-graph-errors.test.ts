import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: mono PCM16 samples (i % 30000 - 15000) at 8 kHz.
for (const [graph, status, error] of [
  ["anull,anull", 0, ""],
  ["anull[linked];[linked]anull", 0, ""],
  ["asplit[main][sink];[sink]anullsink;[main]anull", 0, ""],
  ["notafilter", 8, "Unsupported audio filter: notafilter"],
  ["anull;anull", 234, "2 input(s) and 2 output(s)"],
  ["anull;notafilter", 8, "Unsupported audio filter: notafilter"],
  ["notafilter;anull", 8, "Unsupported audio filter: notafilter"],
  ["anull;anull,notafilter@missing", 8, "Unsupported audio filter: notafilter"],
  ["anull;anull;anull", 234, "3 input(s) and 3 output(s)"],
  ["anull[linked];[linked]asplit", 234, "1 input(s) and 2 output(s)"],
  ["anull[linked];[linked]anullsink", 234, "1 input(s) and 0 output(s)"],
  ["anull[linked];[linked]anull;anull", 234, "2 input(s) and 2 output(s)"]
] as const) {
  for (const output of ["pipe:1", "/out.pcm"]) {
    it(`validates simple audio graph ${graph} before writing ${output}`, async () => {
      const input = Buffer.alloc(8192 * 2);
      for (let i = 0; i < 8192; i++) input.writeInt16LE(i % 30000 - 15000, i * 2);
      const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "keep" });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
          "-af", graph, "-f", "s16le", output],
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
      assert.equal(result.exitCode, status, stderr);
      const written = output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output) as Buffer;
      if (status === 0) {
        assert.equal(stderr, "");
        assert.equal(written.length, input.length);
        assert.equal(createHash("sha256").update(written).digest("hex"),
          "6ac93a1df347c68afe4ca50c322575f34cba4e2ee066b992fdfea831894427a3");
      } else {
        assert.ok(stderr.includes(error), stderr);
        if (status === 234) assert.ok(stderr.includes("expected to have exactly 1 input and 1 output"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
      }
      assert.deepEqual(volume.readFileSync("/in.pcm"), input);
    });
  }
}
