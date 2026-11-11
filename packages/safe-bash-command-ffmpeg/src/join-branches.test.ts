import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function join(graph: string) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, value] of [["/a.wav", 8000], ["/b.wav", -4000]] as const) {
    const channel = new Float64Array(2048).fill(value / 32768);
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: [channel] }));
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

for (const [graph, expected, frames] of [
  ["[0:a][1:a]join=map=0.0-FL|1.0-FR[o]", [8000, -4000], 2048],
  ["[0:a]volume=0.5[x];[x][1:a]join=map=0.0-FL|1.0-FR[o]", [4000, -4000], 2048],
  ["[1:a]volume=0.5[x];[0:a][x]join=map=0.0-FL|1.0-FR[o]", [8000, -2000], 2048],
  ["[0:a]anull[x];[x][1:a]join=map=0.0-FL|1.0-FR[o]", [8000, -4000], 2048],
  ["[0:a]volume=0.5[x];[1:a]volume=0.25[y];[x][y]join=map=0.0-FL|1.0-FR[o]", [4000, -1000], 2048],
  ["[0:a]volume=0.5[x];[x]volume=0.5[y];[y][1:a]join=map=0.0-FL|1.0-FR[o]", [2000, -4000], 2048],
  ["[0:a]volume=0.5[x];[1:a]volume=0.25[y];[x][y]join=map=0.0-FL|1.0-FR,volume=0.5[o]", [2000, -500], 2048],
  ["[0:a]asplit[a][b];[a]volume=0.5[x];[x][b]join=map=0.0-FL|1.0-FR[o]", [4000, 8000], 2048],
  ["[0:a]volume=0.5[x];[1:a][x]join@pair=map=0.0-FL|1.0-FR[o]", [-4000, 4000], 2048],
  ["[0:a]atrim=end_sample=1024,volume=0.5[x];[x][1:a]join=map=0.0-FL|1.0-FR[o]", [4000, -4000], 1024],
  ["[1:a]atrim=end_sample=512,volume=0.5[x];[0:a][x]join=map=0.0-FL|1.0-FR[o]", [8000, -2000], 512],
  ["[0:a]pan=stereo|c0=c0|c1=c0,volume=0.5,channelsplit=channels=FR[x];[1:a]pan=stereo|c0=c0|c1=c0,channelsplit=channels=FL[y];[x][y]join=map=0.0-FL|1.0-FR[o]", [4000, -4000], 2048]
] as const) {
  it(`applies join branch filters independently: ${graph}`, async () => {
    const { result, volume, error } = await join(graph);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelMask ?? 3, 3);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(sample => Array<number>(frames).fill(sample)));
  });
}

for (const [graph, exitCode] of [
  ["[0:a]volume=invalid[x];[x][1:a]join=map=0.0-FL|1.0-FR[o]", 1],
  ["[1:a]unsupported_filter[x];[0:a][x]join=map=0.0-FL|1.0-FR[o]", 8]
] as const) {
  it(`preserves output when a join branch filter fails: ${graph}`, async () => {
    const { result, volume } = await join(graph);
    assert.equal(result.exitCode, exitCode);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
