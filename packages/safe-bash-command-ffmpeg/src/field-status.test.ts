import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses for a 2x2 gray frame.
for (const [option, exitCode] of [
  ["type=2", 222], ["type=unknown", 234], ["foo=1", 8], ["enable=1", 176], ["1", 0]
] as const) {
  for (const filterOption of ["-vf", "-filter_complex"]) {
    for (const target of ["pipe:1", "/out.raw"]) {
      it(`field=${option} returns native status through ${filterOption} to ${target}`, async () => {
        const input = Buffer.from("0d141b22", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-i", "/in.raw", filterOption, `field=${option},showinfo`,
            "-pix_fmt", "gray", "-f", "rawvideo", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        if (exitCode !== 0) {
          assert.ok(stderr.includes("field:"), stderr);
          assert.ok(!stderr.includes("[Parsed_showinfo"), stderr);
          assert.equal(Buffer.concat(output).length, 0);
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else {
          assert.ok(stderr.includes("s:2x1"), stderr);
          const expected = Buffer.from("1b22", "hex");
          if (target === "pipe:1") {
            assert.deepEqual(Buffer.concat(output), expected);
            assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
          } else {
            assert.deepEqual(volume.readFileSync(target), expected);
            assert.equal(Buffer.concat(output).length, 0);
          }
        }
      });
    }
  }
}
