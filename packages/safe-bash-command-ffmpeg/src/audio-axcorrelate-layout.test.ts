import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 PCM16 output for interleaved square waves. Hash every output
// sample, including EOF padding, and separately verify the negotiated layout.
for (const [first, second, channels, mask, hash] of [
  ["mono", "quad", 1, 4, "a506a0936a0393cdaf133e6ade6972656b8bee336ca7f53db6b36cb093f95efb"],
  ["quad", "mono", 4, 0x33, "dbb17d37134a8fdcb1f0b6024afd469a1c695258bdc1c135d87e0d5ea05e91ce"],
  ["mono", "7.1", 1, 4, "b6337f9f9fd194799fc0c6ef6113bf62b699149a2c12897e8d944c6eb5e18fa0"],
  ["mono", "5.1(side)", 1, 4, "0e09bd5f1158a6093add9ad46789b53b7e0d55440b4795c12fe9b736f1bd739f"],
  ["5.1", "5.1(side)", 6, 0x3f, "feb19b98b04c6cfdcbff5c149c1557be735c2f4dc0369adb93fc624315bcfde8"],
  ["mono", "mono", 1, 4, "1a20a8f887c9ab033911e338adbf72cc9176e5efafafdc4e8f07022e04e5d01d"],
  ["quad", "quad", 4, 0x33, "9f6246e922df8263d53764147198d9bf50a3b37c5cbf56fedcda8076c68fa27d"],
  ["7.1", "7.1", 8, 0x63f, "c0f9a38d0ee236edcbee89b719bcb8e36166c3c11370b68baed44a1c0eb50f1e"],
  ["mono", "stereo", 1, 4, "90a43fc7f08078f1a5195d75cbc1cb2ee6789fee1841812a3f6a7545dc345dd5"]
] as const) {
  it(`axcorrelate remixes ${second} to ${first} with native output samples`, async () => {
    const fs = Volume.fromJSON({});
    for (const [j, count] of [504, 4800].entries()) {
      const bytes = Buffer.alloc(count * 2);
      for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.floor(i / (3 + j)) % 2 ? 8192 : -8192, i * 2);
      fs.writeFileSync(j === 0 ? "/a.raw" : "/b.raw", bytes);
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", first, "-i", "/a.raw",
        "-f", "s16le", "-ar", "8000", "-ch_layout", second, "-i", "/b.raw",
        "-filter_complex", "[0:a][1:a]axcorrelate=size=32:algo=fast[out]", "-map", "[out]",
        "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, channels);
    assert.equal(audio.channelMask, channels === 1 ? undefined : mask);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length * channels, 504);
    const pcm = Buffer.alloc(1008);
    for (let i = 0; i < 504; i++) {
      pcm.writeInt16LE(audio.channelData[i % channels]![Math.floor(i / channels)]! * 32768, i * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
