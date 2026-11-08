import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const channels of [0, 1]) for (const copy of [false, true]) for (const pipe of [false, true]) {
  it(`${copy ? "copies" : "decodes"} WAV with ${channels} declared channels from ${pipe ? "pipe" : "file"}`, async () => {
    const input = Buffer.alloc(48);
    input.write("RIFF"); input.writeUInt32LE(40, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(channels, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000 * channels, 28);
    input.writeUInt16LE(2 * channels, 32); input.writeUInt16LE(16, 34);
    input.write("data", 36); input.writeUInt32LE(4, 40);
    input.writeInt16LE(100, 44); input.writeInt16LE(200, 46);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", copy ? "copy" : "pcm_s16le", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { if (pipe) yield input; })(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (!channels && !copy) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /channel layout/);
      assert.equal(volume.existsSync("/out.raw"), false);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(44));
    }
  });
}
