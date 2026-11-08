import assert from "node:assert/strict";
import { it } from "node:test";
import { wavAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

function fixture(duplicate: boolean): Buffer {
  const chunk = (id: string, bytes: Buffer) => {
    const head = Buffer.alloc(8); head.write(id); head.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([head, bytes, Buffer.alloc(bytes.length % 2)]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1); format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4); format.writeUInt32LE(16000, 8);
  format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const conflicting = Buffer.from(format);
  conflicting.writeUInt16LE(2, 2); conflicting.writeUInt32LE(16000, 4);
  conflicting.writeUInt32LE(64000, 8); conflicting.writeUInt16LE(4, 12);
  return chunk("RIFF", Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", format),
    ...(duplicate ? [chunk("fmt ", conflicting)] : []),
    chunk("data", Buffer.from([100, 0, 200, 0, 44, 1, 144, 1]))]));
}

for (const duplicate of [false, true]) for (const pipe of [false, true]) {
  it(`uses first WAV format (duplicate: ${duplicate}) (${pipe ? "pipe" : "file"})`, async () => {
    const input = fixture(duplicate);
    const volume = new Volume();
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
      assert.equal(result.exitCode, 0, stderr);
      const output = probe ? JSON.parse(stdout) : wavAst().probe(new Uint8Array(volume.readFileSync("/out.wav") as Buffer), { showPackets: true });
      const stream = output.streams[0];
      assert.equal(stream.sample_rate, "8000");
      assert.equal(stream.channels, 1);
      assert.equal(stream.codec_name, "pcm_s16le");
      assert.equal(stream.bits_per_sample, 16);
      if (!probe || !pipe) assert.equal(Number(stream.duration_ts), 4);
      assert.equal(Number(output.packets[0].size), 8);
      assert.equal(output.packets[0].duration, 4);
      if (probe) assert.equal(Number(output.packets[0].pos), duplicate ? 68 : 44);
      else assert.deepEqual((volume.readFileSync("/out.wav") as Buffer).subarray(-8), input.subarray(-8));
    }
  });
}
