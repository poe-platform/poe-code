import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(downstream: string, length = 8, diagnostic = false) {
  const volume = Volume.fromJSON({});
  for (let input = 0; input < 3; input++) {
    volume.writeFileSync(`/${input}.wav`, encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from({ length }, (_, i) => (1000 * input + 100 * (i % 8 + 1)) / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-i", "/0.wav", "-i", "/1.wav", ...(downstream ? ["-i", "/2.wav"] : []),
      "-filter_complex", `[0:a][1:a]acrossfade=ns=3${diagnostic ? ",ashowinfo" : ""}` +
        (downstream ? `[ab];[ab][2:a]${downstream}[out]` : "[out]"),
      "-map", "[out]", "-f", "s16le", "/out.pcm"],
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
  const bytes = volume.readFileSync("/out.pcm") as Buffer;
  return { pcm: Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), stderr };
}

// Native FFmpeg 7.0.2: independent one-packet WAV inputs reach EOF together
// while the downstream two-input filter requests the upstream transition.
for (const [downstream, expected] of [
  ["acrossfade=ns=2", [100, 200, 300, 200, 1100, 2300, 2400, 2500, 2600, 2700, 2800]],
  ["amix=inputs=2", [1100, 1200, 1300, 1400, 1500, 1301, 1351, 1401]],
  ["amerge=inputs=2", [100, 2100, 200, 2200, 300, 2300, 400, 2400, 500, 2500]]
] as const) {
  it(`matches short crossfade PCM and intermediate frames feeding ${downstream}`, async () => {
    for (const diagnostic of [false, true]) {
      const result = await run(downstream, 8, diagnostic);
      assert.deepEqual(result.pcm, expected);
      if (diagnostic) {
        const frames = result.stderr.split("\n").filter(line => line.includes("nb_samples:"));
        assert.equal(frames.length, 1, result.stderr);
        assert.ok(frames[0]!.includes("pts:0 "), result.stderr);
        assert.ok(frames[0]!.includes("nb_samples:5 "), result.stderr);
      }
    }
  });
}

it("preserves a standalone crossfade", async () => {
  assert.deepEqual((await run("")).pcm,
    [100, 200, 300, 400, 500, 400, 633, 866, 1400, 1500, 1600, 1700, 1800]);
});

it("preserves longer chained crossfades", async () => {
  const result = await run("acrossfade=ns=2", 1000);
  assert.deepEqual(result.pcm, [
    ...Array.from({ length: 997 }, (_, i) => 100 * (i % 8 + 1)),
    400, 633, 866,
    ...Array.from({ length: 995 }, (_, i) => 1000 + 100 * ((i + 3) % 8 + 1)),
    850, 1100,
    ...Array.from({ length: 998 }, (_, i) => 2000 + 100 * ((i + 2) % 8 + 1))
  ]);
});
