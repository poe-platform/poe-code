import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 12 H.264 frames at 25 fps, copied with -r 50 to AVI.
// The 50 Hz AVI clock uses one empty timing chunk after each coded frame.
const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/empty-timing.avi", import.meta.url)));

it("AVI copy preserves 25 fps video with empty 50 Hz timing chunks", async () => {
  const source = parseAvi(input).tracks[0]!;
  const times = Array.from({ length: 12 }, (_, index) => index / 25);
  const inputHeader = Buffer.from(input);
  const inputStrh = inputHeader.indexOf("strh");
  assert.equal(inputHeader.readUInt32LE(inputStrh + 32) / inputHeader.readUInt32LE(inputStrh + 28), 50);
  assert.deepEqual(source.samples.map(sample => sample.dts / source.timescale), times);
  assert.equal(source.duration / source.timescale, 0.48);

  const files = new Map<string, Uint8Array>([["/in.avi", input]]);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.avi", "-map", "0", "-c", "copy", "/out.avi"],
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
  const output = files.get("/out.avi")!;
  const actual = parseAvi(output).tracks[0]!;
  assert.deepEqual(actual.samples.map(sample => sample.dts / actual.timescale), times);
  assert.deepEqual(actual.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
  assert.equal(actual.duration / actual.timescale, 0.48);
  const header = Buffer.from(output);
  const strh = header.indexOf("strh");
  assert.equal(header.readUInt32LE(strh + 32) / header.readUInt32LE(strh + 28), 25);
});
