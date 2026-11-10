import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const invalidFilters = new Map<string, number>([
  ["areverse=unknown=1", 8], ["areverse@flip=unknown=1", 8],
  ["areverse=threads=-1", 222], ["areverse=threads=2147483648", 222],
  ["areverse=threads=", 234], ["areverse=thread_type=bogus", 234],
  ["areverse=extra_hw_frames=-2", 222], ["areverse=2", 234],
  ["areverse=threads=min-1", 222], ["areverse=extra_hw_frames=default-1", 222]
]);

for (const graph of [false, true]) {
  for (const filter of [
    "areverse", "areverse=", "asetnsamples=n=3:p=0,areverse",
    "asetnsamples=n=3:p=0,areverse@flip", "asetnsamples=n=3:p=0,areverse@flip=",
    ...["threads=2", "thread_type=slice", "extra_hw_frames=1", "threads=1:thread_type=slice",
      "threads=min", "threads=default", "extra_hw_frames=min", "extra_hw_frames=default",
      "threads=0", "extra_hw_frames=-1"].flatMap(options => [
      `areverse=${options}`, `areverse@rev=${options}`, `asetnsamples=n=3:p=0,areverse=${options}`
    ]),
    ...invalidFilters.keys()
  ]) {
    it(`handles ${filter} options (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const invalid = invalidFilters.has(filter);
      assert.equal(result.exitCode, invalidFilters.get(filter) ?? 0, stderr);
      // Native FFmpeg 7.0.2 reverses all eleven samples, including the short final frame.
      assert.equal(volume.readFileSync("/out").toString("hex"), invalid ? "4b454550" : "f82a10272823401f581b70178813a00fb80bd007e803");
      if (filter.includes("unknown=")) assert.ok(stderr.includes("areverse: unsupported option unknown"), stderr);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
