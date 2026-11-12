import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { surroundAudio } from "./audio-surround.js";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean, output = "pipe:1") {
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600
      + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=${options ? `${options}:` : ""}win_size=1024`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, stdout: Buffer.concat(chunks), file: fs.readFileSync("/out.pcm", "utf8") };
}

// Native FFmpeg 7.0.2 PCM16 hashes for the three-hop stereo fixture above.
for (const [options, hash] of [
  ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["smooth=0", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["smooth=0.5", "bbe3613cfdb147ddf520deb8a505aec026c3f6738d6bc25fa39efd787613101a"],
  ["smooth=1", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["smooth=1/2", "bbe3613cfdb147ddf520deb8a505aec026c3f6738d6bc25fa39efd787613101a"],
  ["smooth=default", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["smooth=min", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["smooth=max", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"]
]) for (const graph of [false, true]) {
  it(`surround ${options || "defaults"} matches native smoothing PCM (graph=${graph})`, async () => {
    const { result, stderr, stdout } = await run(options!, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 18432);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
  });
}

for (const [value, exitCode] of [["-0.1", 222], ["1.1", 222], ["bad", 234], ["", 234]] as const) {
  for (const graph of [false, true]) for (const output of ["pipe:1", "/out.pcm"]) {
    it(`surround rejects smooth=${value} without writing output (graph=${graph}, ${output})`, async () => {
      const { result, stderr, stdout, file } = await run(`smooth=${value}`, graph, output);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes("surround"), stderr);
      assert.equal(stdout.length, 0);
      assert.equal(file, "keep");
    });
  }
}

it("accounts for smoothing history before allocating it", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  const baseBytes = 32 * 6 * 4 + 1024 * (6 * 4 + 6 * 8 + 4) + 257 * 4;
  for (const smooth of [0, 1]) {
    await surroundAudio(channels, 8000, `surround=win_size=1024:smooth=${smooth}`,
      new MediaBudgetTracker({ maxMemoryBytes: baseBytes }));
  }
  await assert.rejects(surroundAudio(channels, 8000, "surround=win_size=1024:smooth=0.5",
    new MediaBudgetTracker({ maxMemoryBytes: baseBytes })), /maxMemoryBytes/);
  await surroundAudio(channels, 8000, "surround=win_size=1024:smooth=0.5",
    new MediaBudgetTracker({ maxMemoryBytes: baseBytes + 6 * 513 * 4 }));
});
