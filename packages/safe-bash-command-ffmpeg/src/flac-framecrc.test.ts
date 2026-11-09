import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("reports physical FLAC packets in stream-copy framecrc output", async () => {
  const volume = Volume.fromJSON({
    "/tone.flac": readFileSync(new URL("./fixtures/framecrc.flac", import.meta.url))
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.flac", "-c:a", "copy", "-f", "framecrc", "/out.txt"],
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
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.txt", "utf8").toString();
  assert.ok(output.includes("#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: flac\n#sample_rate 0: 8000\n#channel_layout_name 0: mono\n"));
  // Native FFmpeg 7.0.2: stream, DTS, PTS, sample duration, byte size, Adler-32.
  assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim())), [
    ["0", "0", "0", "576", "487", "0x0912f11d"],
    ["0", "576", "576", "576", "510", "0x36a2cc09"],
    ["0", "1152", "1152", "576", "496", "0xca32bbfd"],
    ["0", "1728", "1728", "576", "553", "0x32940980"],
    ["0", "2304", "2304", "576", "568", "0xd84e1df3"],
    ["0", "2880", "2880", "320", "359", "0xabbfb3e4"]
  ]);
});
