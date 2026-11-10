import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];
const windows = [String.raw`00\\:00\\:00.003`, String.raw`00\\:00.003`,
  String.raw`'00\:00\:00.003'`, String.raw`\'00:00:00.003\'`, "3000us", "3ms", "0.003s", "0"];
const invalid = [String.raw`00\\:00\\:60`, String.raw`00\\:01\\:40.000001`,
  String.raw`00\\:00\\:00.003junk`, String.raw`-00\\:00\\:00.003`, "1e-3", ""];

async function run(window: string, format: string, graph: boolean) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const filter = `silenceremove=stop_periods=-1:stop_threshold=0.1:window=${window}`;
  let error = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { error += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, error, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2: clock and unit durations use the same three-sample window.
for (const graph of [false, true]) {
  for (const format of ["s16le", "framecrc"]) {
    for (const window of windows) {
      it(`matches native ${format} for silenceremove window=${window} (graph=${graph})`, async () => {
        const { result, error, output } = await run(window, format, graph);
        assert.equal(result.exitCode, 0, error);
        if (format === "s16le") {
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
            window === "0" ? [0, 0, 0, 0, 9000, -9000, 4000, -4000, 7000, -7000, 7000, -7000]
              : [0, 0, 0, 0, 9000, -9000, 0, 0, 7000, -7000, 7000, -7000, 0, 0]);
        } else {
          assert.ok(output.toString().includes("#tb 0: 1/1000"));
          const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
            .map(line => line.split(",").map(field => field.trim()));
          assert.deepEqual(rows, [["0", "0", "0", ...(window === "0"
            ? ["12", "24", "0x3fa407fc"] : ["14", "28", "0x434305fd"])]]);
        }
      });
    }
    for (const window of invalid) {
      it(`rejects invalid silenceremove window=${window} without replacing ${format} (graph=${graph})`, async () => {
        const { result, output } = await run(window, format, graph);
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
      });
    }
  }
}
