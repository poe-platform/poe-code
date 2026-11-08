import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const version of [1, 3]) {
  it(`stream copies FFV1 version ${version} without changing its headers or frames`, async () => {
    const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/ffv1-v${version}.mkv`, import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/meeting.mkv", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/meeting.mkv", "-map", "0", "-c", "copy", "/out.mkv"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const source = parseMkv(input).tracks[0]!;
    const copied = parseMkv(volume.readFileSync("/out.mkv") as Buffer).tracks[0]!;
    assert.equal(copied.codecDescriptions[0]!.codecName, "ffv1");
    assert.deepEqual(copied.codecDescriptions, source.codecDescriptions);
    assert.deepEqual(copied.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
  });
}
