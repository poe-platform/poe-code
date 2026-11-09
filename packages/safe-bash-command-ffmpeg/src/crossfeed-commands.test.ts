import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/crossfeed-commands.wav", import.meta.url));

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2 PCM16 hashes for the 8 kHz stereo fixture.
  for (const [filter, digest] of [
    ["crossfeed@x", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
    ["crossfeed@x=level_out=0", "34fa1826a0a171d2579b65040894c503d1bfc945f90690b95a979dd136dd0dfd"],
    ["asendcmd=c='0.064 crossfeed@x level_out 0',crossfeed@x", "97aa5ee0bd522bda3ee55d03e9658da0d4504bdddb8de8db398fbd8da9a5843b"],
    ["asendcmd=c='0.064 crossfeed@y level_out 0',crossfeed@x", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
    ["asendcmd=c='0.064 crossfeed level_out 0',crossfeed@x", "97aa5ee0bd522bda3ee55d03e9658da0d4504bdddb8de8db398fbd8da9a5843b"],
    ["asendcmd=c='0.065 crossfeed@x level_out 0',crossfeed@x", "34cc441a199107d6a64e5c29ceb70ae09b9617762b7ae82f655e7e7df1b66f1b"],
    ["asetnsamples=200:p=0,asendcmd=c='0.064 crossfeed@x level_out 0',crossfeed@x", "f58d08cf71bb680c637686618f08cdf441390302aa214b0609ca6db8f352c6fc"],
    ["asetpts=PTS+8000,asendcmd=commands='1.064 [enter] crossfeed@x level_out 0;1.128 crossfeed@x level_out 1/2',crossfeed@x", "48afbabed4fa076a3bf99d3e3edb99de7b6aacb29681ebc4eae28066a463bf32"],
    ["asendcmd=c='0 crossfeed@x level_out 0;0.064 crossfeed@x level_out 1',crossfeed@x", "a00f987cfd76856f453e5a5a88bb16496eac26d9b4b74353f6b4bd7f41f62574"],
    ["asendcmd=c='0.064 crossfeed@x level_out 0.5;0.064 crossfeed@x level_out invalid;0.128 crossfeed@x level_out 2',crossfeed@x", "c563bbec367c65f14df274d71c4f9af1f2670ddddc2ea2d1aea9ecd5a9fd4f26"],
    ["asendcmd=c='0.064 crossfeed@x level_out -1;0.128 crossfeed@x level_out 0',crossfeed@x", "34cc441a199107d6a64e5c29ceb70ae09b9617762b7ae82f655e7e7df1b66f1b"],
    ["asendcmd=c='0.064 crossfeed@x level_out 0.5',crossfeed@y,crossfeed@x", "19298218b7bd961ea63b4f1ef95a4fc55740bd16d0eb5c4a1609ac5e1b0184e4"],
    ["asendcmd=c='0.064 crossfeed level_out 0.5',crossfeed@y,crossfeed@x", "16b32d282e80c93194507e14bb44be8a9b104d5b135dd943f3234aca262b8627"],
    ["asendcmd=c='0.064 crossfeed@x level_out 0.5;0.128 volume@v volume 0.5',crossfeed@x,volume@v=1", "5d884ff64403c3260ce766161c95993e9043d8fd11e59a540c8e014eec8bd30c"],
  ] as const) {
    it(`scheduled crossfeed gain (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channelData[0]!.length, 1100);
      assert.equal(audio.channelData[1]!.length, 1100);
      const pcm = Buffer.alloc(1100 * 4);
      for (let i = 0; i < 1100; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
      if (filter === "asendcmd=c='0.064 crossfeed@x level_out 0',crossfeed@x") {
        assert.equal(pcm.readInt16LE(0), 12214);
        assert.equal(pcm.readInt16LE(2), 1286);
        assert.equal(pcm.readInt16LE(511 * 4), -1590);
        assert.equal(pcm.readInt16LE(511 * 4 + 2), 1590);
        assert.ok(pcm.subarray(512 * 4).every(byte => byte === 0));
      }
    });
  }
}
