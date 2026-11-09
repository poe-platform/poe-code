import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: -filter_complex '[0:a][1:a]FILTER[o]' -map '[o]' -c:a CODEC out.wav
// Hashes cover all 512 interleaved PCM16 samples, decoded with -f s16le.
for (const [filter, hash, frame, expectedPcm, expectedFloat] of [
  ["sidechaingate=range=0", "f39dd688bb8a99529b3e7c79e699cbb1d3b181c33367bdee6e627db9798250d5", 64, 13, 0.00038146972656250005],
  ["sidechaingate=mode=upward", "d4496cadbd1ee524305642b4a09819bd0e9a4c2bc1b454ac9010c8de0bedad78", 187, 25083, 0.7654571752169248],
  ["sidechaingate", "d1124c506ab62447b3a6705a136c427f6320a9fc590d607846c0de37c168e21d", 64, 490, 0.01495361328125],
  ["sidechaingate=range=0:knee=1", "455ca8c61d1c826d0233f872d35daec4be27431779c69649f4d35259f1816907", 64, 13, 0.00038146972656250005],
  ["sidechaingate=mode=upward:knee=1", "45afa621751808596da0c72ee5f0172cb3023928f4c9318153db5f0a57c2adf2", 64, 8000, 0.244140625],
  ["sidechaingate=range=0:detection=peak", "84bedef45d6b8679425d600701f15e828c9dac63f73354252841418d3099c154", 64, 50, 0.0015258789062500004],
  ["sidechaingate=mode=upward:detection=peak", "f4c8a4596cb101807a27c34cc2c5945dc718436899831c89549f0df588df35fb", 64, 8000, 0.244140625],
  ["sidechaingate=ratio=1", "debf273ae6462fcbeb0759dc86d743bd19b253183129672ba4b1c95ec2049294", 64, 8000, 0.244140625]
] as const) {
  for (const codec of ["pcm_s16le", "pcm_f64le"]) {
    it(`${filter} preserves native rounding with ${codec}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/main.wav", encodeWav({ sampleRate: 8000, channels: [
        new Float64Array(256).fill(8000 / 32768), new Float64Array(256).fill(-4000 / 32768)
      ] }));
      volume.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 256 }, (_, i) => [0, 2048, 16384, 1000][Math.floor(i / 64)]! / 32768),
        new Float64Array(256)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/main.wav", "-i", "/key.wav", "-filter_complex", `[0:a][1:a]${filter}[o]`, "-map", "[o]", "-c:a", codec, "/out.wav"],
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
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 256);
      assert.equal(audio.channelData[1]!.length, 256);
      if (codec === "pcm_f64le") {
        assert.equal(audio.channelData[0]![frame], expectedFloat);
      } else {
        assert.equal(audio.channelData[0]![frame]! * 32768, expectedPcm);
        const pcm = Buffer.alloc(512 * 2);
        for (let i = 0; i < 256; i++) {
          for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, (i * 2 + c) * 2);
        }
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      }
    });
  }
}
