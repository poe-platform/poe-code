import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("maps and copies MP3 audio from native FLV", async () => {
  const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/mp3.flv", import.meta.url)));
  const volume = Volume.fromJSON({ "/in.flv": Buffer.from(input) });
  const args = ["-y", "-v", "error", "-i", "/in.flv", "-map", "0:a", "-c", "copy", "/out.flv"];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: volume.promises as never,
    stdin: (async function* () {})() as never,
    stdout: { async write() {} } as never,
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } } as never
  });
  assert.equal(result.exitCode, 0, stderr);
  const output = parseFlv(new Uint8Array(volume.readFileSync("/out.flv") as Uint8Array));
  assert.equal(output.tracks.length, 1);
  assert.equal(output.tracks[0]!.codecDescriptions[0]!.codecName, "mp3");
  assert.equal(output.tracks[0]!.samples.length, 78);
  assert.deepEqual(output.tracks[0]!.samples, parseFlv(input).tracks.find(track => track.type === "audio")!.samples);
});
