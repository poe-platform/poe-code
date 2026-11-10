import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, format: string, graph: boolean) {
  const input = Buffer.alloc(22);
  for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 100, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", format, "/out"],
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
  return Buffer.from(volume.readFileSync("/out"));
}

// Packet timestamps, sizes, checksums and PCM verified with FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const [size, timeBase, offset, pts] of [
    [4, 500, "", [0, 4, 6, 10]],
    [4, 1000, "", [0, 3, 6, 9]],
    [11, 500, "", [0, 4, 8, 12]],
    [11, 500, "asetpts=PTS-10,", [-10, -6, -2, 2]]
  ] as const) {
    it(`asetnsamples rounds each consumed frame offset (${size}, 1/${timeBase}, ${offset}, graph ${graph})`, async () => {
      const output = await run(`asetnsamples=n=${size}:p=0,${offset}asettb=1/${timeBase},asetnsamples=n=3:p=0`, "framecrc", graph);
      const packets = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      assert.deepEqual(packets, pts.map((timestamp, i) => [
        "0", String(timestamp), String(timestamp), String(i === 3 ? 2 : 3), String(i === 3 ? 4 : 6),
        ["0x05d10159", "0x07ea01e0", "0x06060168", "0x0445013b"][i]
      ]));
    });
  }

  for (const [timeBase, downstream, expected] of [
    [500, "aselect=gte(t\\,0.0039)", [400, 500, 600, 700, 800, 900, 1000, 1100]],
    [1000, "aselect=gte(t\\,0.0039)", [700, 800, 900, 1000, 1100]],
    [500, "atrim=start=0.004:end=0.008", [400, 500, 600, 700, 800]]
  ] as const) {
    it(`asetnsamples exposes rounded timestamps to ${downstream} (1/${timeBase}, graph ${graph})`, async () => {
      const output = await run(`asetnsamples=n=4:p=0,asettb=1/${timeBase},asetnsamples=n=3:p=0,${downstream}`, "s16le", graph);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
