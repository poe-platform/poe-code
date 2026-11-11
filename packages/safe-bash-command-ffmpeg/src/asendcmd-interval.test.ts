import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: four eight-sample frames at 0, 1, 2, and 3 ms.
const cases = [
  ["0.001-0.003 [leave] volume@v volume 3", [1000, 1000, 1000, 3000]],
  ["0.001-0.003 volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.001-0.003 [enter] volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.0011-0.0021 [leave] volume@v volume 3", [1000, 1000, 1000, 3000]],
  ["0.0011-0.0021 volume@v volume 2", [1000, 1000, 2000, 2000]],
  ["0.0011-0.0019 [leave] volume@v volume 3", [1000, 1000, 1000, 1000]],
  ["0.0011-0.0019 volume@v volume 2", [1000, 1000, 1000, 1000]],
  ["0.001-0.001 volume@v volume 2", [1000, 1000, 1000, 1000]],
  ["0.001-0.004 [leave] volume@v volume 3", [1000, 1000, 1000, 1000]],
  ["0.001 [leave] volume@v volume 3", [1000, 1000, 1000, 1000]],
  ["0.001 [enter] volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.001-0.004 volume@v volume 2;0.002 volume@v volume 3", [1000, 2000, 3000, 3000]],
  ["0.001-0.003 [leave] volume@other volume 3", [1000, 1000, 1000, 1000]],
  ["0.001-0.002 [leave] volume@v volume 3;0.002 volume@v volume 2", [1000, 1000, 2000, 2000]],
  ["0.002 volume@v volume 2;0.001-0.002 [leave] volume@v volume 3", [1000, 1000, 2000, 2000]]
] as const;

for (const complex of [false, true]) {
  for (const [command, frames] of cases) {
    it(`honors asendcmd interval ${command} (${complex ? "graph" : "simple"})`, async () => {
      const { result, fs, stderr } = await run(command, complex);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, 64);
      for (let sample = 0; sample < 32; sample++) {
        assert.equal(output.readInt16LE(sample * 2), frames[Math.floor(sample / 8)], `sample ${sample}`);
      }
    });
  }
}

for (const complex of [false, true]) {
  for (const [timestamps, command, frames] of [
    ["asetpts='mod(N,16)'", "0.001-0.003 [leave] volume@v volume 3", [1000, 1000, 3000, 3000]],
    ["asetpts='mod(N,16)'", "0-0.001 volume@v volume 1;0.001-0.003 volume@v volume 2", [1000, 2000, 1000, 2000]],
    ["asetpts=PTS+8000", "1.001-1.003 [leave] volume@v volume 3", [1000, 1000, 1000, 3000]]
  ] as const) {
    it(`uses frame timestamps for ${command} after ${timestamps} (${complex ? "graph" : "simple"})`, async () => {
      const { result, fs, stderr } = await run(command, complex, timestamps);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, 64);
      for (let sample = 0; sample < 32; sample++) {
        assert.equal(output.readInt16LE(sample * 2), frames[Math.floor(sample / 8)], `sample ${sample}`);
      }
    });
  }
}

for (const interval of ["0.003-0.001", "0.001-", "0.001-nope", "0.001-0.002-0.003"]) {
  it(`rejects invalid asendcmd interval ${interval} before replacing output`, async () => {
    const { result, fs, stderr } = await run(`${interval} volume@v volume 2`, false);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("asendcmd:"), stderr);
    assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(command: string, complex: boolean, timestamps = "anull") {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(32).fill(1000 / 32768)] }));
  const filter = `asetnsamples=n=8:p=0,${timestamps},asendcmd=c='${command}',volume@v=1`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, fs, stderr };
}
