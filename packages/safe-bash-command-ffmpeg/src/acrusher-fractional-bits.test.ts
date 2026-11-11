import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static Linux x86_64; 64 stereo PCM16 frames at 1000 Hz.
for (const [bits, aa, mix, format, expected] of [
  [2, 0, 0, "f64le", "850b76b36f7a4ff1b9f1beaaf25cef3f63b17b07ca91b92b222e3eb0144f1152"],
  [2.5, 0, 0, "f64le", "74b6e20595e7c8b80cee67a2d768d0d61b0821c227d92a6c75d5f498514e86a7"],
  [3.5, 0, 0, "f64le", "052d9146a2980e6fe0da494d733179efc60df7962ba156b9bad5de017126d266"],
  [2.5, 0, 0, "s16le", "06814a0d2fa92e47b5fbe744b1a712353602ecd6c7e78ab3c819643243a21d2a"],
  [2.25, 0, 0, "f64le", "19a5671f362ac3d7ccc62207ee0a1b19f9995fddf783f09076afad4f13b3b75e"],
  [2.75, 0, 0, "f64le", "44aec857e3d82f42a974cfed8f37f0b22bbda35e901ebd631eb051b4a655667e"],
  [5.1, 0, 0, "f64le", "74671e9c6bb84f4c148793d3e864c50cb6b45a86b79ac332133f51f5954c387b"],
  [8.2, 0, 0, "f64le", "ffd419ec9348ba23078c8566fbf8e5aa2b8077a0880af9b567edbb039425d3d1"],
  [2.5, 0.5, 0.25, "f64le", "7efefb5e024f35735836bda9265f8236dae3c256437ae3b07d456d88a284a088"]
] as const) for (const graph of [false, true]) for (const commanded of [false, true]) {
  const filter = (commanded ? `asendcmd=c='0 acrusher bits ${bits}',` : "")
    + `acrusher=bits=${commanded ? 2 : bits}:mix=${mix}:mode=lin:aa=${aa}:dc=1.2`;
  it(`matches native ${filter} to ${format} through ${graph ? "filter_complex" : "af"}`, async () => {
    const input = Buffer.alloc(64 * 4);
    for (let i = 0; i < 64; i++) {
      input.writeInt16LE(i * 1667 % 60001 - 30000, i * 4);
      input.writeInt16LE(25000 - i * 2345 % 50001, i * 4 + 2);
    }
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const chunks: Buffer[] = [];
    let stderr = "";
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
    const stdout = Buffer.concat(chunks);
    assert.equal(stdout.length, 64 * 2 * (format === "f64le" ? 8 : 2));
    assert.equal(createHash("sha256").update(stdout).digest("hex"), expected);
  });
}
