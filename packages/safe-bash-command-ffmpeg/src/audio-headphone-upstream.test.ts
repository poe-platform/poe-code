import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(graph: string, prefilteredInput?: number) {
  const fs = Volume.fromJSON({});
  const program = Array.from({ length: 12 }, (_, i) => [5000 + i * 71, -1000 + i * 53]);
  const impulse = [[16384, 0], [0, 8192], [4096, 4096]];
  for (const [index, frames] of [program, impulse, impulse].entries()) {
    const filtered = index === prefilteredInput
      ? frames.map(frame => frame.map(sample => sample * 0.5)).reverse() : frames;
    fs.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [0, 1].map(channel => Float64Array.from(filtered, frame => frame[channel]! / 32768)) },
      index === prefilteredInput ? { bitsPerSample: 32, float: true } : {}));
  }
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/0.wav", "-i", "/1.wav", "-i", "/2.wav",
      "-filter_complex", graph, "-map", "[o]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return Buffer.concat(output).toString("hex");
}

// Native FFmpeg 7.0.2, stereo signed 16-bit WAV inputs at 8000 Hz.
for (const option of ["threads=1", "thread_type=slice", "extra_hw_frames=0",
  "threads=1:thread_type=slice:extra_hw_frames=0"]) {
  it(`headphone preserves native PCM with ${option}`, async () => {
    assert.equal(await render(`[0:a][1:a][2:a]headphone=map=FL|FR:${option}[o]`),
      "ea0300000904f5012305ff024a05170371052e0398054503be055d03e50574030c068b033306a2035a06ba038106d103");
  });
}

for (const [graph, expected] of [
  ["[0:a]volume=0.5[p];[p][1:a][2:a]headphone=map=FL|FR:type=time[o]",
    "f50100000502fb0092028001a5028b01b8029701cc02a301df02ae01f302ba010603c6011a03d1012d03dd014003e901"],
  ["[1:a]areverse[h];[0:a][h][2:a]headphone=map=FL|FR:type=time[o]",
    "3f00390150003303080508032f052003560537037d054e03a4056503cb057d03f10594031806ab033f06c3036606da03"],
  ["[0:a][1:a][2:a]headphone=map=FL|FR:type=time[o]",
    "ea0300000904f5012305ff024a05170371052e0398054503be055d03e50574030c068b033306a2035a06ba038106d103"],
  ["[0:a][1:a][2:a]headphone=map=FL|FR:type=time,volume=0.5[o]",
    "f50100000502fb0092028001a5028b01b8029701cc02a301df02ae01f302ba010603c6011a03d1012d03dd014003e901"]
] as const) {
  it(`matches native PCM for ${graph}`, async () => {
    assert.equal(await render(graph), expected);
  });
}

for (const index of [0, 1, 2]) {
  it(`applies chained filters only to headphone input ${index}`, async () => {
    const inputs = [0, 1, 2].map(input => input === index ? "[filtered]" : `[${input}:a]`).join("");
    const actual = await render(`[${index}:a]volume=0.5,areverse[filtered];${inputs}headphone=map=FL|FR:type=time[o]`);
    const expected = await render("[0:a][1:a][2:a]headphone=map=FL|FR:type=time[o]", index);
    assert.equal(actual, expected);
  });
}
