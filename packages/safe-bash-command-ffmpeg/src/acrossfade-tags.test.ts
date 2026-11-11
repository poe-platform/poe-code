import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(firstTags: string, secondTags: string, overlap: number, select = true) {
  const volume = Volume.fromJSON({});
  for (const [name, count, start] of [["a", 11, 1], ["b", 9, 101]] as const) {
    const pcm = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i++) pcm.writeInt16LE(start + i, i * 2);
    volume.writeFileSync(`/${name}.raw`, pcm);
  }
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/a.raw",
      "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/b.raw", "-filter_complex",
      `[0:a]asetnsamples=3:0${firstTags}[a];[1:a]asetnsamples=3:0${secondTags}[b];` +
      `[a][b]acrossfade=ns=2:o=${overlap}${select ? ",ametadata=select:k:y" : ""}`,
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = Buffer.concat(stdout);
  return Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
}

// Native FFmpeg 7.0.2 keeps the tags of the first source frame consumed for each
// unblended output frame, even when that output spans multiple input frames.
for (const overlap of [0, 1]) {
  for (const [branch, frame, expected] of [
    [0, 0, [1, 2, 3, 4]],
    [0, 1, [5, 6, 7]],
    [0, 2, [8, 9]],
    [0, 3, []],
    [1, 0, [103]],
    [1, 1, [104, 105, 106]],
    [1, 2, [107, 108, 109]]
  ] as const) {
    it(`acrossfade preserves branch ${branch} frame ${frame} tags, overlap=${overlap}`, async () => {
      const tag = `,ametadata=add:k:y:enable='eq(n,${frame})'`;
      assert.deepEqual(await run(branch === 0 ? tag : "", branch === 1 ? tag : "", overlap), expected);
    });
  }

  it(`acrossfade does not tag generated fade frames, overlap=${overlap}`, async () => {
    const tag = ",ametadata=add:k:y";
    assert.deepEqual(await run(tag, tag, overlap), [1, 2, 3, 4, 5, 6, 7, 8, 9, 103, 104, 105, 106, 107, 108, 109]);
  });

  it(`acrossfade retains unchanged PCM with tagged inputs, overlap=${overlap}`, async () => {
    const tag = ",ametadata=add:k:y";
    assert.deepEqual(await run(tag, tag, overlap, false),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, ...(overlap ? [5, 51] : [5, 0, 0, 51]), 103, 104, 105, 106, 107, 108, 109]);
  });
}
