import assert from "node:assert/strict";
import { it } from "node:test";
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
