import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, rate: number | undefined, graph: boolean) {
  const volume = Volume.fromJSON({});
  const input = Buffer.alloc(256);
  for (let i = 0; i < 128; i++) input.writeInt16LE((i % 16) * 1000, i * 2);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...(rate === undefined ? [] : ["-ar", String(rate)]), "-f", "wav", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.wav") as Buffer;
  return {
    rate: parseWav(output).tracks[0]!.decodedAudio!.sampleRate,
    pcm: Buffer.concat(parseAudio(output).nodes.filter(node => node.type === "data").map(node => node.data))
  };
}

for (const graph of [false, true]) {
  for (const [rates, outputRate, selectedRate] of [
    ["11025|16000", 16000, 16000], ["16000|11025", 16000, 16000],
    ["7000|9000", 9000, 9000], ["8000|16000", 16000, 16000],
    ["11025|16000", undefined, 11025], ["7000|9000", undefined, 7000],
    ["11025|16000", 12000, 11025]
  ] as const) {
    it(`negotiates ${rates} with output rate ${outputRate} (graph=${graph})`, async () => {
      const actual = await convert(`aformat=sample_rates=${rates}`, outputRate, graph);
      const expected = await convert(`aformat=sample_rates=${selectedRate}`, outputRate, graph);
      assert.deepEqual(actual, expected);
      assert.equal(actual.rate, outputRate ?? selectedRate);
      if (outputRate === 16000) {
        assert.equal(actual.pcm.length / 2, 256);
        assert.equal(createHash("sha256").update(actual.pcm).digest("hex"),
          "0a79029748ae06bf1f2c789b046f7c7bfc5deb3ec164d80d666e8533a7a11cda");
      }
    });
  }
  for (const suffix of [",anull", ",aformat=f=s16", ",aformat=r=16000|11025",
    ",aresample=11025", ",asetrate=11025", ",aformat=r=11025"]) {
    it(`respects downstream ${suffix} (graph=${graph})`, async () => {
      const selected = [",anull", ",aformat=f=s16", ",aformat=r=16000|11025"].includes(suffix) ? 16000 : 11025;
      assert.deepEqual(await convert(`aformat=r=11025|16000${suffix}`, 16000, graph),
        await convert(`aformat=r=${selected}${suffix}`, 16000, graph));
    });
  }
}
