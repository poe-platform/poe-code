import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mask of [3, 12]) for (const channels of [0, 1, 2, 6]) for (const filter of ["", "simple", "graph"]) {
  if (channels === 0 && !filter) continue;
  it(`routes two-channel mask ${mask} to ${channels} channels, extrastereo=${filter}`, async () => {
    // Extensible PCM16 WAV: stereo or center plus LFE.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [[12000, 0], [0, 12000], [20000, -10000]];
    const input = Buffer.alloc(header.length + frames.length * 4);
    input.set(header);
    input.writeUInt16LE(2, 22);
    input.writeUInt32LE(32000, 28);
    input.writeUInt16LE(4, 32);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(filter === "graph" ? ["-filter_complex", "[0:a]extrastereo=m=1[s]", "-map", "[s]"] : filter ? ["-af", "extrastereo=m=1"] : []), ...(channels ? ["-ac", String(channels)] : []), "/out.wav"],
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
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, channels || 2);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    const stereo = mask === 3 || filter;
    if (channels === 0 || channels === 2) assert.equal(audio.channelMask ?? 3, 3);
    if (channels === 6) assert.equal(audio.channelMask, 0x3f);
    // Native FFmpeg reference samples: center routes at unity to mono/FC,
    // at sqrt(1/2) to stereo; LFE contributes only to an LFE output.
    const expected = frames.flatMap(([center, lfe]) => {
      const left = mask === 3 ? center! : Math.round(center! * Math.SQRT1_2);
      const right = mask === 3 ? lfe! : left;
      if (channels === 1) return [stereo ? Math.round((left + right) / 2) : center!];
      if (channels === 0 || channels === 2) return [left, right];
      return stereo ? [left, right, 0, 0, 0, 0] : [0, 0, center!, lfe!, 0, 0];
    });
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)), expected);
  });
}
