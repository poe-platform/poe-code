import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, args: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", ...args],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

function source() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
  return volume;
}

for (const [prefix, listedName] of [
  [undefined, "part"],
  ["", "part"],
  ["audio/", "audio/part"],
  ["https://example.com/audio/../", "https://example.com/audio/../part"],
  ['audio,"/', '"audio,""/part']
] as const) {
  it(`prefixes CSV segment entries without changing files (${JSON.stringify(prefix)})`, async () => {
    const volume = source();
    const result = await run(volume, ["-segment_list", "list.csv",
      ...(prefix === undefined ? [] : ["-segment_list_entry_prefix", prefix]), "part%02d.wav"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const quote = prefix === 'audio,"/' ? '"' : "";
    assert.equal(volume.readFileSync("/list.csv", "utf8"),
      `${listedName}00.wav${quote},0.000000,1.024000\n` +
      `${listedName}01.wav${quote},1.024000,2.048000\n` +
      `${listedName}02.wav${quote},2.048000,3.000000\n`);
    assert.deepEqual(volume.readdirSync("/"), ["list.csv", "part00.wav", "part01.wav", "part02.wav", "ramp.wav"]);
    const pcm = [0, 1, 2].map(index =>
      parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), [8192, 8192, 7616]);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("prefixes only the basename of segments written in a subdirectory", async () => {
  const volume = source();
  volume.mkdirSync("/segments");
  const result = await run(volume, ["-segment_list", "list.csv",
    "-segment_list_entry_prefix", "audio/", "segments/part%02d.wav"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.csv", "utf8"),
    "audio/part00.wav,0.000000,1.024000\naudio/part01.wav,1.024000,2.048000\naudio/part02.wav,2.048000,3.000000\n");
  assert.deepEqual(volume.readdirSync("/segments"), ["part00.wav", "part01.wav", "part02.wav"]);
  assert.equal(volume.existsSync("/audio"), false);
});

it("keeps flat list prefixes verbatim", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_list", "list.txt",
    "-segment_list_entry_prefix", 'audio,"/', "part%02d.wav"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.txt", "utf8"),
    'audio,"/part00.wav\naudio,"/part01.wav\naudio,"/part02.wav\n');
  assert.equal(volume.existsSync('/audio,"'), false);
});

it("accepts a segment entry prefix without a list", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_list_entry_prefix", "audio/", "part%02d.wav"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(volume.readdirSync("/"), ["part00.wav", "part01.wav", "part02.wav", "ramp.wav"]);
});

it("rejects a missing segment entry prefix without writes", async () => {
  const volume = source();
  const before = volume.toJSON();
  const result = await run(volume, ["part%02d.wav", "-segment_list_entry_prefix"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("missing segment_list_entry_prefix value"), result.stderr);
  assert.deepEqual(volume.toJSON(), before);
});
