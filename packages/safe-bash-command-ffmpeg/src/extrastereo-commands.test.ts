import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/extrastereo-commands.wav", import.meta.url));
const channels = parseWav(input).tracks[0]!.decodedAudio!.channelData;

for (const graph of [false, true]) {
  for (const [filter, swappedFrom, swappedUntil] of [
    ["extrastereo=m=1", 1024, 1024],
    ["extrastereo=m=-1", 0, 1024],
    ["asendcmd=c='0.064 extrastereo@mix m -1',extrastereo@mix=m=1", 512, 1024],
    ["asendcmd=c='0.064 extrastereo@mix m -PI/PI',extrastereo@mix=m=1", 512, 1024],
    ["asendcmd=c='0 extrastereo@mix m -1',extrastereo@mix=m=1:enable=n", 512, 1024],
    ["asendcmd=c='0.064 extrastereo@other m -1',extrastereo@mix=m=1", 1024, 1024],
    ["asendcmd=c='0.064 extrastereo m -1',extrastereo@mix=m=1", 512, 1024],
    ["asendcmd=c='0.064 extrastereo@mix m -1',extrastereo@other=m=1,extrastereo@mix=m=1", 512, 1024],
    ["asendcmd=c='0.064 extrastereo m -1',extrastereo@mix=m=1,extrastereo@other=m=1", 512, 1024],
    ["asendcmd=c='0.065 extrastereo@mix m -1',extrastereo@mix=m=1", 1024, 1024],
    ["asetnsamples=200:p=0,asendcmd=c='0.064 extrastereo@mix m -1',extrastereo@mix=m=1", 600, 1024],
    ["asetnsamples=200:p=0,asetpts=PTS+8000,asendcmd=commands='1.025 [enter] extrastereo@mix m -2/2;1.075 extrastereo@mix m 1',extrastereo@mix=m=1", 200, 600],
    ["asetnsamples=200:p=0,asendcmd=c='0 extrastereo@mix m -1;0.025 extrastereo@mix m 11;0.05 extrastereo@mix m invalid;0.075 extrastereo@mix m 1',extrastereo@mix=m=1", 0, 600]
  ] as const) {
    it(`scheduled stereo width (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
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
      for (let c = 0; c < 2; c++) {
        assert.equal(audio.channelData[c]!.length, 1024);
        for (let i = 0; i < 1024; i++) {
          const source = i >= swappedFrom && i < swappedUntil ? 1 - c : c;
          assert.equal(audio.channelData[c]![i], channels[source]![i], `channel ${c}, sample ${i}`);
        }
      }
    });
  }
}
