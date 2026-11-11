import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: unknown options exit 8; out-of-range values exit 222.
for (const graph of [false, true]) {
  for (const [options, exitCode, diagnostic] of [
    ["seed=42:bad=1", 8, "Option not found"],
    ["seed=42:stages=17", 222, "[1 - 16]"],
    ["stages=0", 222, "[1 - 16]"],
    ["seed=-2", 222, "[-1 - 4294967295]"],
    ["seed=4294967296", 222, "[-1 - 4294967295]"]
  ] as const) {
    it(`adecorrelate=${options} exits ${exitCode} without audio (graph=${graph})`, async () => {
      for (const output of ["pipe:1", "/out.raw"]) {
        const { result, stdout, stderr, volume } = await run(options, graph, output);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.equal(stdout.length, 0);
        assert.ok(stderr.includes(diagnostic), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
      }
    });
  }

  it(`adecorrelate=seed=42 preserves native PCM (graph=${graph})`, async () => {
    const { result, stdout, stderr } = await run("seed=42", graph, "pipe:1");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout.length, 128);
    assert.equal(createHash("sha256").update(stdout).digest("hex"),
      "433ffd7a01407d8506006121a780762fc05dbd08fa0592d6004405683e7d28d3");
  });
}

async function run(options: string, graph: boolean, output: string) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 48000,
    channels: [
      Float64Array.from({ length: 32 }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
      Float64Array.from({ length: 32 }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
    ]
  }, { bitsPerSample: 16 }));
  const filter = `adecorrelate=${options}`;
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stdout: Buffer.concat(chunks), stderr, volume };
}
