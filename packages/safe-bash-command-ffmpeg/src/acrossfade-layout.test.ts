import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 references: remix the second input before the S16 fade.
for (const reverse of [false, true]) {
  it(`acrossfade negotiates mono/stereo inputs, reverse=${reverse}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, values] of [["mono", [12000]], ["stereo", [-4000, 8000]]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: values.map(value => new Float64Array(1000).fill(value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", reverse ? "/stereo.wav" : "/mono.wav",
        "-i", reverse ? "/mono.wav" : "/stereo.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=4[o]", "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, reverse ? 2 : 1);
    const transitions = reverse ? [[-3000, 121, 3242, 6363], [6000, 6121, 6242, 6363]]
      : [[9000, 6500, 4000, 1500]];
    for (const [channel, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, 1996);
      assert.deepEqual(Array.from(samples, value => value * 32768), [
        ...Array(996).fill(reverse ? [-4000, 8000][channel] : 12000),
        ...transitions[channel]!, ...Array(996).fill(reverse ? 8485 : 2000)
      ]);
    }
  });
}

// FFmpeg 7.0.2 references for distinct constant values in every speaker.
for (const [first, second, hash] of [
  [1, 6, "d2284aa21f69d06cc77561cbfbffb2c5910b2ae19d9c3830afc04e25d8d329ad"],
  [2, 6, "2f57154aa88868daf7edf21c1107b0fcffc40d282aec9995b821afb52a76d996"],
  [6, 1, "fbde00ea1a72d4f3c4fec5699f077bdbe001d7617884b56c3232693ffd9780e4"],
  [6, 2, "7e38028faed1e58dde9997078e131b1de8e9cd55dd6a0d93af14ba8a12aad0c1"],
  [1, 2, "706d9c7e57992786954f468723d8161de126083c815991c2c4128fe76390c04a"],
  [2, 1, "367ba760e79f14f43b9bd70e38c0a0bdb80ffb834611b62b7f25412c1a971bfc"],
  [6, 6, "98725a1cf3018f211f5da13691dd87fd2ab06e021827bceb93ac20f478425012"]
] as const) for (const channelMask of first === 6 || second === 6 ? [undefined, 0x3f, 0x60f] : [undefined]) {
  it(`acrossfade matches native PCM for ${first} then ${second} channels, mask=${channelMask}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    for (const [index, channels] of [first, second].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        ...(channels === 6 && channelMask !== undefined ? { channelMask } : {}),
        channels: Array.from({ length: channels }, (_, channel) =>
          new Float64Array(20).fill((channel + 1) * (index === 0 ? 1000 : 300) / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=4[o]", "-map", "[o]", "-f", "s16le", "/out.raw"],
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 36 * first * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
