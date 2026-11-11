import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for the reported G.711 input bytes.
for (const [law, format, expected] of [
  ["alaw", "u8", "6a6b65757e7f7c9594fe808383"],
  ["mulaw", "u8", "02063e41787d80fdf994828080"],
  ["alaw", "s8", "eaebe5f5fefffc15147e000303"],
  ["mulaw", "s16le", "8482848684be84c1a4f834fd00007c7d7c79fc14cc0208000000"]
] as const) {
  it(`converts piped ${law} to ${format} with native PCM quantization`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", law, "-ar", "8000", "-ac", "1", "-i", "pipe:0", "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield Buffer.from("00010f1040557f8081aad5feff", "hex"); })(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
