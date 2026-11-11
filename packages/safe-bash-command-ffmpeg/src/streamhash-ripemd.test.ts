import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const frameHashes = {
  "RIPEMD128": "#format: frame checksums\n#version: 2\n#hash: RIPEMD128\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, b7df1798b039f2c9c8f49c569600f487\n0,        512,        512,      512,     1024, 9f56b030c56c97669c767c2c64a2d346\n0,       1024,       1024,      512,     1024, 37d991ae203d76a1500e59e83b3794bd\n0,       1536,       1536,       64,      128, 452fd0df539a21edde6fb9b1feeceff1\n",
  "RIPEMD160": "#format: frame checksums\n#version: 2\n#hash: RIPEMD160\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, 5dd3077f13562818e5abdd337d5dadd851208d70\n0,        512,        512,      512,     1024, 4ac7979c591877c475ea03229cd5807cef524574\n0,       1024,       1024,      512,     1024, 52760b936605ce5634c7a98c5717a0b74dc1217b\n0,       1536,       1536,       64,      128, 79a6e1ff630244b7d9fd590279e764dd2c5edf5b\n",
  "RIPEMD256": "#format: frame checksums\n#version: 2\n#hash: RIPEMD256\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, f7fa4ff738934fce43fbd0a7225a857a2bb02da8031a1b237b0044ebe9ebccfb\n0,        512,        512,      512,     1024, 91747cf1edea187aaef625b48ca1ff08fdc00d5722552bc6e22d6488168a7ba8\n0,       1024,       1024,      512,     1024, 19cca3c17834f4756db53803dae21eb0ea69152edda8f00ed375d544bafbd27d\n0,       1536,       1536,       64,      128, 13b16b26c3e2cb4e2c9b23c411cc11f7af054a5b6ca2654bfa8ac2754d63ed49\n",
  "RIPEMD320": "#format: frame checksums\n#version: 2\n#hash: RIPEMD320\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, ba835b95adef486de55afde82b3f8cd32e9b18b25ee1591edccca0b65574c30db2c367b8e224a397\n0,        512,        512,      512,     1024, 153569a9af786bbf41d266c265b7fe10947537d8935a724ea26a142ef16d482c31c68a0369d9ce50\n0,       1024,       1024,      512,     1024, 00caf6110d6e5a79c1948672583bad11242ec8d776463a339a474b5faaa6b6712e356fc617d57d34\n0,       1536,       1536,       64,      128, fe0478190dc7c4cbd80b11429a87337f68c45cd78ae17aab3617dc47d4abb37ef74c276484cbccd6\n",
  "MD5": "#format: frame checksums\n#version: 2\n#hash: MD5\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, 4474d5257d6b52e4e32b64f59a7ba91d\n0,        512,        512,      512,     1024, a7e807c7b8072078e57c8d0d6f194d26\n0,       1024,       1024,      512,     1024, 135348d1dc98d5e637259a43131c5ca8\n0,       1536,       1536,       64,      128, a9a2b1694e81e77ecb1e8abd252484b7\n",
  "SHA160": "#format: frame checksums\n#version: 2\n#hash: SHA160\n#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n#stream#, dts,        pts, duration,     size, hash\n0,          0,          0,      512,     1024, cb922e68d61eee0c27978dea12f36d097ad522f6\n0,        512,        512,      512,     1024, 6d7a2ffc7725f24a5664f9b5d8d112374c1494de\n0,       1024,       1024,      512,     1024, e2eb158b5f6eb42b14101bb6ebeeea7adf223020\n0,       1536,       1536,       64,      128, c4945209628e0da7d687e54d93cdb66ba4c67250\n"
};

for (const [algorithm, expected] of [
  ["RIPEMD128", "RIPEMD128=1fbf820beddc425c2fbf5b4f79a2753a"],
  ["RIPEMD160", "RIPEMD160=34a4f135c6409b448d2f5016c3f11d57135e5495"],
  ["RIPEMD256", "RIPEMD256=4655dcc6aeef0bd33d1be62fa424fbfc914892a917f7385d4954ae703233811a"],
  ["RIPEMD320", "RIPEMD320=83068da2b90ffe4c5c99f292313aa7ccedf53b332c778591378a8a1495e15983285283372101c337"],
  ["MD5", "MD5=2a320c6bc5da2cb4754423cad7b4ce18"],
  ["SHA160", "SHA160=7f3c7d30165a5e3d9c9b0ffe3034308f02253b1b"],
  ["unknown", undefined]
] as const) {
  for (const spelling of [algorithm, algorithm.toLowerCase(), algorithm.slice(0, 2).toLowerCase() + algorithm.slice(2)]) {
    for (const format of ["streamhash", "hash", "framehash"]) {
      for (const target of ["-", "/digest.txt"]) {
        it(`${format} ${spelling} to ${target} matches native FFmpeg`, async () => {
          const volume = Volume.fromJSON({ "/digest.txt": "keep" });
          // Mono 8 kHz PCM16 fixture, verified against FFmpeg 7.0.2.
          volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 1600 }, (_, i) => (i * 8 - 6000) / 32768)] }));
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-i", "/in.wav", "-hash", spelling, "-f", format, target],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (expected === undefined) {
            assert.equal(result.exitCode, 234);
            assert.ok(stderr.includes("Unknown hash algorithm 'unknown'"), stderr);
            assert.equal(volume.readFileSync("/digest.txt", "utf8"), target === "-" ? "keep" : "");
            assert.equal(stdout, "");
          } else {
            assert.equal(result.exitCode, 0, stderr);
            assert.equal(stderr, "");
            const actual = target === "-" ? stdout : volume.readFileSync(target, "utf8");
            assert.equal(actual, format === "framehash" ? frameHashes[algorithm]
              : `${format === "streamhash" ? "0,a," : ""}${expected}\n`);
            if (target !== "-") assert.equal(stdout, "");
          }
        });
      }
    }
  }
}
