import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

for (const bits of [0, 16]) for (const pipe of [false, true]) {
  it(`${bits ? "accepts valid" : "rejects unknown-depth"} WAV input before output (${pipe ? "pipe" : "file"})`, async () => {
    const input = Buffer.alloc(52);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
    input.writeUInt16LE(2, 32); input.writeUInt16LE(bits, 34);
    input.write("data", 36); input.writeUInt32LE(8, 40);
    [100, 200, 300, 400].forEach((value, index) => input.writeInt16LE(value, 44 + index * 2));
    const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
    volume.writeFileSync("/in.wav", input);
    for (const probe of [false, true]) {
      let stderr = "", stdout = "";
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        args: probe
          ? ["-v", "error", "-show_packets", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample,duration_ts:packet=pos,size,duration", "-of", "json", pipe ? "pipe:0" : "/in.wav"]
          : ["-y", "-v", "error", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "copy", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (pipe) yield input; })(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode === 0, probe || bits !== 0, stderr);
      if (!bits && !probe) {
        assert.match(stderr, /codec/i);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
      } else if (probe) {
        const result = JSON.parse(stdout);
        assert.equal(result.streams[0].sample_rate, "8000");
        assert.equal(result.packets.length, 1);
        assert.equal(result.streams[0].bits_per_sample, bits);
        assert.equal(result.streams[0].codec_name, bits ? "pcm_s16le" : undefined);
        assert.equal(result.packets[0].size, "8");
        assert.equal(result.packets[0].duration, bits ? 4 : undefined);
      }
    }
  });
}
