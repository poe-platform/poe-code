import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 rejects compand timelines before opening the output.
for (const [option, exitCode] of [["enable=1", 176], ["enable=0", 176], ["unknown_opt=1", 8]] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`compand ${option} (${graph ? "graph" : "simple"}) to ${output} returns ${exitCode} without output`, async () => {
        const input = Buffer.from(encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], sample => sample / 32768)] }));
        const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "keep" });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const filter = `compand=${option}`;
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s32le", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, Buffer.concat(stderr).toString());
        assert.ok(Buffer.concat(stderr).toString().includes("compand"));
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
        assert.deepEqual(fs.readFileSync("/in.wav"), input);
      });
    }
  }
}
