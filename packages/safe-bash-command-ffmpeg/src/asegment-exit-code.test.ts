import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses for the same PCM input and filter graphs.
for (const [options, exitCode, samples] of [
  ["samples=oops", 234, []],
  ["samples=5:bogus=1", 8, []],
  ["samples=4:enable=1", 176, []],
  ["samples=4", 0, [1, 2, 3, 4]]
] as const) {
  it(`returns native status ${exitCode} for asegment=${options}`, async () => {
    const input = Buffer.alloc(16 * 2);
    for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
    const volume = Volume.fromJSON({});
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
        "-i", "pipe:0", "-filter_complex",
        `[0:a]asegment=${options}[b0][b1];[b1]anullsink;[b0]anull[out]`,
        "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    const expected = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
    assert.deepEqual(Buffer.concat(chunks), expected);
    if (exitCode === 0) assert.equal(stderr, "");
  });
}
