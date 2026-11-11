import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Float64Array.from([1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
  9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000], value => value / 32768);

async function run(filter: string, complex = false, channels = [input]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(complex
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(chunk) { chunks.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(chunks);
}

// Complete PCM16 output from native FFmpeg 7.0.2, with four samples per frame.
for (const [filter, expected] of [
  ["asendcmd=c='0.001 acrusher bits 4',acrusher", "f60328f8a70b68f08e137ee8541bd0e0a52245d8d12a30d1fe3215ca2a3ba8c2"],
  ["acrusher=bits=4", "8703d4f7bc0aa7ef5d127be7791aa0dfa52245d8d12a30d1fe3215ca2a3ba8c2"],
  ["acrusher", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"],
  ["asendcmd=c='0.001 volume bits 4',acrusher", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"]
]) for (const complex of [false, true]) {
  it(`matches native ${filter} through ${complex ? "filter_complex" : "af"}`, async () => {
    assert.equal((await run(`asetnsamples=n=4:p=0,${filter}`, complex)).toString("hex"), expected);
  });
}

it("applies a change on the next frame and leaves commands at EOF unapplied", async () => {
  const expected = await run("asetnsamples=4:0,asendcmd=c='0.001 acrusher bits 4',acrusher");
  assert.deepEqual(await run("asetnsamples=4:0,asendcmd=c='0.0006 acrusher bits 4',acrusher"), expected);
  assert.deepEqual(await run("asetnsamples=4:0,asendcmd=c='0.002 acrusher bits 4',acrusher"), await run("acrusher"));
  assert.deepEqual(await run("asetnsamples=4:0,acrusher,asendcmd=c='0.0005 acrusher bits 4'"), expected);
});

it("updates only the first matching filter or the named instance", async () => {
  assert.deepEqual(await run("asendcmd=c='0 acrusher bits 4',acrusher@first,acrusher@second"),
    await run("acrusher=bits=4,acrusher"));
  assert.deepEqual(await run("asendcmd=c='0 acrusher@second bits 4',acrusher@first,acrusher@second"),
    await run("acrusher,acrusher=bits=4"));
  assert.deepEqual(await run("asendcmd=c='0 acrusher@missing bits 4',acrusher"), await run("acrusher"));
});

it("applies successive changes to every channel without changing earlier samples", async () => {
  const graph = "asetnsamples=4:0,asendcmd=c='0.0005 acrusher bits 4;0.0015 acrusher bits default',acrusher";
  const baseline = await run("acrusher");
  const crushed = await run("acrusher=bits=4");
  const expected = Buffer.concat([baseline.subarray(0, 8), crushed.subarray(8, 24), baseline.subarray(24)]);
  assert.deepEqual(await run(graph), expected);
  const stereo = await run(graph, true, [input, input]);
  for (let i = 0; i < input.length; i++) {
    assert.equal(stereo.readInt16LE(i * 4), expected.readInt16LE(i * 2));
    assert.equal(stereo.readInt16LE(i * 4 + 2), expected.readInt16LE(i * 2));
  }
});

it("continues after invalid and unsupported commands", async () => {
  const expected = await run("asetnsamples=4:0,asendcmd=c='0.001 acrusher bits 4',acrusher");
  for (const command of ["bits 0", "bits 65", "bits NaN", "bits invalid", "unknown 4"]) {
    assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.0005 acrusher ${command};0.001 acrusher bits 4',acrusher`), expected);
  }
});

for (const option of ["bits=2+2", "level_in=0.5", "level_out=0.5", "mix=0", "mode=log", "dc=2", "aa=0"]) {
  it(`uses the same parsing and quantization for static and commanded ${option}`, async () => {
    assert.deepEqual(await run(`asendcmd=c='0 acrusher ${option.replace("=", " ")}',acrusher`),
      await run(`acrusher=${option}`));
  });
}

it("preserves the held sample and capture interval across a bit-depth change", async () => {
  const output = await run("asetnsamples=4:0,asendcmd=c='0.0005 acrusher bits 4',acrusher=samples=3");
  assert.equal(output.toString("hex"), "fb010afca70b05fe59107be7fa0087e5a52206ffbb2730d1fa0002cd2a3b06ff");
});
