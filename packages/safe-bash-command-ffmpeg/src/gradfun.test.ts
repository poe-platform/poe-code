import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  96 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 256)));

async function run(filter: string, width = 32, height = 32, input = Buffer.from(Array.from({ length: width * height }, (_, i) =>
  96 + 2 * Math.floor((i % width) / 3) + Math.floor(i / width / 8)))) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", `${width}x${height}`,
      "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { result, stderr, output: chunks.length ? Buffer.concat(chunks) : undefined };
}

it("keeps scalar arithmetic for the final partial eight-pixel block", async () => {
  const pattern = Buffer.from(Array.from({ length: 39 * 32 }, (_, i) => {
    const x = i % 39;
    const y = Math.floor(i / 39);
    return (x * x + y * 7 + x * y) % 256;
  }));
  const { result, stderr, output } = await run("gradfun=64:4", 39, 32, pattern);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output!.length, pattern.length);
  // Scalar tail bytes independently verified with native FFmpeg 9.0.1 on ARM.
  const tail = output!.filter((_, i) => i % 39 >= 32);
  assert.equal(createHash("sha256").update(tail).digest("hex"),
    "1fc03c022526c4f309945e2e10002b34f02658ad379b2c1733f59500883b5ab2");
});

// Ordinary FFmpeg 7.0.2 on x86 with SSSE3 enabled (not -cpuflags 0).
for (const [strength, hash] of [
  [32, "64a7267dde357d3c017391482becdf18a791ff890b8dd43cf127d1ee2186abfb"],
  [40, "d20175d46ff8d30e530423fb24024ac262819d631eaed675e0e8e612b6332249"],
  [64, "51370bcf316a1eca63fc6a55a57c4c5998ea6a4e079944e59fe09cddfb0cc97c"]
] as const) {
  it(`matches native x86 gradfun at strength ${strength}`, async () => {
    const pattern = Buffer.from(Array.from({ length: 1024 }, (_, i) => {
      const x = i % 32;
      const y = Math.floor(i / 32);
      return (x * x + y * 7 + x * y) % 256;
    }));
    const { result, stderr, output } = await run(`gradfun=${strength}:4`, 32, 32, pattern);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output!.length, 1024);
    assert.equal(createHash("sha256").update(output!).digest("hex"), hash);
  });
}

for (const [options, hash] of [
  ["strength=5:radius=4", "9806068629cde0e20a0cd940c555f6b42060b15940403fd4d7b77e2fb6b30931"],
  ["5:4.49", "9806068629cde0e20a0cd940c555f6b42060b15940403fd4d7b77e2fb6b30931"],
  ["5:4.5", "9806068629cde0e20a0cd940c555f6b42060b15940403fd4d7b77e2fb6b30931"],
  ["strength=5:radius=4.5", "9806068629cde0e20a0cd940c555f6b42060b15940403fd4d7b77e2fb6b30931"],
  ["5:4.51", "9d3d84366aefc7878e3dc45fbf39ca90b10c824491f19b8dda42c3abc4d31fad"],
  ["5:5.5", "9d3d84366aefc7878e3dc45fbf39ca90b10c824491f19b8dda42c3abc4d31fad"],
  ["5:6.5", "9d3d84366aefc7878e3dc45fbf39ca90b10c824491f19b8dda42c3abc4d31fad"],
  ["strength=1.2:radius=8", "17b53723bcfd38bf11d20ebb49e701a0887fa663e2eca7dfdf27d1ed049429fc"],
  ["5:4", "9806068629cde0e20a0cd940c555f6b42060b15940403fd4d7b77e2fb6b30931"]
]) {
  it(`matches native grayscale gradfun=${options}`, async () => {
    const { result, stderr, output } = await run(`gradfun=${options}`);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output!.length, 1024);
    assert.equal(createHash("sha256").update(output!).digest("hex"), hash);
  });
}
for (const filter of ["null", "gradfun", "gradfun=5:32", "gradfun=5:4:enable=0"]) {
  it(`preserves pixels for ${filter}`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, input);
  });
}
for (const options of ["strength=0.5", "strength=65", "radius=3", "radius=33", "unknown=1", "5:4:1"]) {
  it(`rejects invalid gradfun options ${options}`, async () => {
    const { result, stderr, output } = await run(`gradfun=${options}`);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /gradfun/);
    assert.equal(output, undefined);
  });
}

for (const [width, height, radius, hash] of [
  [9, 9, 4, "664978bc7d8b10b095b7d8fef4f1b43cc4dbe534ffc79259e1a2eb92d45721ee"],
  [9, 12, 4, "d8df8dcc98f9ac260be96fbced70b96fd6b09597cabfb6489a6d6500a45416c4"],
  [33, 35, 5, "2880fedf78af8c4a66bcbd110aea3faeb31c4134d8c983d53e84301862d2e8d0"],
  [64, 64, 16, "87ea04fbedbade8fb1f9ab1be060987001aaf0e4a6aabd9076787b054431c5ac"]
] as const) {
  it(`matches native gradfun at ${width}x${height}, radius ${radius}`, async () => {
    const { result, stderr, output } = await run(`gradfun=5:${radius}`, width, height);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(output!).digest("hex"), hash);
  });
}
