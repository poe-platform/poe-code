import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, filter = "", fade = 3, overlap = 1, frameSize = 4) {
  const input = Buffer.alloc(22);
  for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 100, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
      "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw", "-filter_complex",
      `[0:a]asetnsamples=n=${frameSize}:p=0[a];[1:a]asetnsamples=n=4:p=0,anull[r];` +
      `[a][r]acrossfade=ns=${fade}:o=${overlap}${filter ? `,${filter}` : ""}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", "-f", format, "/out"],
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
  return volume.readFileSync("/out") as Buffer;
}

for (const overlap of [0, 1]) {
  it(`acrossfade exposes prefix frame 1 to selection, overlap=${overlap}`, async () => {
    const pcm = await run("s16le", "aselect=eq(n\\,1)", 3, overlap);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
      [200, 300, 400, 500]);
  });
}

it("acrossfade preserves all PCM while retaining prefix frames", async () => {
  const pcm = await run("s16le");
  assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
    [100, 200, 300, 400, 500, 600, 700, 800, 600, 400, 200, 400, 500, 600, 700, 800, 900, 1000, 1100]);
});

// Packet rows captured from FFmpeg 7.0.2, including timestamps and PCM checksums.
it("acrossfade matches native prefix, transition, and suffix packets", async () => {
  const output = await run("framecrc");
  const rows = output.toString().trim().split("\n").filter(line => !line.startsWith("#"));
  assert.deepEqual(rows.map(line => line.split(",").map(value => value.trim()).join(",")), [
    "0,0,0,1,2,0x00c80064", "0,1,1,4,8,0x0b79027b", "0,5,5,3,6,0x0553013b",
    "0,8,8,3,6,0x05ed01b3", "0,11,11,1,2,0x01210091", "0,12,12,4,8,0x0cfa0230",
    "0,16,16,3,6,0x076c01c2"
  ]);
});

for (const [frameSize, fade, overlap, lengths] of [
  [4, 3, 0, [1, 4, 3, 3, 3, 1, 4, 3]],
  [4, 4, 1, [4, 3, 4, 4, 3]],
  [4, 5, 1, [3, 3, 5, 3, 3]],
  [4, 11, 1, [11]],
  [4, 12, 1, []],
  [3, 4, 1, [2, 3, 2, 4, 4, 3]],
  [6, 3, 1, [3, 5, 3, 1, 4, 3]]
] as const) {
  it(`acrossfade retains prefix boundaries (${frameSize} samples/frame, ns=${fade}, overlap=${overlap})`, async () => {
    const output = await run("framecrc", "", fade, overlap, frameSize);
    const rows = output.toString().trim().split("\n").filter(line => !line.startsWith("#"));
    let pts = 0;
    assert.deepEqual(rows.map(line => line.split(",").slice(1, 4).map(Number)), lengths.map(count => {
      const row = [pts, pts, count];
      pts += count;
      return row;
    }));
  });
}
