import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(output);
}

// FFmpeg 7.0.2-static PCM16 references: integer options round ties to even.
const shortInput = encodeWav({ sampleRate: 8000,
  channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)] });
for (const name of ["adeclick", "adeclip"]) {
  for (const [option, expected] of [
    ["m=0.4", "fefffdff1101fcff"],
    ["m=0.5", "fefffdff1101fcff"],
    ["method=0.6", "a8fd0cfe3075d4fe"],
    [name === "adeclick" ? "55:75:2:2:2:0.5" : "55:75:8:10:1000:0.5", "fefffdff1101fcff"],
    [name === "adeclick" ? "55:75:2:2:2:0.6" : "55:75:8:10:1000:0.6", "a8fd0cfe3075d4fe"]
  ]) for (const graph of [false, true]) {
    it(`${name} rounds ${option} like native FFmpeg (${graph ? "graph" : "simple"})`, async () => {
      assert.equal((await run(shortInput, `${name}=${option}`, graph)).toString("hex"), expected);
    });
  }
}

const clippedInput = readFileSync(new URL("./fixtures/adeclip-input.wav", import.meta.url));
for (const [option, expected] of [
  ["n=100.5", "85508dd4f4aee7276d376b2ab68810d9e2f7d2aa377c2d31fbb8e37677b3419b"],
  ["n=100.6", "a95656aacd0657258e30d43d446d7376b37a064451200014a27bcf2d9bae59a7"],
  ["hsize=101.5", "a8a8ba02106d72679fb4abf1553279ed2b81cbee2ae99b4356fac99b522ff50d"],
  ["55:75:8:10:101.5:0", "a8a8ba02106d72679fb4abf1553279ed2b81cbee2ae99b4356fac99b522ff50d"],
  ["hsize=9998.5", "4d95af31448c9d83c78738ac8f790de09222ec5c9b6eb170ab05561fd8b8c9fe"]
]) for (const graph of [false, true]) {
  it(`adeclip rounds ${option} like native FFmpeg (${graph ? "graph" : "simple"})`, async () => {
    const output = await run(clippedInput, `adeclip=${option}`, graph);
    assert.equal(createHash("sha256").update(output).digest("hex"), expected);
  });
}
