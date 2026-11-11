import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output, with equal-power rematrixing before multiplication.
for (const reverse of [false, true]) {
  for (const stereoLength of [64, 128, 256]) {
    it(`amultiply remixes to the first input layout, reverse=${reverse}, stereo frames=${stereoLength}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/mono.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 128 }, (_, i) => [2000, 4000, -6000, 8000][i % 4]! / 32768)] }));
      volume.writeFileSync("/stereo.wav", encodeWav({ sampleRate: 8000,
        channels: [8000, -16000].map(value => new Float64Array(stereoLength).fill(value / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", reverse ? "/stereo.wav" : "/mono.wav",
          "-i", reverse ? "/mono.wav" : "/stereo.wav",
          "-filter_complex", "[0:a][1:a]amultiply[out]", "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
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
      const expected = reverse ? [[345, 691, -1036, 1381], [-691, -1381, 2072, -2762]]
        : [[-345, -691, 1036, -1381]];
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.deepEqual(Array.from(samples, sample => sample * 32768),
          Array.from({ length: Math.min(128, stereoLength) }, (_, i) => expected[channel]![i % 4]));
      }
    });
  }
}

// Native PCM fixtures also distinguish individual speaker gains and silent upmix channels.
for (const [first, second, expected] of [
  ["pan=quad|c0=c0|c1=c0|c2=c0|c3=c0", "anull", "16001600000000005600560000000000c200c2000000000059015901000000001b021b0200000000090309030000000021042104000000006505650500000000d406d406000000006e086e0800000000330a330a00000000230c230c00000000"],
  ["anull", "pan=3.0|c0=c0|c1=-1*c0|c2=0.5*c0", "0f003d008900f4007d012502ec02d103d404f60536079508"],
  ["anull", "pan=quad|c0=c0|c1=-1*c0|c2=0.5*c0|c3=0.25*c0", "0b002e006700b7001e019c013102dc029f03780469057006"],
  ["anull", "pan=3.0|c0=c0|c1=c0|c2=c0", "4a00270197029b0432075c0a1a0e6b125017c81cd3227129"],
  ["pan=3.0|c0=c0|c1=c0|c2=c0", "anull", "000000001f00000000007a0000000000130100000000e80100000000fb02000000004b0400000000d70500000000a10700000000a80900000000ec0b000000006d0e000000002b11"],
  ["anull", "pan=quad|c0=c0|c1=c0|c2=c0|c3=c0", "4a00270197029b0432075c0a1a0e6b125017c81cd3227129"],
  ["pan=3.0|c0=c0|c1=c0|c2=c0", "pan=3.0|c0=c0|c1=c0|c2=c0", "1f001f001f007a007a007a00130113011301e801e801e801fb02fb02fb024b044b044b04d705d705d705a107a107a107a809a809a809ec0bec0bec0b6d0e6d0e6d0e2b112b112b11"]
]) {
  it(`amultiply native PCM parity: ${first} then ${second}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] }));
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]${first}[a];[y]${second}[b];[a][b]amultiply,anull[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
