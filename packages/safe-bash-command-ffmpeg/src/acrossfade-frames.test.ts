import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(firstLength: number, secondLength: number, fade: number, overlap: boolean, filter: string) {
  const volume = Volume.fromJSON({});
  for (const [name, length] of [["a", firstLength], ["b", secondLength]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length }, (_, i) => (1000 + i) / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=ns=${fade}:o=${Number(overlap)}${filter ? `,${filter}` : ""}[out]`,
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
  return { pcm: volume.readFileSync("/out.pcm") as Buffer, stderr };
}

// Frame lengths verified with native FFmpeg 7.0.2 for mono PCM16 at 8 kHz.
for (const [first, second, fade, overlap, lengths] of [
  [37, 1301, 37, true, [37, 475, 512, 277]],
  [37, 1301, 37, false, [37, 37, 475, 512, 277]],
  [1301, 1301, 37, true, [1264, 37, 475, 512, 277]],
  [1301, 1301, 600, true, [701, 600, 424, 277]],
  [1301, 1301, 600, false, [701, 600, 600, 424, 277]],
  [512, 1301, 512, true, [512, 512, 277]],
  [37, 37, 37, true, [37]]
] as const) {
  it(`acrossfade retains output frames (${first}/${second}, ns=${fade}, overlap=${overlap})`, async () => {
    const baseline = await run(first, second, fade, overlap, "ashowinfo");
    const lines = baseline.stderr.split("\n").filter(line => line.includes("nb_samples:"));
    assert.equal(lines.length, lengths.length, baseline.stderr);
    let start = 0;
    for (const [n, length] of lengths.entries()) {
      assert.ok(lines[n]!.includes(`n:${n} pts:${start} `), lines[n]);
      assert.ok(lines[n]!.includes(`nb_samples:${length} `), lines[n]);
      const selected = await run(first, second, fade, overlap, `aselect='eq(n,${n})'`);
      assert.equal(selected.pcm.length, length * 2);
      assert.deepEqual(selected.pcm, baseline.pcm.subarray(start * 2, (start + length) * 2));
      start += length;
    }
    assert.equal(baseline.pcm.length, start * 2);
  });
}

it("acrossfade exposes transition timestamps to downstream selection", async () => {
  const baseline = await run(37, 1301, 37, true, "");
  const selected = await run(37, 1301, 37, true, "aselect='eq(t,0.004625)'");
  assert.deepEqual(selected.pcm, baseline.pcm.subarray(37 * 2, 512 * 2));
});
