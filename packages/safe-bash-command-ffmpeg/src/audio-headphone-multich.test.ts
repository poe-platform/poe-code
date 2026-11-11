import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(options: string, responseChannels = 4, separate = false, empty = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  const program = Array.from({ length: 12 }, (_, i) => [5000 + i * 71, -1000 + i * 53]);
  const impulse = empty ? [] : [[16384, 0, 0, 8192], [0, 4096, 2048, 0], [0, 0, 0, 0]];
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(channel => Float64Array.from(program, frame => frame[channel]! / 32768)) }));
  const responses = Array.from({ length: responseChannels }, (_, channel) =>
    Float64Array.from(impulse, frame => (frame[channel] ?? 16384) / 32768));
  for (const [index, channels] of (separate ? [responses.slice(0, 2), responses.slice(2, 4)] : [responses]).entries()) {
    volume.writeFileSync(`/ir${index}.wav`, encodeWav({ sampleRate: 8000, channels }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", "-i", "/ir0.wav", ...(separate ? ["-i", "/ir1.wav"] : []),
      "-filter_complex", `[0:a][1:a]${separate ? "[2:a]" : ""}headphone=${options}[o]`,
      "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, output: volume.readFileSync("/out.pcm") as Buffer, error: Buffer.concat(errors).toString() };
}

for (const type of ["time", "freq"]) {
  for (const hrir of ["multich", "1"]) {
    it(`headphone ${type} reads packed response pairs with hrir=${hrir}`, async () => {
      const { result, output, error } = await render(`map=FL|FR:hrir=${hrir}:type=${type}`);
      assert.equal(result.exitCode, 0, error);
      assert.equal(error, "");
      // Native FFmpeg 7.0.2, four-channel signed 16-bit WAV at 8000 Hz.
      assert.equal(output.toString("hex"),
        "e50483ffd704c300eb04ce00fe04d9001205e4002505ef003905fa004c0505016005100173051b01870526019a053101");
    });
  }

  for (const map of ["FL|FR", "FR|FL"]) {
    it(`headphone ${type} packed ${map} matches separate response pairs with gain`, async () => {
      const packed = await render(`map=${map}:hrir=multich:type=${type}:gain=6`, 6);
      const separate = await render(`map=${map}:type=${type}:gain=6`, 4, true);
      assert.equal(packed.result.exitCode, 0, packed.error);
      assert.equal(separate.result.exitCode, 0, separate.error);
      assert.deepEqual(packed.output, separate.output);
    });
  }
}

for (const [hrir, channels, separate, empty] of [
  ["multich", 2, false, false],
  ["multich", 3, false, false],
  ["multich", 4, true, false],
  ["multich", 4, false, true],
  ["stereo", 4, false, false],
  ["bad", 4, false, false]
] as const) {
  it(`headphone rejects invalid packed inputs ${[hrir, channels, separate, empty].join("/")}`, async () => {
    const { result, output } = await render(`map=FL|FR:hrir=${hrir}`, channels, separate, empty);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}
