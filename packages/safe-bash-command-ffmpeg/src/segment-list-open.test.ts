import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, list: string) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_list", list, "part%02d.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

function source() {
  const volume = Volume.fromJSON({ "/part00.wav": "KEEP" });
  volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
  return volume;
}

for (const destination of ["missing/list.csv", "directory.csv"]) {
  it(`preserves every file when the CSV segment list cannot be opened: ${destination}`, async () => {
    const volume = source();
    if (destination === "directory.csv") volume.mkdirSync("/directory.csv");
    const before = volume.toJSON();
    const result = await run(volume, destination);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(destination === "directory.csv" ? "EISDIR" : "ENOENT"), result.stderr);
    assert.equal(volume.statSync("/part00.wav").size, 4);
    assert.equal(volume.readFileSync("/part00.wav", "utf8"), "KEEP");
    assert.equal(volume.existsSync("/part01.wav"), false);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("overwrites audio segments and writes the CSV list when its destination is writable", async () => {
  const volume = source();
  volume.writeFileSync("/parts.csv", "old list");
  const result = await run(volume, "parts.csv");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/parts.csv", "utf8"),
    "part00.wav,0.000000,2.048000\npart01.wav,2.048000,3.000000\n");
  const samples = ["/part00.wav", "/part01.wav"].flatMap(path =>
    Array.from(parseWav(volume.readFileSync(path) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  assert.deepEqual(samples, Array.from({ length: 24000 }, (_, i) => i / 32768));
});
