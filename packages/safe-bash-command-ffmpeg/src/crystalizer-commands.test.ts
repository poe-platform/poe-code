import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("00100020003000400050006000700040", "hex");

async function run(filter: string, complex: boolean, source = input, channels = 1): Promise<Buffer> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.raw", source);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
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
  return fs.readFileSync("/out.raw") as Buffer;
}

for (const complex of [false, true]) {
  it(`changes crystalizer intensity and clipping at time zero (${complex ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0 crystalizer@x i 0',crystalizer@x=i=2", complex), input);
    assert.equal((await run("asendcmd=c='0 crystalizer@x c 0',crystalizer@x=i=2,volume=0.5", complex)).toString("hex"),
      "001800200028003000380040004800f0");
  });

  it(`changes crystalizer only from the scheduled frame (${complex ? "graph" : "simple"})`, async () => {
    const source = Buffer.concat(Array.from({ length: 512 }, () => input));
    const output = await run("asendcmd=c='0.256 crystalizer@x i 0',crystalizer@x=i=2", complex, source);
    const baseline = await run("crystalizer=i=2", complex, source);
    assert.deepEqual(output.subarray(0, 4096), baseline.subarray(0, 4096));
    assert.deepEqual(output.subarray(4096), source.subarray(4096));
    assert.deepEqual([0, 1024, 2048, 3072].map(sample => output.subarray(sample * 2, sample * 2 + 6).toString("hex")),
      ["003000400050", "00b000400050", "001000200030", "001000200030"]);
  });
}

// SHA-256 of PCM16 output from native FFmpeg 7.0.2 at 8 kHz.
for (const [channels, filter, expected] of [
  [1, "asendcmd=c='0.128 crystalizer@x i -1;0.256 crystalizer@x i 2',crystalizer@x=i=0", "aa9ce8514b777e4876a1fd318daa1a2494811fac01461472227e028cf6f5dbc4"],
  [2, "asendcmd=c='0.128 crystalizer@x i -1;0.256 crystalizer@x i 2',crystalizer@x=i=0", "5afed5d2a0190b740ab32e18dd2ed91b65de4affba90d349736a67910f893926"],
  [1, "asendcmd=c='0.128 crystalizer@x c OFF;0.256 crystalizer@x c ON',crystalizer@x=i=2,volume=0.5", "3d91dff8828d02c201d02cf6574ce4e08bee385a920d0998e80cfcd41c5c4b33"],
  [2, "asendcmd=c='0.128 crystalizer@x c 0;0.256 crystalizer@x c 1',crystalizer@x=i=2,volume=0.5", "0d8c18144cd0e3832bf2588c432f9960a7b3dd86e48b3a324c67defad6188b96"],
  [1, "asendcmd=c='0.129 crystalizer@x i 0',crystalizer@x=i=2", "cabdfef6fde475b27fb82262213b155a53c48c1d8e6edf5ecd4dbcac8469f0b6"],
  [1, "asetnsamples=n=200:p=0,asendcmd=c='0.129 crystalizer@x i 0',crystalizer@x=i=2", "4c7afbf4f363d31ee8fc8736b2e2a4d295e28fcfb8665e71db0d27aca821daaa"],
  [1, "asetpts=PTS+8000,asendcmd=c='1.129 crystalizer@x i 0',crystalizer@x=i=2", "cabdfef6fde475b27fb82262213b155a53c48c1d8e6edf5ecd4dbcac8469f0b6"],
  [1, "asendcmd=c='0.128 crystalizer i -1/2',crystalizer@x=i=0,crystalizer@y=i=1", "6628cdfb7bf175158d078b199764baeaa7353f3a50df9ac5bfabe5a20d25f922"],
  [1, "asendcmd=c='0.128 crystalizer@y i -1/2',crystalizer@x=i=0,crystalizer@y=i=1", "43601149720bbb048dd5f351afcfc4e8e2fe8b42dd13008de3b03429c316d8c2"],
  [1, "asendcmd=c='0.128 crystalizer@other i 0',crystalizer@x=i=2", "3760f77dee61a40b955818040716a71817106c1da7c7ece509984a6399e77843"],
  [1, "asendcmd=c='0.128 crystalizer@x i 11;0.256 crystalizer@x i NaN;0.384 crystalizer@x c 2',crystalizer@x=i=2", "3760f77dee61a40b955818040716a71817106c1da7c7ece509984a6399e77843"],
  [1, "asendcmd=c='0.128 crystalizer@x i -1;0.256 crystalizer@x i bad;0.384 crystalizer@x i 0',crystalizer@x=i=2", "54aaeda89e3352b3282d2b7d7b77758d8105a050911288899d9a304d8e0f0ee5"],
  [1, "asendcmd=c='0.128 crystalizer@x c 0;0.256 crystalizer@x c invalid',crystalizer@x=i=2,volume=0.5", "30f851608aec2cdb64f81c4e757353b309cdc017a97501cb837ea4dbece141a8"],
  [1, "asendcmd=c='0.128 crystalizer@x i 0;0.256 volume@v volume 0.5',crystalizer@x=i=2,volume@v=1", "477c74554cc7f3aa991dec41bbbf839dadad1c819bd0845434b8801f1ec3edd8"],
  [1, "asendcmd=c='0.128 crystalizer@x i -1',crystalizer@x=i=2:enable=gte(t\\,0.256)", "b87030eb792907d3565869c73c22017d775672a0aafc52b351eb92166584d8f1"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches native crystalizer commands (${channels} channels, ${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const source = Buffer.alloc(4096 * channels * 2);
      for (let i = 0; i < 4096; i++) {
        source.writeInt16LE(input.readInt16LE((i % 8) * 2), i * channels * 2);
        if (channels === 2) source.writeInt16LE(i % 2 ? 8192 : -12288, i * 4 + 2);
      }
      const output = await run(filter, complex, source, channels);
      assert.equal(output.length, source.length);
      assert.equal(createHash("sha256").update(output).digest("hex"), expected);
    });
  }
}
