import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mask of [0x3f, 0x60f]) for (const level of [undefined, "0", "0.5", "1", "2", "-0.5", "bad", "1001"]) for (const form of ["option", "rematrix_volume"]) {
  const options = level === undefined ? [] : form === "option" ? ["-rematrix_volume", level] : ["-af", `aresample=${form}=${level}`];
  it(`scales remix into mono for mask ${mask} with ${options.join(" ")}`, async () => {
    // Native FFmpeg extensible PCM16 WAV header; channel order FL, FR, FC, LFE, surrounds.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [12000, -12000].flatMap(level =>
      Array.from({ length: 6 }, (_, active) => Array.from({ length: 6 }, (_, c) => c === active ? level : 0)));
    const input = Buffer.alloc(header.length + frames.length * 12);
    input.set(header);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-ac", "1", ...options, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (level === "bad" || level === "1001") {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /between -1000 and 1000/);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 1);
    assert.equal(audio.channelMask ?? 4, 4);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    // Native FFmpeg PCM16 reference in FL, FR, FC, LFE, BL/SL, BR/SR order.
    const expected = level === "-0.5" ? [16971, 16971, 24000, 0, 12000, 12000]
        : level === "0.5" ? [1243, 1243, 1757, 0, 879, 879]
        : level === "2" ? [4971, 4971, 7029, 0, 3515, 3515]
          : [2485, 2485, 3515, 0, 1757, 1757];
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      [...expected, ...expected.map(value => value === 0 ? 0 : -value)]);
  });
}
