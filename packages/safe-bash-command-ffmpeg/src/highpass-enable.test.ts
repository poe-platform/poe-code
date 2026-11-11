import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32768, 32767];
const filtered = [0, 1, 2, 5, 4, 8, -1, -3, -3, -7, -5, -10, 30996, -30997, -32768, 32767];

// Native FFmpeg 7.0.2 PCM16 references. Disabled frames keep the biquad history warm.
for (const [filter, expected] of [
  ["anull", input],
  ["highpass=f=100:b=2:enable=0", input],
  ["highpass=f=100:b=2:enable=1", [0, 0, 1, 4, 4, 9, 0, -1, -25, 17, -19, 5, 32761, -32762, -30997, 30996]],
  ["asetnsamples=n=2:p=0,highpass=f=100:b=2:enable='gte(t,0.0005)'", [1, 2, 3, 6, 4, 9, 0, -1, -25, 17, -19, 5, 32761, -32762, -30997, 30996]],
  ["highpass=f=100", filtered],
  ["highpass=f=100:enable=0", input],
  ["highpass=f=100:enable=1", filtered],
  ["asetnsamples=n=2:p=0,highpass=f=100:enable='gte(t,0.0005)'", [...input.slice(0, 8), ...filtered.slice(8)]],
  ["asetnsamples=n=2:p=0,highpass=f=100:enable='gte(n,2)'", [...input.slice(0, 8), ...filtered.slice(8)]],
  ["asetnsamples=n=2:p=0,asetpts=PTS+4,highpass=f=100:enable='gte(t,0.0005)'", filtered],
  ["asetnsamples=n=2:p=0,highpass=f=100:enable='not(mod(n,2))'",
    [...filtered.slice(0, 4), ...input.slice(4, 8), ...filtered.slice(8, 12), ...input.slice(12)]],
  ["asetnsamples=n=2:p=0,highpass=f=100:enable='gte(t,0.000125)'", [...input.slice(0, 4), ...filtered.slice(4)]],
  ["highpass=f=100:enable=0.49", input],
  ["highpass=f=100:enable=-0.5", filtered],
  ["highpass=f=100:enable='0/0'", input],
  ["highpass=f=100:enable='1/0'", filtered],
  ["asetpts=PTS/0,highpass=f=100:enable='isnan(t)'", filtered],
  ["asetnsamples=n=2:p=0,highpass=f=100:enable='gte(st(0,ld(0)+1),3)'", [...input.slice(0, 8), ...filtered.slice(8)]]
] as const) {
  for (const graph of [false, true]) it(`highpass timeline ${filter} (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid highpass enable=${enable} before replacing output`, async () => {
    const { result, output } = await run(`highpass=f=100:enable='${enable}'`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from(input.filter((_, i) => i % 2 === 0), value => value / 32768),
    Float64Array.from(input.filter((_, i) => i % 2 === 1), value => value / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}
