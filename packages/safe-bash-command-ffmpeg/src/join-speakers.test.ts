import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(map: string, samples: number[], mask?: number, reverse = false) {
  let input = encodeWav({ sampleRate: 8000,
    channels: samples.map(sample => new Float64Array(8).fill(sample / 32768)) });
  if (mask !== undefined) {
    const doc = parseWav(input);
    input = serializeWav({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
      decodedAudio: { ...track.decodedAudio!, channelMask: mask }
    })) }, { audioCodec: "pcm_s16le" });
  }
  const volume = Volume.fromJSON({ "/a.wav": Buffer.from(input), "/out.wav": "preserve",
    "/b.wav": Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(6).fill(1000 / 32768), new Float64Array(6).fill(2000 / 32768)] })) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}join=map=${map}[out]`,
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
  assert.deepEqual(volume.readFileSync("/a.wav"), Buffer.from(input));
  return { result, stderr, bytes: volume.readFileSync("/out.wav") as Buffer };
}

for (const { samples, mask, name, index } of [
  { samples: [-3000, -2000], name: "FR", index: 1 },
  { samples: [-3000], name: "FC", index: 0 },
  { samples: [-3000, -2000, -1000, -500], name: "BC", index: 3 },
  { samples: [-3000, -2000, -1000, -500], mask: 0x33, name: "BL", index: 2 },
  { samples: [-3000, -2000], mask: 0xc, name: "FC", index: 0 },
  { samples: [-3000, -2000], mask: 0x600, name: "SL", index: 0 }
]) {
  for (const reverse of [false, true]) {
    it(`joins ${name} from layout ${mask ?? "default"} with ${samples.length} channels (reversed ${reverse})`, async () => {
      const input = reverse ? 1 : 0;
      const other = reverse ? 0 : 1;
      const named = await run(`${input}.${name}-FL|${other}.FL-FR`, samples, mask, reverse);
      assert.equal(named.result.exitCode, 0, named.stderr);
      const numeric = await run(`${input}.${index}-FL|${other}.0-FR`, samples, mask, reverse);
      assert.equal(numeric.result.exitCode, 0, numeric.stderr);
      assert.deepEqual(named.bytes, numeric.bytes);
      const audio = parseWav(named.bytes).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.channelMask ?? 3, 3);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
        [Array(6).fill(samples[index]), Array(6).fill(1000)]);
    });
  }
}

for (const [map, expected] of [
  ["0.FR-FL", [-2000, 2000]],
  ["0.FL-FR", [1000, -3000]]
] as const) {
  it(`reserves named speakers before assigning unmapped channels: ${map}`, async () => {
    const { result, stderr, bytes } = await run(map, [-3000, -2000]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(sample => Array(6).fill(sample)));
  });
}

for (const map of ["0.FC-FL|1.FL-FR", "0.BOGUS-FL|1.FL-FR", "2.FR-FL|1.FL-FR",
  "x.FR-FL|1.FL-FR", "0.-FL|1.FL-FR", "0.FR.extra-FL|1.FL-FR"]) {
  it(`rejects absent or invalid speakers without replacing output: ${map}`, async () => {
    const { result, stderr, bytes } = await run(map, [-3000, -2000]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /join/);
    assert.equal(bytes.toString(), "preserve");
  });
}
