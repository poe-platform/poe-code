import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: -hide_banner -nostats -y -v info -i stereo.wav -af astats -c:a pcm_s16le out.wav
const nativeReport = `Channel: 1
DC offset: 0.054689
Min level: -4096.000000
Max level: 8192.000000
Min difference: 0.000000
Max difference: 12288.000000
Mean difference: 4609.750855
RMS difference: 6145.208805
Peak level dB: -12.040935
RMS level dB: -17.490106
RMS peak dB: -16.386257
RMS trough dB: -21.506642
Crest factor: 1.872658
Flat factor: 0.000000
Peak count: 768
Abs Peak count: 384
Noise floor dB: -30.102734
Noise floor count: 512
Entropy: 0.148944
Bit depth: 3/5/6/5
Dynamic range: 24.082400
Zero crossings: 769
Zero crossings rate: 0.375488
Channel: 2
DC offset: -0.371105
Min level: -16384.000000
Max level: 512.000000
Min difference: 0.000000
Max difference: 16896.000000
Mean difference: 8.254030
RMS difference: 373.443564
Peak level dB: -6.020335
RMS level dB: -7.268309
RMS peak dB: -6.114698
RMS trough dB: -11.662427
Crest factor: 1.154513
Flat factor: 61.229050
Peak count: 2048
Abs Peak count: 1536
Noise floor dB: -36.123334
Noise floor count: 512
Entropy: 0.062406
Bit depth: 2/3/7/3
Dynamic range: 36.123599
Zero crossings: 1
Zero crossings rate: 0.000488
Overall
DC offset: -0.371105
Min level: -16384.000000
Max level: 8192.000000
Min difference: 0.000000
Max difference: 16896.000000
Mean difference: 2309.002443
RMS difference: 4353.335006
Peak level dB: -6.020335
RMS level dB: -9.884384
RMS peak dB: -6.114698
RMS trough dB: -21.506642
Flat factor: 58.465823
Peak count: 1408.000000
Abs Peak count: 960.000000
Noise floor dB: -30.102734
Noise floor count: 512.000000
Entropy: 0.105675
Bit depth: 5/6/7/6
Number of samples: 2048
`;

for (const filter of ["astats", "astats=", "astats=metadata=0:reset=0", "astats@levels", "astats@levels="]) {
  it(`matches the complete native stereo report and preserves all PCM: ${filter}`, async () => {
    const channels = [
      Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? [8192, -4096, 0, 4096][i % 4]! : 1024) / 32768),
      Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? -16384 : 512) / 32768)
    ];
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/stereo.wav", encodeWav({ sampleRate: 8000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/stereo.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.equal(stderr, nativeReport);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
  });
}

for (const filter of ["astats", "astats="]) {
  it(`preserves native raw PCM and final measurements for silence followed by a constant: ${filter}`, async () => {
    const volume = Volume.fromJSON({});
    const samples = new Float64Array(2400);
    samples.fill(0.5, 2000);
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", filter, "-f", "s16le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length, 4800);
    // Native FFmpeg 7.0.2 output for 2000 silent samples followed by 400 samples at 16384.
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
    const overall = stderr.split("Overall\n")[1]!;
    for (const measurement of ["Abs Peak count: 400.000000", "Bit depth: 1/1/2/1", "Number of samples: 2400"]) {
      assert.ok(overall.split("\n").includes(measurement), stderr);
    }
  });
}
