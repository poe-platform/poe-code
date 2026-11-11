import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exit statuses and raw PCM16 stdout.
for (const [filter, exitCode, hex] of [
  ["adeclick=w=5", 222, ""],
  ["adeclip=n=99", 222, ""],
  ["adeclip=w=nope", 234, ""],
  ["adeclick=bad=1", 8, ""],
  ["adeclick=w=55", 0, "fefffdff1101fcff"],
  ["adeclip=n=100", 0, "fefffdff1101fcff"]
] as const) {
  for (const graph of [false, true]) it(`matches native status and stdout: ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)] }));
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
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
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    assert.equal(result.exitCode, exitCode, Buffer.concat(stderr).toString());
  });
}
