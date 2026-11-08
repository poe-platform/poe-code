import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function copy(maps: string[], format = "mov") {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode.mp4", import.meta.url));
  const volume = Volume.fromJSON({ "/in.mp4": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "-f", format, "/out.mov"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, input };
}

for (const map of ["0:d", "0:d:0", "0:d?"]) {
  it(`copies the timecode data track selected by ${map}`, async () => {
    const { result, stderr, volume, input } = await copy([map]);
    assert.equal(result.exitCode, 0, stderr);
    const output = parseMp4(volume.readFileSync("/out.mov") as Buffer);
    const source = parseMp4(input).tracks.find(track => track.type === "data")!;
    assert.equal(output.tracks.length, 1);
    assert.equal(output.tracks[0]!.type, "data");
    assert.equal(output.tracks[0]!.codecDescriptions[0]!.formatFourCC, "tmcd");
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
  });
}

it("rejects a missing data ordinal", async () => {
  const { result, stderr } = await copy(["0:d:1"]);
  assert.equal(result.exitCode, 234);
  assert.match(stderr, /matches no streams/);
});

it("resolves data maps before reporting unsupported data muxing", async () => {
  const numeric = await copy(["0:1"], "data");
  const typed = await copy(["0:d"], "data");
  assert.notEqual(numeric.result.exitCode, 0);
  assert.doesNotMatch(numeric.stderr, /matches no streams/);
  assert.equal(typed.result.exitCode, numeric.result.exitCode);
  assert.equal(typed.stderr, numeric.stderr);
});
