import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  it(`adecorrelate matches native FFmpeg 7.0.2 PCM (graph=${graph})`, async () => {
    const expected = parseWav(readFileSync(new URL("./fixtures/adecorrelate/expected.wav", import.meta.url))).tracks[0]!.decodedAudio!;
    for (const filter of ["adecorrelate=stages=4:seed=23", "adecorrelate=4:23", "adecorrelate=stages=4:seed=23:", "adecorrelate=4:23:"]) {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channelData[0]!.length, 8192);
      assert.deepEqual(audio.channelData, expected.channelData);
      assert.equal(audio.channelData[0]!.filter((v, i) => v !== audio.channelData[1]![i]).length, 8191);
    }
  });
}
// Decoded PCM hashes from native FFmpeg, exercising default and boundary options.
for (const [filter, hash] of [
  ["adecorrelate=seed=0", "72dc22868245c894c3870ebf4f92e86062199e272b547d6b7a2b10a4a69fbbb5"],
  ["adecorrelate=seed=0:", "72dc22868245c894c3870ebf4f92e86062199e272b547d6b7a2b10a4a69fbbb5"],
  ["adecorrelate=1:4294967295", "3c6136ee62386fbcc4ba0f91b142ddaaac802563a2c2d6ab18ea58fba3da9bfa"],
  ["adecorrelate=16:42", "32502ac67dc2fd24605810c251bdeabd44d7089d19f86b5b2996841f63b3f4e1"]
] as const) {
  it(`${filter} matches native PCM`, async () => {
    const { volume, result, stderr } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    const pcm = Buffer.alloc(8192 * 4);
    for (let i = 0; i < 8192; i++) {
      for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
for (const filter of ["adecorrelate=stages=0", "adecorrelate=stages=17", "adecorrelate=stages=1.5", "adecorrelate=seed=-2", "adecorrelate=seed=4294967296", "adecorrelate=seed=NaN", "adecorrelate=seed=", "adecorrelate=unknown=1", "adecorrelate=seed=:", "adecorrelate=seed=42::", "adecorrelate=stages=4::seed=42"]) {
  it(`${filter} preserves output on invalid options`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", readFileSync(new URL("./fixtures/adecorrelate/input.wav", import.meta.url)));
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
