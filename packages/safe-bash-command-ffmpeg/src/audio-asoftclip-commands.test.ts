import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, complex = false, channels = 1) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: channels }, () => new Float64Array(8).fill(16000 / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(complex
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.pcm") as Buffer;
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}

// Native FFmpeg 7.0.2 PCM16 output for the reported eight-sample input.
for (const [options, command, before, after] of [
  ["type=hard", "output 0.5", 16000, 8000],
  ["type=hard", "type tanh", 16000, 14839],
  ["type=hard", "threshold 0.25", 16000, 8192],
  ["type=hard:output=0.5", "enable 0", 8000, 16000]
] as const) for (const complex of [false, true]) {
  it(`asoftclip applies ${command} at the commanded frame (${complex ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run(`asetnsamples=n=2:p=0,asendcmd=c='0.0005 asoftclip@x ${command}',asoftclip@x=${options}`, complex),
      [...Array<number>(4).fill(before), ...Array<number>(4).fill(after)]);
  });
}

it("asoftclip routes commands to the named instance or first matching filter", async () => {
  const filters = "asoftclip@a=type=hard,asoftclip@b=type=hard:output=0.5";
  for (const [target, value] of [["asoftclip@b", 4000], ["asoftclip", 2000], ["asoftclip@missing", 8000]] as const) {
    assert.deepEqual(await run(`asendcmd=c='0 ${target} output 0.25',${filters}`), Array<number>(8).fill(value));
  }
});

it("asoftclip applies updates at the next frame boundary on every channel", async () => {
  assert.deepEqual(await run("asetnsamples=2:0,asendcmd=c='0.0003 asoftclip@x output 1/2',asoftclip@x=type=hard", true, 2),
    [...Array<number>(8).fill(16000), ...Array<number>(8).fill(8000)]);
});

it("asoftclip ignores rejected commands and still applies later updates", async () => {
  for (const command of ["type unknown", "threshold 0", "output 17", "param 0", "oversample 65", "output NaN", "enable unknown", "unknown 1"]) {
    assert.deepEqual(await run(`asetnsamples=2:0,asendcmd=c='0.00025 asoftclip@x ${command};0.0005 asoftclip@x output 0.5',asoftclip@x=type=hard`),
      [...Array<number>(4).fill(16000), ...Array<number>(4).fill(8000)]);
  }
});

it("asoftclip applies parameter changes and commands at time zero like static options", async () => {
  for (const [command, option] of [["param 2", "param=2"], ["oversample 2", "oversample=2"], ["type -1", "type=hard"]]) {
    assert.deepEqual(await run(`asendcmd=c='0 asoftclip@x ${command}',asoftclip@x`), await run(`asoftclip=${option}`));
  }
  assert.deepEqual(await run("asetnsamples=2:0,asendcmd=c='0.001 asoftclip@x output 0.5',asoftclip@x=type=hard"), Array<number>(8).fill(16000));
});

it("asoftclip retains each oversampling history when switching factors or bypassing", async () => {
  const control = await run("asetnsamples=2:0,asoftclip=type=hard:oversample=2");
  for (const [disable, restore] of [["oversample 1", "oversample 2"], ["enable 0", "enable 1"]]) {
    assert.deepEqual(await run(`asetnsamples=2:0,asendcmd=c='0.00025 asoftclip@x ${disable};0.0005 asoftclip@x ${restore}',asoftclip@x=type=hard:oversample=2`),
      [...control.slice(0, 2), 16000, 16000, ...control.slice(2, 6)]);
  }
});

it("asoftclip applies parameter updates and shifted frame timestamps", async () => {
  const before = await run("asoftclip=type=atan");
  const after = await run("asoftclip=type=atan:param=2");
  assert.deepEqual(await run("asetnsamples=2:0,asetpts=PTS+8,asendcmd=c='0.0015 asoftclip@x param 2',asoftclip@x=type=atan"),
    [...before.slice(0, 4), ...after.slice(4)]);
});

it("asoftclip receives downstream commands after processing the sender's frame", async () => {
  assert.deepEqual(await run("asetnsamples=2:0,asoftclip@x=type=hard,asendcmd=c='0.00025 asoftclip@x output 0.5'"),
    [...Array<number>(4).fill(16000), ...Array<number>(4).fill(8000)]);
});
