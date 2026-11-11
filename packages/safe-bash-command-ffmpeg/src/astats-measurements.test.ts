import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, metadata = false) {
  // FFmpeg 7.0.2 comparison: 2000 silent samples followed by 400 at 16384.
  const samples = new Float64Array(2400);
  samples.fill(0.5, 2000);
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [samples] })) });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af",
      `astats=${options}${metadata ? ":metadata=1,ametadata=mode=print:file=tags.txt" : ""}`, "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, pcm: Buffer.concat(stdout), volume };
}

for (const [options, expected] of [
  ["measure_perchannel=0:measure_overall=0", ""],
  ["measure_perchannel=none:measure_overall=0x4", "Overall\nMax level: 16384.000000\n"],
  ["measure_perchannel=4:measure_overall=0", "Channel: 1\nMax level: 16384.000000\n"],
  ["measure_perchannel=none:measure_overall=Number_of_samples+Max_level", "Overall\nMax level: 16384.000000\nNumber of samples: 2400\n"],
  ["measure_perchannel=none:measure_overall=262148", "Overall\nMax level: 16384.000000\nNumber of samples: 2400\n"],
  ["measure_perchannel=none:measure_overall=0x3004000", "Overall\nAbs Peak count: 400.000000\nEntropy: 0.050002\nBit depth: 1/1/2/1\n"],
  ["measure_perchannel=none:measure_overall=0x40004-Max_level", "Overall\nNumber of samples: 2400\n"],
  ["measure_perchannel=none:measure_overall=none+4+Max_level", "Overall\nMax level: 16384.000000\n"],
  ["measure_perchannel=none:measure_overall=all-all+Max_level", "Overall\nMax level: 16384.000000\n"],
  ["measure_perchannel=none:measure_overall=Max_level-Max_level", ""],
  ["measure_perchannel=none:measure_overall=Max_level:measure_overall=+Number_of_samples", "Overall\nMax level: 16384.000000\nNumber of samples: 2400\n"]
] as const) {
  it(`selects astats measurements and preserves raw PCM for ${options}`, async () => {
    const result = await run(options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, expected);
    assert.equal(result.pcm.length, 4800);
    assert.equal(createHash("sha256").update(result.pcm).digest("hex"), "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
  });
}

for (const mask of ["all", "4294967295", "all-Max_level", "-Max_level"]) {
  it(`matches the default channel selection with ${mask}`, async () => {
    const baseline = await run("measure_overall=none");
    const result = await run(`measure_perchannel=${mask}:measure_overall=none`);
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = mask.includes("-")
      ? baseline.stderr.split("\n").filter(line => !line.startsWith("Max level:")).join("\n")
      : baseline.stderr;
    assert.equal(result.stderr, expected);
    assert.deepEqual(result.pcm, baseline.pcm);
  });
}

for (const mask of ["all-Max_level", "-Max_level", "4294967291", "0xffffffff-4"]) {
  it(`retains other overall measurements and metadata for ${mask}`, async () => {
    const baseline = await run("measure_perchannel=none", true);
    const result = await run(`measure_perchannel=none:measure_overall=${mask}`, true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, baseline.stderr.split("\n").filter(line => !line.startsWith("Max level:")).join("\n"));
    assert.ok(result.stderr.includes("Number of samples: 2400\n"));
    const tags = baseline.volume.readFileSync("/tags.txt", "utf8") as string;
    assert.equal(result.volume.readFileSync("/tags.txt", "utf8"), tags.split("\n").filter(line => !line.startsWith("lavfi.astats.Overall.Max_level=")).join("\n"));
    assert.deepEqual(result.pcm, baseline.pcm);
  });
}

it("applies independent numeric masks to channel and overall metadata", async () => {
  const result = await run("measure_perchannel=0x4:measure_overall=262144", true);
  assert.equal(result.exitCode, 0, result.stderr);
  const tags = (result.volume.readFileSync("/tags.txt", "utf8") as string).split("\n").filter(line => line.startsWith("lavfi."));
  assert.ok(tags.some(line => line === "lavfi.astats.1.Max_level=16384.000000"));
  assert.ok(tags.some(line => line === "lavfi.astats.Overall.Number_of_samples=2400.000000"));
  assert.ok(tags.every(line => line.startsWith("lavfi.astats.1.Max_level=") || line.startsWith("lavfi.astats.Overall.Number_of_samples=")));
});

for (const mask of ["", "0x", "4294967296", "0.5", "NaN", "all-unknown", "Max_level+"]) {
  it(`rejects invalid astats mask ${JSON.stringify(mask)} before writing PCM`, async () => {
    const result = await run(`measure_overall=${mask}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("astats:"), result.stderr);
    assert.equal(result.pcm.length, 0);
  });
}
