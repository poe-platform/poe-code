import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.alloc(32);
for (let index = 8; index < 12; index++) pcm.writeInt16LE(8000, index * 2);
const input = encodeWav({ sampleRate: 8, channels: [Float64Array.from(
  { length: 16 }, (_, index) => pcm.readInt16LE(index * 2) / 32768
)] });
const events = [
  "silence_start: 0",
  "silence_end: 1 | silence_duration: 1",
  "silence_start: 1.5",
  "silence_end: 2 | silence_duration: 0.5"
];

async function run(levelArgs: readonly string[], graph = false) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", input);
  let stderr = "";
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", ...levelArgs, "-i", "/in.wav",
      ...(graph ? ["-filter_complex", "[0:a]silencedetect=d=0.25[out]", "-map", "[out]"]
        : ["-af", "silencedetect=d=0.25"]), "-f", "s16le", "-"],
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
  assert.deepEqual(fs.readFileSync("/in.wav"), Buffer.from(input));
  return { exitCode: result.exitCode, stderr, stdout: Buffer.concat(stdout) };
}

for (const option of ["-v", "-loglevel"]) {
  for (const [level, reports] of [
    ["quiet", false], ["error", false], ["warning", false], ["24", false],
    ["info", true], ["32", true], ["verbose", true], ["", true]
  ] as const) {
    for (const graph of [false, true]) {
      it(`silencedetect respects ${option} ${level || "(default)"} (${graph ? "graph" : "simple"})`, async () => {
        const result = await run(level ? [option, level] : [], graph);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.stdout, pcm);
        assert.equal(result.stderr, reports ? events.join("\n") + "\n" : "");
      });
    }
  }
}

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
for (const level of ["warning", "error", "quiet", "info"]) {
  it(`matches native silencedetect events, status and PCM at ${level}`, { skip: !nativeAvailable }, async () => {
    const native = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", level,
      "-i", "pipe:0", "-af", "silencedetect=d=0.25", "-f", "s16le", "-"], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    assert.deepEqual(native.stdout, pcm);
    const nativeEvents = native.stderr.toString().split("\n")
      .filter(line => line.includes("silence_"))
      .map(line => line.slice(line.indexOf("silence_")));
    assert.deepEqual(nativeEvents, level === "info" ? events : []);
    const result = await run(["-loglevel", level]);
    assert.equal(result.exitCode, native.status);
    assert.deepEqual(result.stdout, native.stdout);
    assert.deepEqual(result.stderr.trim().split("\n").filter(Boolean), nativeEvents);
  });
}
