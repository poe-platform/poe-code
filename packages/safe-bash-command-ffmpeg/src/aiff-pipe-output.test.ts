import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const target of ["-", "pipe:", "pipe:1", "/out.aiff"]) {
  it(`writes native AIFF header sizes for ${target} with bytewise stdin`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "pipe:0", "-f", "aiff", target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { for (const byte of [1, 2, 252, 255]) yield Uint8Array.of(byte); })(),
      stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    // Native FFmpeg PCM16 stereo AIFF, including its unchanged big-endian payload.
    const expected = Buffer.from("464f524d0000000041494646434f4d4d000000120002000000000010400bfa0000000000000053534e440000000000000000000000000201fffc", "hex");
    if (target === "/out.aiff") {
      expected.writeUInt32BE(50, 4);
      expected.writeUInt32BE(1, 22);
      expected.writeUInt32BE(12, 42);
    }
    assert.deepEqual(target === "/out.aiff" ? volume.readFileSync(target) : Buffer.concat(stdout), expected);
  });
}
