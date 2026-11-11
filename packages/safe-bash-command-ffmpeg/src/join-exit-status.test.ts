import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and complete PCM16 output.
for (const [options, exitCode] of [
  ["inputs=0", 222],
  ["inputs=-1", 222],
  ["inputs=2147483648", 222],
  ["inputs=x", 234],
  ["inputs=", 234],
  ["unknown=2", 8],
  ["enable=1", 176],
  ["enable=0", 176],
  ["inputs=2", 0]
] as const) {
  for (const output of ["pipe:1", "/out.raw"]) {
    it(`join=${options} returns native status and bytes to ${output}`, async () => {
      const inputs = [Buffer.from("0100fdff4701", "hex"), Buffer.from("4701fdff0100", "hex")];
      const volume = Volume.fromJSON({ "/a.raw": inputs[0]!, "/b.raw": inputs[1]!, "/out.raw": "KEEP" });
      const stdout: Buffer[] = [];
      let stderr = "";
      let writes = 0;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error",
          "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/a.raw",
          "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/b.raw",
          "-filter_complex", `[0:a][1:a]join=${options}[out]`, "-map", "[out]",
          "-f", "s16le", output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { writes++; volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode) {
        assert.ok(stderr.includes("join"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(writes, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.deepEqual(output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output),
          Buffer.from("01004701fdfffdff47010100", "hex"));
      }
      assert.deepEqual(volume.readFileSync("/a.raw"), inputs[0]);
      assert.deepEqual(volume.readFileSync("/b.raw"), inputs[1]);
    });
  }
}
