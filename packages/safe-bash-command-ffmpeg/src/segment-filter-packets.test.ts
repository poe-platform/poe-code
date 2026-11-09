import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 24000 mono PCM16 samples (0..23999), 8000 Hz.
// Reversal emits the short last input frame first; swresample holds back
// 16 input samples until flush. Neither cuts at exact one-second multiples.
for (const [options, rate, lengths, starts, hash] of [
  [[], 8000, [8192, 8192, 7616], [0, 8192, 16384], "d6d2815362c9d4e0b9c25ab75f3608f4cbca774bd820947400cfe9f68dbb7e64"],
  [["-af", "volume=0.5"], 8000, [8192, 8192, 7616], [0, 4096, 8192], "7563675f96d50eb1284e34b610e9f03adc89d30bf3e85148f7306211434cd836"],
  [["-af", "volume=0.5", "-segment_format", "wav"], 8000, [8192, 8192, 7616], [0, 4096, 8192], "7563675f96d50eb1284e34b610e9f03adc89d30bf3e85148f7306211434cd836"],
  [["-af", "areverse"], 8000, [8128, 8192, 7680], [23999, 15871, 7679], "0438dd73685532962a98b908a72d6ef2c4caf7d5a9b8e50f8e2b2b80bd038c83"],
  [["-ar", "12000"], 12000, [12264, 12288, 11448], [0, 8176, 16368], undefined],
  [["-af", "areverse", "-ar", "12000"], 12000, [12168, 12288, 11544], [23999, 15887, 7695], undefined],
  [["-af", "asetnsamples=n=1000:p=0,areverse"], 8000, [8000, 8000, 8000], [23999, 15999, 7999], "0438dd73685532962a98b908a72d6ef2c4caf7d5a9b8e50f8e2b2b80bd038c83"],
  [["-ar", "4000"], 4000, [4080, 4096, 3824], [0, 8160, 16352], "0e6fbd98af55c4c0b9c177a97de8fc2b13a6f571c3eed4e1a51e3d04ff45d738"]
] as const) {
  it(`segments processed WAV audio at native packet boundaries: ${options.join(" ") || "unfiltered"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/audio.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
    const run = async (output: string[]) => {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/audio.wav", ...options, ...output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    };
    const extension = options.some(option => option === "-segment_format") ? "data" : "wav";
    await run(["-f", "segment", "-segment_time", "1", "-segment_list", "/list.csv", `/part%02d.${extension}`]);
    const rows = (volume.readFileSync("/list.csv", "utf8") as string).trim().split("\n");
    assert.equal(rows.length, 3);
    const channels = rows.map(row => {
      const audio = parseWav(volume.readFileSync(`/${row.split(",")[0]}`) as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, rate);
      return audio.channelData[0]!;
    });
    assert.deepEqual(channels.map(channel => channel.length), lengths);
    assert.deepEqual(channels.map(channel => channel[0]! * 32768), starts);
    let offset = 0;
    assert.deepEqual(rows, lengths.map((length, i) => {
      const start = offset;
      offset += length;
      return `part0${i}.${extension},${(start / rate).toFixed(6)},${(offset / rate).toFixed(6)}`;
    }));
    await run(["/whole.wav"]);
    const whole = parseWav(volume.readFileSync("/whole.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(channels.flatMap(channel => Array.from(channel)), Array.from(whole));
    const pcm = Buffer.alloc(whole.length * 2);
    for (const [i, sample] of whole.entries()) pcm.writeInt16LE(sample * 32768, i * 2);
    if (hash) assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    else {
      // swresample's PCM16 coefficient quantization can differ by one LSB.
      for (const [i, sample] of whole.entries()) {
        const position = Math.min(23999, i * 8000 / rate);
        const expected = Math.round(options[1] === "areverse" ? 23999 - position : position);
        assert.ok(Math.abs(sample * 32768 - expected) <= 1, `sample ${i}`);
      }
    }
    if (options[1] === "areverse" && rate === 8000) assert.deepEqual(Array.from(whole, sample => sample * 32768),
      Array.from({ length: 24000 }, (_, i) => 23999 - i));
  });
}
