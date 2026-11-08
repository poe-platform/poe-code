import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

for (const present of [false, true]) for (const pipe of [false, true]) {
  it(`${present ? "accepts empty" : "rejects missing"} WAV data before output (${pipe ? "pipe" : "file"})`, async () => {
    const input = Buffer.alloc(48 + (present ? 8 : 0));
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
    input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
    input.write("JUNK", 36); input.writeUInt32LE(3, 40); input.write("xyz", 44);
    if (present) input.write("data", 48);
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
      assert.equal(result.exitCode === 0, present, stderr);
      if (!present) {
        assert.match(stderr, /data/);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
      } else if (probe) {
        const result = JSON.parse(stdout);
        assert.equal(result.streams[0].sample_rate, "8000");
        assert.equal(result.packets.length, 0);
      }
    }
  });
}
