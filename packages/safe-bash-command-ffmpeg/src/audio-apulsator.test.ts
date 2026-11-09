import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of native FFmpeg 7.0.2/9.0.1 PCM, 8 kHz, 2048 frames.
for (const [filter, hash, mono = false] of [
  [
    "apulsator=mode=sine",
    "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"
  ],
  [
    "apulsator=mode=sine:hz=7:amount=0.6:offset_l=0.25:offset_r=1",
    "6c41ba7e328a40abd58f9d9b7f92e528ade1b3f280d465319aa23162a125b638"
  ],
  [
    "apulsator=mode=triangle",
    "978d4024e5706d6ce8587cdc24078d5cb9e92f1cfceda58428de25b4d4c6c8dc"
  ],
  [
    "apulsator=mode=triangle:hz=7:amount=0.6:offset_l=0.25:offset_r=1",
    "0056d5473edcf601a8b4c7830a660e75584d0aca37f821c4ffeb41b65c3e8e59"
  ],
  [
    "apulsator=mode=square",
    "502845b3c47e4226e63fa8075af232f8cac26483cbdad1707743717151a4c9f5"
  ],
  [
    "apulsator=mode=square:hz=7:amount=0.6:offset_l=0.25:offset_r=1",
    "4104d24727c2545cff4a14cac98319e2781539cc2101a0acef1b6f79c5c49fbd"
  ],
  [
    "apulsator=mode=sawup",
    "24a08fce435199b4ddb0a8d275c7fce6bcb71f9c142523bca28210d4c605f690"
  ],
  [
    "apulsator=mode=sawup:hz=7:amount=0.6:offset_l=0.25:offset_r=1",
    "c1ecdc4dcce7ea077e571368d46433889fdf854937e5ec166bb6895d67d1d932"
  ],
  [
    "apulsator=mode=sawdown",
    "aec0f9bde777f35124fda4c9d2af572e28382074fc0f32bd13b29c94db9c91ff"
  ],
  [
    "apulsator=mode=sawdown:hz=7:amount=0.6:offset_l=0.25:offset_r=1",
    "31e6e912733d6f47c52858f80248fdfc0d1acf52be35dd85e2bd1778fd9bad63"
  ],
  ...["1/2", "0.5", "sin(PI/6)", "0x1/2", "500m"].map(value => [
    `apulsator=amount=${value}`,
    "8a9cfd8759cebe8295e08e216d98b6991818f0cc2a068fbb550543a979727a85"
  ] as const),
  [
    "apulsator=hz=2*3:amount=1/2:offset_l=1/4:offset_r=3/4",
    "116b6cd02f5930ce1817ff86809ea76cb09814de24110df27a4fcb046c46ae0a"
  ],
  [
    "apulsator=amount=1/E",
    "2aaf6afed8ed59e5bb7346bcde35b94e0911eba34c07d5e27a522a2aba0dc638"
  ],
  [
    "apulsator=amount=1/PHI",
    "554c4bd370395611eebc1e73b51458bb9d3e3ffc81af98e43c6475ff9bb70e1a"
  ],
  [
    "apulsator=hz=2:amount=0.8:offset_l=0:offset_r=0.5",
    "08f0d2c855f88953ea4ed0c3e0025d24e24173997c376f9cdaeba43fe59062e5"
  ],
  [
    "apulsator",
    "8e51fdb427f4e806fe3de9e39097860a06414283abb2d1880df29d9028040abb"
  ],
  [
    "apulsator=hz=7:offset_l=0.25:offset_r=0.75",
    "42c1cdbee59ffca746499634199f63b2fd7b90ba2d7346daa7576f69d16f18ea"
  ],
  [
    "apulsator=amount=0",
    "2d1f2da800b2a477fbc52839146c0d3fd2c94a18c404a368f734448dbdf3d8ef"
  ],
  ["apulsator", "a948a544338994f736b29f45b12a3dcd69f4b3cf322b14a63bd323fb288973e1", true],
  ["apulsator,pan=stereo|c0=FR|c1=FL", "a0e7d31a9ef6fe66d4cfac7b7742ed6ad87e45bcae3bb16f24e93f73f39d44be", true],
  ["apulsator=amount=0", "361d259755dfcd0aac527e1db911afb68486a9bf5f6ca6af96d992830a54257b", true],
  ["apulsator=hz=7:offset_l=0.25:offset_r=0.75", "f87cc3f54cd830bbe8ad90162572b6bba18f3098287a0f972cdaf7a9da53ae5b", true]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${mono ? "mono" : "stereo"}, ${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph, mono);
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
  ...["hz", "amount", "offset_l", "offset_r"].map(key => `apulsator=${key}=0b1`),
  ...["0o1", "1/0", "2/1", "1/", ""].map(value => `apulsator=amount=${value}`),
  "apulsator=hz=0", "apulsator=amount=2", "apulsator=offset_r=-1", "apulsator=offset_l=NaN", "apulsator=mode=bad", "apulsator=mode=", "apulsator=unknown=1"
]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false, mono = false) {
  const channels = mono ? [new Float64Array(2048).fill(10000 / 32768)] : [
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
