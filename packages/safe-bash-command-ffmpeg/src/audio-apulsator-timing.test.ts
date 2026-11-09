import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of native FFmpeg 7.0.2 PCM, 8 kHz stereo, 2048 frames.
for (const [filter, hash] of [
  ["apulsator=hz=3", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=timing=bpm:bpm=180", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=hz=4", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=ms:ms=250", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=bpm", "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"],
  ["apulsator=timing=ms", "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"],
  ["apulsator=timing=hz", "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"],
  ["apulsator=bpm=180:ms=250", "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"],
  ["apulsator=timing=bpm:hz=7:bpm=180:ms=100", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=ms=250:hz=7:bpm=180:timing=ms", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=hz:bpm=180:ms=250:hz=3", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=timing=0:bpm=180", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=timing=1:ms=250", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=2:hz=3", "623afcf678d4fbfd2adada22320f5085cb631d8eb2f714ea29a3e824f00ed5c8"],
  ["apulsator=timing=bpm:bpm=30", "066561bfd2272935ee9956bda981c9f35b317093912cfda5ca7358c924a74353"],
  ["apulsator=timing=bpm:bpm=300", "8e74a4cf6c52b1fd17c80fa6ab94834b8554faee2f2c63927e5ebbaab76a5f5b"],
  ["apulsator=timing=bpm:bpm=180.5", "9678321053b048f12e14145bc771f35dac02c1db517440a3007f65a7318e526d"],
  ["apulsator=timing=ms:ms=10", "773882cefd02f81c4d2e14248cfd3231defc5eb349febb1ab562653298fc58eb"],
  ["apulsator=timing=ms:ms=2000", "066561bfd2272935ee9956bda981c9f35b317093912cfda5ca7358c924a74353"],
  ["apulsator=timing=ms:ms=250.5", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=ms:ms=251.5", "0b6b930bed38a563a2e57daf909c45e1e3ef71ca2a940dc7bf476f98bbc53382"],
  ["apulsator=timing=bpm:bpm=180:bpm=240", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=ms:ms=100:ms=250", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"],
  ["apulsator=timing=bpm:timing=ms:ms=250", "6659d06627231838a15b2cb4976d26001b60c055cea201ff41ae3e1d93d373cb"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 2048);
      const pcm = Buffer.alloc(2048 * 4);
      for (let i = 0; i < 2048; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

for (const filter of [
  "apulsator=timing=bad",
  "apulsator=timing=",
  "apulsator=timing=-1",
  "apulsator=timing=3",
  "apulsator=timing=NaN",
  "apulsator=bpm=29.9",
  "apulsator=bpm=300.1",
  "apulsator=bpm=NaN",
  "apulsator=bpm=",
  "apulsator=ms=9.9",
  "apulsator=ms=2000.1",
  "apulsator=ms=Infinity",
  "apulsator=ms=",
  "apulsator=timing=bpm:bpm=0:bpm=180",
  "apulsator=timing=ms:ms=0:ms=250"
]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const channels = [
    Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
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
  return { volume, result, stderr };
}
