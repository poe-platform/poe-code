import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 SHA-256 of all 8192 PCM bytes for 2048 stereo frames:
// 8 kHz, constant signed 16-bit samples of 10000 (left) and -6000 (right).
for (const [filter, hash] of [
  [
    "apulsator",
    "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"
  ],
  [
    "apulsator=level_in=1:level_out=1",
    "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"
  ],
  [
    "apulsator=level_in=0.5",
    "058b09f6eab2041caeadc828e3c180a5386543b75980ba0833a43680e50cf26d"
  ],
  [
    "apulsator=level_out=0.5",
    "058b09f6eab2041caeadc828e3c180a5386543b75980ba0833a43680e50cf26d"
  ],
  [
    "apulsator=level_in=0.5:level_out=0.25",
    "bf9d16ef6e11b4f12f8e2f08302b60de076d0bb71a29193285195161981c55ce"
  ],
  [
    "apulsator=level_in=4:level_out=0.5:amount=0.6",
    "9bbbd51bb9a064d40735c16b89092050426bdfa97fda00e49036983e969c8072"
  ],
  [
    "apulsator=level_in=0.5:level_out=0.25:amount=0",
    "7adce30dcfb573f26902f4e15b8759804f0240a93266ac2e88c0b264d7f9f31a"
  ],
  [
    "apulsator=level_in=0.015625:level_out=64",
    "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"
  ],
  [
    "apulsator=level_in=64:level_out=0.015625",
    "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"
  ],
  [
    "apulsator=level_in=64:level_out=64",
    "97bc4c0354355174869f0dcb30dbb095e93bcba69254826b26307df3aa5bb6c1"
  ]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native gain PCM (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 8192);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

for (const option of ["level_in", "level_out"]) {
  for (const value of ["", "NaN", "Infinity", "-1", "0", "0.015624", "64.001"]) {
    it(`apulsator rejects ${option}=${value} without replacing output`, async () => {
      const { volume, result } = await run(`apulsator=${option}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
    });
  }
}

async function run(filter: string, graph = false) {
  const channels = [new Float64Array(2048).fill(10000 / 32768), new Float64Array(2048).fill(-6000 / 32768)];
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
