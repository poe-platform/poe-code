import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./media.js";

function fixture(channels: number) {
  const bytes = Buffer.alloc(52);
  bytes.write("RIFF"); bytes.writeUInt32LE(44, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(8, 40);
  [100, 200, 300, 400].forEach((value, index) => bytes.writeInt16LE(value, 44 + index * 2));
  return bytes;
}

it("rejects zero-channel WAV probing across buffer, source, and stream paths while preserving demuxing", async () => {
  const bytes = fixture(0);
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
  for (const showPackets of [false, true]) {
    expect(() => wavAst().probe(bytes, { showPackets })).toThrow("channel layout");
    await expect(probeWavSource(source, { showPackets })).rejects.toThrow("channel layout");
    await expect(probeWavStream((async function* () { yield bytes; })(), { showPackets })).rejects.toThrow("channel layout");
  }
  expect(() => parseWav(bytes)).toThrow("channel layout");
  const doc = parseWav(bytes, { decodeAudio: false });
  expect(doc.tracks[0]!.codecDescriptions[0]!.channels).toBe(0);
  expect(Buffer.concat(doc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)))).toEqual(bytes.subarray(44));
});

for (const channels of [0, 1]) for (const pipe of [false, true]) {
  it(`probes and stream-copies WAV with ${channels} channels via ${pipe ? "pipe" : "file"}`, async () => {
    const bytes = fixture(channels);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.wav", bytes);
    for (const probe of [true, false]) {
      let output = "", diagnostic = "";
      const args = probe
        ? ["-v", "error", "-show_packets", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample,duration_ts:packet=pos,size,duration", "-of", "json", pipe ? "pipe:0" : "/in.wav"]
        : ["-y", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "copy", "/out.wav"];
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        command: probe ? "ffprobe" : "ffmpeg", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (pipe) yield bytes; })(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(probe && channels === 0 ? 1 : 0);
      if (probe && channels === 0) { expect(diagnostic).toContain("channel layout"); expect(output).toBe(""); }
      else if (probe) { const data = JSON.parse(output); expect(data.streams[0].channels).toBe(1); expect(data.packets[0].duration).toBe(4); }
      else {
        const copied = parseWav(await fs.readFile("/out.wav"), { decodeAudio: false });
        expect(copied.tracks[0]!.codecDescriptions[0]!.channels).toBe(channels);
        expect(Buffer.concat(copied.tracks[0]!.samples.map(sample => Buffer.from(sample.data)))).toEqual(bytes.subarray(44));
      }
    }
  });
}
