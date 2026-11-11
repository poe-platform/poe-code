import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");

async function run(inputOptions: string[], outputOptions: string[]) {
  const volume = new Volume();
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", ...inputOptions,
      "-i", "pipe:0", ...outputOptions, "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(),
    stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(stdout);
}

for (const name of ["-ch_layout", "-channel_layout"]) {
  for (const selector of ["", ":a", ":a:0", ":0", ":v", ":a:1", ":1"]) {
    const option = name + selector;
    it(`uses ${option} stereo for raw input and extracts the right channel`, async () => {
      const output = await run([option, "stereo"], ["-af", "channelsplit=stereo:FR"]);
      // Native FFmpeg 7.0.2: six right-channel samples from the interleaved PCM.
      assert.equal(output.toString("hex"), "4ff88df8cbf809f947f985f9");
    });

    it(`decodes raw stereo input with ${option} synchronously`, () => {
      const volume = new Volume();
      volume.writeFileSync("/in.raw", input);
      const result = evalSyncFfmpeg(
        ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", option, "stereo",
          "-i", "/in.raw", "/out.wav"], undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }
      );
      assert.equal(result, "");
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
        [Array.from({ length: 6 }, (_, i) => input.readInt16LE(i * 4)),
          Array.from({ length: 6 }, (_, i) => input.readInt16LE(i * 4 + 2))]);
    });

    it(`accepts ${option} mono on raw mono output without changing PCM`, async () => {
      assert.deepEqual(await run([], [option, "mono"]), input);
    });

    if (["", ":a", ":a:0", ":0"].includes(selector)) {
      it(`applies matching output ${option} mono to stereo audio`, async () => {
        const output = await run([name, "stereo"], [option, "mono"]);
        assert.equal(output.length, input.length / 2);
        assert.deepEqual(output, await run([name, "stereo"], [name, "mono"]));
      });
    }

    if ([":v", ":a:1", ":1"].includes(selector)) {
      it(`ignores unmatched output ${option} mono on stereo audio`, async () => {
        assert.deepEqual(await run([name, "stereo"], [option, "mono"]), input);
      });
    }
  }
}
