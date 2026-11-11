import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/adynamicequalizer-input.wav", import.meta.url));
const original = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
const detector = parseWav(readFileSync(new URL("./fixtures/adynamicequalizer-listen.wav", import.meta.url)))
  .tracks[0]!.decodedAudio!.channelData[0]!;

// Verified against FFmpeg 7.0.2, comparing decoded PCM16. Bypass keeps the
// detector running; enable is evaluated at each 1024-sample input frame's PTS.
for (const graph of [false, true]) {
  for (const [enable, active] of [
    ["0", (_sample: number) => false],
    ["1", (_sample: number) => true],
    ["-0.5", (_sample: number) => true],
    ["0.49", (_sample: number) => false],
    ["'gte(t,0.1)'", (sample: number) => sample >= 2048],
    ["'lt(t,0.1)+gte(t,0.3)'", (sample: number) => sample < 2048 || sample >= 5120],
    ["'gte(n,1)'", (sample: number) => sample >= 1024]
  ] as const) {
    it(`applies adynamicequalizer enable=${enable} (${graph ? "graph" : "simple"})`, async () => {
      const { fs, result, stderr } = await run(`adynamicequalizer=mode=listen:enable=${enable}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(actual.length, original.length);
      assert.deepEqual(actual, original.map((sample, i) => active(i) ? detector[i]! : sample));
    });
  }
}

for (const [prefix, enable, firstEnabledSample] of [
  ["asetpts=PTS+0.2/TB", "gte(t,0.1)", 0],
  ["asetnsamples=n=512:p=0", "gte(n,3)", 1536]
] as const) {
  it(`uses upstream audio frames after ${prefix}`, async () => {
    const { fs, result, stderr } = await run(`${prefix},adynamicequalizer=mode=listen:enable='${enable}'`, false);
    assert.equal(result.exitCode, 0, stderr);
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(actual, original.map((sample, i) => i >= firstEnabledSample ? detector[i]! : sample));
  });
}

it("rejects invalid adynamicequalizer enable expressions without replacing output", async () => {
  const { fs, result, stderr } = await run("adynamicequalizer=mode=listen:enable='gte(t,)'", false);
  assert.notEqual(result.exitCode, 0);
  assert.match(stderr, /adynamicequalizer/);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
});

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
