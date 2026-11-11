import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 Linux statuses and PCM16 bytes for two stereo frames.
for (const [expression, status, output] of [
  ["stereo_downmix|c0=c1", 234, ""],
  ["nonesuch|c0=c1", 234, ""],
  ["ambisonic -1|c0=c1", 234, ""],
  ["mono|c0=c0|c0=c1", 234, ""],
  ["downmix|c0=c1", 0, "0cfe000009030000"]
] as const) {
  for (const complex of [false, true]) {
    it(`returns native pan layout status and stdout (graph=${complex}): ${expression}`, async () => {
      const input = Buffer.from("e8030cfe4d010903", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `pan=${expression}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(Buffer.concat(stdout), Buffer.from(output, "hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
