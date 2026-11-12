import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 13 }, (_, i) => [(i + 1) * 1901, -(i + 1) * 2203]);
const desired = input.map((_, i) => [input[i - 2]?.[0] ?? 0, input[i - 5]?.[1] ?? 0]);
const error = [[0,0],[0,0],[0,0],[0,0],[5,0],[28,0],[101,-2],[274,-21],[614,-94],[1184,-283],[2034,-666],[3183,-1320],[4618,-2302]];
const output = [[0,0],[0,0],[1901,0],[3802,0],[5698,0],[7576,-2203],[9404,-4404],[11132,-6588],[12693,-8718],[14024,-10732],[15075,-12552],[15827,-14101],[16293,-15322]];
async function run(filter: string, graph = "[0:a]asplit[a][b];[a]anull[x];[b]adelay=2S|5S[y];[x][y]") {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(c => Float64Array.from(input, frame => frame[c]! / 32768)) }));
  let stderr = "";
  const chunks: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-filter_complex", `${graph}${filter}[out]`,
      "-map", "[out]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const pcm = Buffer.concat(chunks);
  return { result, stderr, frames: Array.from({ length: pcm.length / 4 }, (_, i) => [pcm.readInt16LE(i * 4), pcm.readInt16LE(i * 4 + 2)]) };
}

// Exact FFmpeg 7.0.2 PCM16 samples for the delayed, four-tap stereo graph.
for (const [mode, expected] of [["i", input], ["d", desired], ["o", output], ["e", error]] as const) {
  it(`anlmf processes both branches in mode ${mode}`, async () => {
    const actual = await run(`anlmf=order=4:out_mode=${mode}`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.frames, expected);
  });
}
it("amultiply remains a control for the delayed split graph", async () => {
  const actual = await run("amultiply");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.frames, [[0,0],[0,0],[331,0],[882,0],[1654,0],[2647,889],[3860,2074],[5294,3555],[6948,5332],[8823,7405],[10918,9775],[13234,12441],[15771,15403]]);
});

it("anlmf accepts named instances and positional options before downstream filters", async () => {
  const actual = await run("anlmf@adaptive=4:0.75:1:0:d:float,volume=0");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.frames, input.map(() => [0, 0]));
});
it("anlmf stops when the desired branch ends", async () => {
  const actual = await run("anlmf=order=4:out_mode=i", "[0:a]asplit[a][b];[b]atrim=end_sample=3[y];[a][y]");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.frames, input.slice(0, 3));
});
it("anlmf noise mode passes input through when adaptation is disabled", async () => {
  const actual = await run("anlmf=order=4:mu=0:out_mode=n:precision=double");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.frames, input);
});
for (const option of ["order=0", "order=32768", "mu=3", "eps=-1", "leakage=2", "out_mode=bad", "precision=bad", "unknown=1"]) {
  it(`anlmf rejects ${option}`, async () => {
    const actual = await run(`anlmf=${option}`);
    assert.notEqual(actual.result.exitCode, 0);
    assert.ok(actual.stderr.includes("anlmf:"), actual.stderr);
    assert.deepEqual(actual.frames, []);
  });
}
