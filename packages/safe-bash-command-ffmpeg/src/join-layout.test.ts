import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [layout, map, expected, mask] of [
  ["quad", "0.0-FL|0.1-FR|1.0-BL|1.1-BR", [12000, -2000, 1000, 2000], 0x33],
  ["quad", "1.1-BR|0.1-FR|1.0-BL|0.0-FL", [12000, -2000, 1000, 2000], 0x33],
  ["mono", "1.1-FC", [2000], 4],
  ["0x3", "0.0-FL|1.0-FR", [12000, 1000], 3],
  ["stereo", "0.0-FL|1.0-FR", [12000, 1000], 3],
  ["quad", "", [12000, -2000, 1000, 2000], 0x33],
  ["mono", "", [12000], 4],
  ["FR+BL", "1.1-BL|0.0-FR", [12000, 2000], 0x12],
  ["5.1", "0.0-FL|0.1-FR|1.0-FC|1.1-LFE|0.0-BL|0.1-BR", [12000, -2000, 1000, 2000, 12000, -2000], 0x3f],
  ["mono", "0.0-FL", undefined, 0],
  ["quad", "0.0-BL|1.0-BL", undefined, 0],
  ["unknown", "", undefined, 0],
  ["5.1", "", undefined, 0]
] as const) {
  it(`join preserves output speakers for ${layout}:${map}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "preserve" });
    for (const [index, samples] of [[12000, -2000], [1000, 2000]].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: samples.map(sample => new Float64Array(index === 0 ? 4096 : 2048).fill(sample / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]join=channel_layout=${layout}${map ? `:map=${map}` : ""}[out]`,
        "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    const bytes = volume.readFileSync("/out.wav") as Buffer;
    if (!expected) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /join/);
      assert.equal(bytes.toString(), "preserve");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, expected.length);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelMask ?? (audio.channels === 1 ? 4 : 3), mask);
    if (expected.length > 2 || mask === 0x12) {
      const fmt = bytes.indexOf("fmt ");
      assert.equal(bytes.readUInt16LE(fmt + 8), 0xfffe);
      assert.equal(bytes.readUInt32LE(fmt + 28), mask);
    }
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(sample => Array<number>(2048).fill(sample)));
  });
}
