import { expect, it } from "vitest";
import { wavAst, probeWavSource, probeWavStream } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [samples, declaredSamples] of [[0, 0], [4, 4], [4, 0]] as const) for (const packets of [false, true]) {
  it(`probes ${samples}-sample WAV duration (header: ${declaredSamples}) with packets=${packets}`, async () => {
    const bytes = Buffer.alloc(44 + samples * 2);
    bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36); bytes.writeUInt32LE(declaredSamples * 2, 40);
    for (let index = 0; index < samples; index++) bytes.writeInt16LE((index + 1) * 100, 44 + index * 2);
    const args = ["-v", "error", ...(packets ? ["-show_packets"] : []), "-show_entries",
      "stream=codec_name,sample_rate,channels,bits_per_sample,duration_ts,duration" + (packets ? ":packet=pos,size,duration" : ""),
      "-of", "json", "/in.wav"];
    const expected = {
      streams: [{ codec_name: "pcm_s16le", sample_rate: "8000", channels: 1, bits_per_sample: 16,
        ...(samples ? { duration_ts: 4, duration: "0.000500" } : {}) }],
      ...(packets ? { packets: samples ? [{ pos: "44", size: "8", duration: 4 }] : [] } : {})
    };
    for (const metadata of [wavAst().probe(bytes),
      await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }),
      await probeWavStream((async function* () { yield bytes; })())]) {
      expect(metadata.streams[0]!.duration_ts).toBe(samples || undefined);
      expect(metadata.streams[0]!.duration).toBe(samples ? "0.000500" : undefined);
    }
    const fs = new MemoryFileSystem(); await fs.writeFile("/in.wav", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const data of [JSON.parse(output), JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)]) {
      expect(data.streams).toEqual(expected.streams);
      if (packets) expect(data.packets).toEqual(expected.packets);
    }
  });
}
