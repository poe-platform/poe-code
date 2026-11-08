import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./media.js";

function fixture(pad: boolean) {
  const bytes = Buffer.alloc(pad ? 54 : 53);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(9, 40);
  [100, 200, 300, 400].forEach((value, index) => bytes.writeInt16LE(value, 44 + index * 2));
  bytes[52] = 0x5a;
  return bytes;
}

for (const pad of [false, true]) {
  it(`preserves partial PCM bytes across WAV probe paths (pad=${pad})`, async () => {
    const bytes = fixture(pad);
    const options = { showPackets: true };
    const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
    for (const result of [wavAst().probe(bytes, options), await probeWavSource(source, options),
      await probeWavStream((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(), options)]) {
      expect([...result.packets!].map(packet => [packet.pos, packet.size, packet.duration])).toEqual([["44", "9", 4]]);
      expect(result.streams[0]!.duration_ts).toBe(4);
    }
    const doc = parseWav(bytes);
    expect(doc.tracks[0]!.decodedAudio!.channelData[0]!.length).toBe(4);
    expect(Buffer.concat(doc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)))).toEqual(bytes.subarray(44, 53));
  });
  for (const pipe of [false, true]) it(`public WAV probe and copy preserve partial PCM (pad=${pad}, pipe=${pipe})`, async () => {
    const bytes = fixture(pad), fs = new MemoryFileSystem();
    await fs.writeFile("/in.wav", bytes);
    for (const probe of [true, false]) {
      let output = "", diagnostic = "";
      const args = probe
        ? ["-v", "error", "-show_packets", "-show_entries", "stream=duration_ts:packet=pos,size,duration", "-of", "json", pipe ? "pipe:0" : "/in.wav"]
        : ["-y", "-v", "error", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "copy", "-f", "s16le", "/out.pcm"];
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        command: probe ? "ffprobe" : "ffmpeg", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (pipe) yield bytes; })(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      if (probe) expect(JSON.parse(output).packets).toEqual([{ pos: "44", size: "9", duration: 4 }]);
      else expect(Buffer.from(await fs.readFile("/out.pcm")).toString("hex")).toBe("6400c8002c0190015a");
    }
  });
}

for (const completeSamples of [0, 512, 513]) {
  it(`retains a partial PCM sample after ${completeSamples} complete samples`, async () => {
    const bytes = Buffer.alloc(44 + completeSamples * 2 + 1);
    fixture(false).copy(bytes, 0, 0, 44);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    bytes[bytes.length - 1] = 0x5a;
    const doc = parseWav(bytes);
    expect(doc.tracks[0]!.decodedAudio!.channelData[0]!.length).toBe(completeSamples);
    expect(Buffer.concat(doc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)))).toEqual(bytes.subarray(44));
    const probe = await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, { showPackets: true });
    const packets = [...probe.packets!];
    expect(packets.reduce((total, packet) => total + Number(packet.size), 0)).toBe(bytes.length - 44);
    expect(packets.reduce((total, packet) => total + Number(packet.duration), 0)).toBe(completeSamples);
    expect(packets.every(packet => Number(packet.size) <= 1024)).toBe(true);
  });
}
