import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const gated = [61, 122, 184, 245, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994];

async function run(graph: string): Promise<number[]> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from(input, sample => sample / 32768)] }, { bitsPerSample: 16 }));
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-filter_complex", graph, "-map", "[o]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.concat(stdout);
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}

// Complete PCM16 output from native FFmpeg 7.0.2 for the 8 kHz ramp above.
for (const [commands, gate, expected] of [
  ["", "sidechaingate", gated],
  ["", "sidechaingate=range=1", input],
  ["0 sidechaingate range 1", "sidechaingate", input],
  ["0.0005 sidechaingate range 1", "sidechaingate", [...gated.slice(0, 4), ...input.slice(4)]],
  ["0.0006 sidechaingate range 1", "sidechaingate", [...gated.slice(0, 8), ...input.slice(8)]],
  ["0.0005 sidechaingate@g range 1", "sidechaingate@g", [...gated.slice(0, 4), ...input.slice(4)]],
  ["0.0005 sidechaingate@missing range 1", "sidechaingate@g", gated],
  ["0.0005 sidechaingate range 1;0.001 sidechaingate range 0.06125", "sidechaingate",
    [...gated.slice(0, 4), ...input.slice(4, 8), ...gated.slice(8)]]
] as const) {
  it(`sidechaingate applies range commands at program frame boundaries: ${commands || gate}`, async () => {
    const sender = commands ? `,asendcmd=c='${commands}'` : "";
    assert.deepEqual(await run(`[0:a]asplit[x][y];[x]asetnsamples=n=4:p=0${sender}[a];`
      + `[y]asetnsamples=n=4:p=0[b];[a][b]${gate},anull[o]`), expected);
  });
}

it("sidechaingate retains the last range after invalid commands and accepts a later update", async () => {
  for (const value of ["-1", "2", "NaN", "invalid"]) {
    assert.deepEqual(await run(`[0:a]asplit[x][y];[x]asetnsamples=n=4:p=0,`
      + `asendcmd=c='0 sidechaingate range 1;0.0005 sidechaingate range ${value};0.001 sidechaingate range 0.06125'[a];`
      + "[y]asetnsamples=n=4:p=0[b];[a][b]sidechaingate[o]"), [...input.slice(0, 8), ...gated.slice(8)]);
  }
});

it("sidechaingate receives range commands from its control branch", async () => {
  assert.deepEqual(await run("[0:a]asplit[x][y];[x]asetnsamples=n=4:p=0[a];"
    + "[y]asetnsamples=n=4:p=0,asendcmd=c='0.0005 sidechaingate range 1'[b];[a][b]sidechaingate[o]"),
  [...gated.slice(0, 4), ...input.slice(4)]);
});

it("sidechaingate schedules range updates using shifted input timestamps", async () => {
  assert.deepEqual(await run("[0:a]asetpts=PTS+8000,asplit[x][y];"
    + "[x]asetnsamples=n=4:p=0,asendcmd=c='1.0005 sidechaingate range 1'[a];"
    + "[y]asetnsamples=n=4:p=0[b];[a][b]sidechaingate[o]"), [...gated.slice(0, 4), ...input.slice(4)]);
});

it("sidechaingate accepts numeric expressions in range updates", async () => {
  assert.deepEqual(await run("[0:a]asplit[x][y];"
    + "[x]asetnsamples=n=4:p=0,asendcmd=c='0.0005 sidechaingate range 1/2'[a];"
    + "[y]asetnsamples=n=4:p=0[b];[a][b]sidechaingate[o]"),
  [61, 122, 184, 245, 2500, 3000, 3500, 4000, 4500, 5441, 7700, 9994]);
});

for (const [target, expected] of [
  ["sidechaingate", [31, 61, 92, 122, 2500, 3000, 3500, 4000, 4500, 5441, 7700, 9994]],
  ["sidechaingate@a", [31, 61, 92, 122, 2500, 3000, 3500, 4000, 4500, 5441, 7700, 9994]],
  ["sidechaingate@b", [31, 61, 92, 122, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994]],
  ["sidechaingate@missing", [31, 61, 92, 122, 200, 395, 705, 1167, 1823, 2960, 5390, 8323]]
] as const) {
  it(`sidechaingate routes range updates only to the first matching instance: ${target}`, async () => {
    assert.deepEqual(await run(`[0:a]asetnsamples=n=4:p=0,asendcmd=c='0.0005 ${target} range 1',asplit=3[p][k1][k2];`
      + "[p][k1]sidechaingate@a[m];[m][k2]sidechaingate@b=range=0.5[o]"), expected);
  });
}
