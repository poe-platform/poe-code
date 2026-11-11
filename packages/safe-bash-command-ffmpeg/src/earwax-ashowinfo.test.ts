import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/earwax-ashowinfo.wav", import.meta.url));

// Native FFmpeg 7.0.2 intermediate frame checksums and decoded WAV PCM16 hashes.
for (const graph of [false, true]) {
  for (const [filter, format, checksum, planes] of [
    ["ashowinfo", "s16", "3D630B63", "3D630B63"],
    ["earwax,ashowinfo", "s16p", "8A641F15", "D9C5A5C9 4505793D"],
    ["earwax,anull,ashowinfo", "s16p", "8A641F15", "D9C5A5C9 4505793D"],
    ["earwax,aformat=f=s16,ashowinfo", "s16", "D8581F15", "D8581F15"]
  ] as const) {
    it(`${filter} preserves native frame layout and WAV samples (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(stderr.trim(), `[ashowinfo] n:0 pts:0 pts_time:0 fmt:${format} channels:2 chlayout:stereo rate:44100 nb_samples:2059 checksum:${checksum} plane_checksums: [ ${planes} ]`);
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 44100);
      assert.equal(audio.channels, 2);
      assert.equal(audio.channelData[0]!.length, 2059);
      const pcm = Buffer.alloc(2059 * 4);
      for (let i = 0; i < 2059; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, (i * 2 + c) * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), filter === "ashowinfo"
        ? "79714ed987ac807587cb55bff3100e086b0cabbe1ceb62b7268d4a5c4f38d9f9"
        : "dae490434bad8ca4bbeb96f81783a3b4fd468059763f85a32024de4ae0fb8d7e");
    });
  }
}
