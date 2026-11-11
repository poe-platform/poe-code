import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static Linux x86_64, 64 stereo PCM16 frames at 1000 Hz.
for (const [mode, format, expected] of [
  ["lin", "f64le", "404a1d4be01164f26235e6a20a00f5a6c27437d99dbc70033ca27a71dd59824c"],
  ["log", "f64le", "9d4322872eabd4fb0cdb49c1217098c67e3b5cae5eb7b5f90052593c85aab924"],
  ["log", "s16le", "64e1692756cfc233a8a6a3d9ac162b8aaa0844ee8887b21343b7b890c7e93ccf"]
] as const) for (const graph of [false, true]) {
  it(`matches native ${mode} antialias blending to ${format} through ${graph ? "filter_complex" : "af"}`, async () => {
    const input = Buffer.alloc(64 * 4);
    for (let i = 0; i < 64; i++) {
      input.writeInt16LE(i * 1667 % 60001 - 30000, i * 4);
      input.writeInt16LE(25000 - i * 2345 % 50001, i * 4 + 2);
    }
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const chunks: Buffer[] = [];
    let stderr = "";
    const filter = `acrusher=bits=8:mix=0:mode=${mode}:aa=0.9:dc=1.2`;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const output = Buffer.concat(chunks);
    assert.equal(output.length, 128 * (format === "f64le" ? 8 : 2));
    assert.equal(createHash("sha256").update(output).digest("hex"), expected);
  });
}
