import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: [
    Float64Array.from({ length: 32 }, (_, i) => (701 * i - 12400) / 32768),
    Float64Array.from({ length: 32 }, (_, i) => (11000 - 537 * i) / 32768)
  ]
});

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2 PCM16 hashes cover every sample, including pre-command history.
  for (const [filter, digest, frame8] of [
    ["crossfeed", "97a17b98a1ac8b3c8273cd251e3176b95570a60f8cf7e91c12af536310d3fa14", [-2859, 2779]],
    ["crossfeed=strength=0.8", "407150dd9ce2d7e7a23ff2abbd0d6bfcf82c457ebda4c391018fbcea49de17f6", [-273, 194]],
    ["asendcmd=c='0.001 crossfeed strength 0.8',crossfeed", "1b55616e9cfb0f9524cb8383db8a268a81ba32a33285d2c3c4d4360cb2cc113a", [-401, 322]],
    ["asendcmd=c='0.001 crossfeed@edit strength 0.8',crossfeed@edit", "1b55616e9cfb0f9524cb8383db8a268a81ba32a33285d2c3c4d4360cb2cc113a", [-401, 322]],
    ["asendcmd=c='0.0005 crossfeed strength 0.8',crossfeed", "1b55616e9cfb0f9524cb8383db8a268a81ba32a33285d2c3c4d4360cb2cc113a", [-401, 322]],
    ["asendcmd=c='0 crossfeed strength 0.8',crossfeed", "407150dd9ce2d7e7a23ff2abbd0d6bfcf82c457ebda4c391018fbcea49de17f6", [-273, 194]],
    ["asendcmd=c='0.001 crossfeed@other strength 0.8',crossfeed@edit", "97a17b98a1ac8b3c8273cd251e3176b95570a60f8cf7e91c12af536310d3fa14", [-2859, 2779]],
    ["asendcmd=c='0.001 crossfeed strength 0.8;0.002 crossfeed strength 0.2',crossfeed", "edc85342bf0d2eac17d03f889a2b8441432e5ed906806cf7acf9c646cff32e84", [-401, 322]],
    ["asendcmd=c='0.001 crossfeed strength 0.8;0.002 crossfeed strength -1;0.002 crossfeed strength 2;0.002 crossfeed strength NaN;0.002 crossfeed strength invalid',crossfeed", "1b55616e9cfb0f9524cb8383db8a268a81ba32a33285d2c3c4d4360cb2cc113a", [-401, 322]],
    ["asendcmd=c='0.001 crossfeed strength 0.8;0.002 crossfeed level_out 0.5',crossfeed", "0cfba70a91a867014a29e8942fe67e8dd002db5acbbf8915895e0c47ebb1fd03", [-401, 322]],
    ["asetpts=PTS+8000,asendcmd=c='1.001 crossfeed strength 0.8',crossfeed", "1b55616e9cfb0f9524cb8383db8a268a81ba32a33285d2c3c4d4360cb2cc113a", [-401, 322]],
    ["asendcmd=c='0.001 crossfeed strength 0.8',crossfeed=enable='gte(t,0.002)'", "1f1e2f85d117638eb2bf9e423a516fa6fa40f4c97dd3ed217498956b02320526", [-6792, 6704]],
    ["asendcmd=c='0.001 crossfeed strength 0.8',crossfeed=block_size=8", "19d2c31181dd68d6c5ecf5170bd2027c7decc9539f181930ab03d0c0a205a003", [-64, -15]],
    ["asendcmd=c='0.001 crossfeed strength 0.8',crossfeed=block_size=16", "19d2c31181dd68d6c5ecf5170bd2027c7decc9539f181930ab03d0c0a205a003", [-64, -15]],
  ] as const) {
    it(`scheduled crossfeed strength (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const chain = `asetnsamples=n=8:p=0,${filter}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channels, 2);
      assert.equal(audio.channelData[0]!.length, 32);
      assert.equal(audio.channelData[1]!.length, 32);
      const pcm = Buffer.alloc(32 * 4);
      for (let i = 0; i < 32; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
      }
      assert.deepEqual([pcm.readInt16LE(8 * 4), pcm.readInt16LE(8 * 4 + 2)], frame8);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
    });
  }
}
