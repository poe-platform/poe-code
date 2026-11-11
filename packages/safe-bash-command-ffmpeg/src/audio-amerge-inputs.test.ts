import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, inputs: { values: number[]; mask?: number; length?: number }[]) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, input] of inputs.entries()) {
    const doc = parseWav(encodeWav({ sampleRate: 8000,
      channels: input.values.map(value => new Float64Array(input.length ?? 2048).fill(value / 32768)) }));
    const track = doc.tracks[0]!;
    const output = input.mask === undefined ? doc : { ...doc, tracks: [{ ...track,
      decodedAudio: { ...track.decodedAudio!, channelMask: input.mask }
    }] };
    volume.writeFileSync(`/${index}.wav`, serializeWav(output, { audioCodec: "pcm_s16le" }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...inputs.flatMap((_, index) => ["-i", `/${index}.wav`]),
      "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

for (const count of [1, 2, 3, 4, 8, 64]) {
  for (const binding of ["explicit", "implicit", "partial"]) {
    it(`amerge allocates ${count} inputs with ${binding} bindings`, async () => {
      const values = Array.from({ length: count }, (_, index) => [8000, -4000, 12000][index % 3]!);
      const labels = binding === "explicit" ? values.map((_, index) => `[${index}:a]`).join("")
        : binding === "partial" ? `[${count - 1}:a]` : "";
      const result = await run(`${labels}amerge=inputs=${count}[out]`, values.map(value => ({ values: [value] })));
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(result.output).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, count);
      const mask = new Map([[1, 4], [2, 3], [3, 0xb], [4, 0x107], [8, 0x63f], [64, 0]]).get(count)!;
      assert.equal(audio.channelMask || (count === 1 ? 4 : count === 2 ? 3 : 0), mask);
      const ordered = binding === "partial" ? [values.at(-1)!, ...values.slice(0, -1)] : values;
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
        ordered.map(value => Array<number>(2048).fill(value)));
    });
  }
}

for (const { name, inputs, expected, mask } of [
  { name: "disjoint speakers", inputs: [{ values: [12000], mask: 4 }, { values: [-4000], mask: 2 },
    { values: [8000], mask: 1 }], expected: [8000, -4000, 12000], mask: 7 },
  { name: "disjoint multichannel inputs", inputs: [{ values: [12000, 16000], mask: 0x30 },
    { values: [-4000], mask: 4 }, { values: [8000, 2000], mask: 3 }],
    expected: [8000, 2000, -4000, 12000, 16000], mask: 0x37 },
  { name: "overlap with a later input", inputs: [{ values: [12000], mask: 4 },
    { values: [-4000], mask: 2 }, { values: [8000], mask: 4 }], expected: [12000, -4000, 8000], mask: 0xb }
]) {
  it(`amerge combines ${name} and ends at the shortest input`, async () => {
    const result = await run("[0:a][1:a][2:a]amerge@many=inputs=1+2,volume=0.5[out]",
      inputs.map((input, index) => ({ ...input, length: [2300, 1023, 2048][index]! })));
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(result.output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, expected.length);
    assert.equal(audio.channelMask, mask);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(value => Array<number>(1023).fill(value / 2)));
  });
}

for (const [graph, count, exitCode] of [
  ["[0:a][1:a]amerge=inputs=1[out]", 2, 1],
  ["[0:a][1:a][2:a]amerge[out]", 3, 1],
  ["[0:a][1:a]amerge=inputs=3[out]", 2, 1],
  ["amerge=inputs=4[out]", 3, 1],
  ["[0:a]amerge=inputs=0[out]", 1, 222],
  ["[0:a]amerge=inputs=65[out]", 1, 222]
] as const) {
  it(`amerge validates pads without replacing output: ${graph}`, async () => {
    const result = await run(graph, Array.from({ length: count }, () => ({ values: [8000] })));
    assert.equal(result.exitCode, exitCode, result.stderr);
    assert.equal(result.output.toString(), "keep");
  });
}

it("amerge rejects more than 64 output channels without replacing output", async () => {
  const result = await run("amerge=inputs=33[out]",
    Array.from({ length: 33 }, () => ({ values: [8000, -4000], length: 16 })));
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok(result.stderr.includes("at most 64 output channels"), result.stderr);
  assert.equal(result.output.toString(), "keep");
});
