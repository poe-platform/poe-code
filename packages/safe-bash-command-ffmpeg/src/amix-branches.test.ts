import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(graph: string, stereo = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, value] of [["/a.wav", 8000], ["/b.wav", -4000]] as const) {
    const channel = new Float64Array(2048).fill(value / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: stereo ? [channel, channel.map(sample => -sample)] : [channel] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", graph, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

for (const stereo of [false, true]) {
  for (const [graph, expected] of [
    ["[0:a]volume=0.5[x];[x][1:a]amix[o]", 0],
    ["[1:a]volume=0.5[x];[0:a][x]amix[o]", 3000],
    ["[0:a]anull[x];[x][1:a]amix[o]", 2000],
    ["[0:a]volume=0.5[x];[1:a]volume=0.25[y];[x][y]amix[o]", 1500],
    ["[0:a]volume=0.5[x];[x]volume=0.5[y];[y][1:a]amix[o]", -1000],
    ["[0:a]volume=0.5[x];[1:a]volume=0.25[y];[x][y]amix,volume=0.5[o]", 750],
    ["[0:a]asplit[a][b];[a]volume=0.5[x];[x][b]amix[o]", 6000]
  ] as const) {
    it(`applies amix branch filters independently: ${graph}, stereo=${stereo}`, async () => {
      const { result, volume, error } = await mix(graph, stereo);
      assert.equal(result.exitCode, 0, error);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(channel, sample => sample * 32768),
          Array(2048).fill(index && expected ? -expected : expected));
      }
    });
  }
}

for (const [graph, exitCode] of [
  ["[0:a]volume=invalid[x];[x][1:a]amix[o]", 1],
  ["[1:a]unsupported_filter[x];[0:a][x]amix[o]", 8]
] as const) {
  it(`preserves output when an amix branch filter fails: ${graph}`, async () => {
    const { result, volume } = await mix(graph);
    assert.equal(result.exitCode, exitCode);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
