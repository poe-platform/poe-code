import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/multitrack.avi", import.meta.url)));

for (const [maps, order] of [
  [["0:v:0"], [0]],
  [["0"], [0, 1, 2]],
  [["0:a:1", "0:v", "0:a:0"], [2, 0, 1]],
  [["0:a"], [1, 2]],
  [["0:a:1"], [2]]
] as const) {
  it(`AVI stream copy preserves mappings ${maps.join(", ")}`, async () => {
    const files = new Map<string, Uint8Array>([["/in.avi", input]]);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.avi", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.avi"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return files.get(path)!; },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); },
        async stat(path: string) {
          if (!files.has(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return { type: "file", size: files.get(path)!.length, mode: 0o644, mtimeMs: 0 };
        }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = parseAvi(input);
    const actual = parseAvi(files.get("/out.avi")!);
    if (maps[0] === "0:v:0") {
      const output = Buffer.from(files.get("/out.avi")!);
      const strh = output.indexOf("strh");
      const strf = output.indexOf("strf");
      assert.equal(output.toString("ascii", strh + 12, strh + 16), "MJPG");
      assert.equal(output.toString("ascii", strf + 24, strf + 28), "MJPG");
      assert.equal(actual.tracks[0]!.samples.length, 5);
    }
    assert.equal(actual.tracks.length, order.length);
    for (const [index, source] of order.entries()) {
      assert.equal(actual.tracks[index]!.codecDescriptions[0]!.codecName,
        expected.tracks[source]!.codecDescriptions[0]!.codecName);
      assert.deepEqual(actual.tracks[index]!.samples.map(sample => sample.data),
        expected.tracks[source]!.samples.map(sample => sample.data));
    }
  });
}
