import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM outputs and exit statuses measured with native FFmpeg 7.0.2.
for (const [options, expected] of [
  ["size=3:algo=fast:", "987fd37e1d7b175d90fbe31cb87011ec98ba5a8da6850080"],
  ["size=3:", "ff7fff7fff7fff7fff7fff7fff7f73997399ff7f2a900080"],
  ["size=3:algo=fast::", null],
  ["size=3:algo=fast", "987fd37e1d7b175d90fbe31cb87011ec98ba5a8da6850080"],
  ["size=3", "ff7fff7fff7fff7fff7fff7fff7f73997399ff7f2a900080"],
] as const) {
  it(`axcorrelate=${options} matches native status and complete PCM`, async () => {
    const volume = new Volume();
    for (const [file, step] of [["/a.wav", 137], ["/b.wav", 193]] as const) {
      volume.writeFileSync(file, encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 12 }, (_, i) => ((i * step) % 1700 - 850) / 32768)
      ] }));
    }
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a][1:a]axcorrelate=${options}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"],
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
    assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), expected ?? "");
  });
}
