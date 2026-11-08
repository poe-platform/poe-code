import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const copy of [false, true]) {
  for (const values of [[], ["0"], ["1"], ["0", "1"], ["2"], ["bad"]]) {
    it(`preserves side surround with write_channel_mask=${values.join(",") || "default"}, copy=${copy}`, async () => {
      // Extensible PCM16, 8000 Hz, FL/FR/FC/LFE/SL/SR, matching the native fixture.
      const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010000f0600000100000000001000800000aa00389b7164617461ffffffff", "hex");
      const samples = Array.from({ length: 120 }, (_, i) => (i % 6 + 1) * 100);
      const input = Buffer.alloc(header.length + samples.length * 2);
      input.set(header);
      samples.forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const outputs = values.length ? values : [undefined];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...outputs.flatMap((value, i) => [
          ...(copy ? ["-c", "copy"] : []),
          ...(value === undefined ? [] : ["-write_channel_mask", value]), `/out${i}.wav`
        ])],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (values.includes("2") || values.includes("bad")) {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes("invalid write_channel_mask value"), stderr);
        assert.equal(volume.existsSync("/out0.wav"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      outputs.forEach((_, i) => {
        const output = volume.readFileSync(`/out${i}.wav`) as Buffer;
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(output.readUInt16LE(20), 0xfffe);
        assert.equal(audio.channelMask, 0x60f);
        assert.equal(audio.channels, 6);
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channelData[0]!.length, 20);
        assert.deepEqual(Array.from({ length: 20 }, (_, frame) =>
          audio.channelData.map(channel => channel[frame]! * 32768)).flat(), samples);
      });
    });
  }
}
