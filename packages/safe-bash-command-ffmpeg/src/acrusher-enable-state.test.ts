import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 64 stereo PCM16 samples at 1000 Hz, four samples per frame.
for (const [options, expected] of [
  ["samples=1:enable='mod(n,2)'", "06343fa945371c3ee8fb58c7ac5ea9f549b64e14327d9a60408246e938509fb1"],
  ["samples=2.5:enable=1", "3b80749f598994b66c08cb8cba7b670f3a675e433ba08ad64a150064e23dc259"],
  ["samples=2.5:enable=0", "dd24a9f67d0d3f27d5ce1696efec46d2072e0109b6be2bd32f792a82f34fb70f"],
  ["samples=2.5:enable='mod(n,2)'", "ec98a3657a3a25c698ce8e734ff41c0e0f1b7c3becd2cd1b4936a5f68d6aebd9"],
  ["samples=2:enable='not(eq(n,1))'", "5f1e79387e02bc17192013edca18033a93fcb58e60a6cb5d8d16dbd849532f51"]
] as const) for (const graph of [false, true]) {
  it(`matches native acrusher state for ${options} (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(64 * 4);
    for (let i = 0; i < 64; i++) {
      input.writeInt16LE(i * 1667 % 60001 - 30000, i * 4);
      input.writeInt16LE(25000 - i * 2345 % 50001, i * 4 + 2);
    }
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const filter = `asetnsamples=n=4:p=0,acrusher=bits=4:mix=0.8:${options}`;
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
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
    const stdout = Buffer.concat(chunks);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, input.length);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), expected);
  });
}
