import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: 2x2 gbrapf32le, including negative and above-one samples,
// encoded with -c:v exr -f image2pipe. Native stream-copy CRC is 0x6107591c.
const packet = Buffer.from("di8xAQIAAABjaGFubmVscwBjaGxpc3QASQAAAEEAAgAAAAAAAAABAAAAAQAAAEIAAgAAAAAAAAABAAAAAQAAAEcAAgAAAAAAAAABAAAAAQAAAFIAAgAAAAAAAAABAAAAAQAAAABjb21wcmVzc2lvbgBjb21wcmVzc2lvbgABAAAAAGRhdGFXaW5kb3cAYm94MmkAEAAAAAAAAAAAAAAAAQAAAAEAAABkaXNwbGF5V2luZG93AGJveDJpABAAAAAAAAAAAAAAAAEAAAABAAAAbGluZU9yZGVyAGxpbmVPcmRlcgABAAAAAHNjcmVlbldpbmRvd0NlbnRlcgB2MmYACAAAAAAAAAAAAAAAc2NyZWVuV2luZG93V2lkdGgAZmxvYXQABAAAAAAAgD9mcmFtZXNQZXJTZWNvbmQAcmF0aW9uYWwACAAAABkAAAABAAAAZ2FtbWEAZmxvYXQABAAAAAAAgD93cml0ZXIAc3RyaW5nAAQAAABsYXZjAIsBAAAAAAAAswEAAAAAAAAAAAAAIAAAAAAAAD4AAIA+AADAPgAAgD4AAIC+AAAAPgAAQD8AAIA/AQAAACAAAAAAAAA/AACAPwAAAEAAAEA/AAAAPwAAwD8AAAC/AACAPQ==", "base64");

for (const fps of [25, 2]) {
  const source = "/input.exr";
  for (const format of ["image2pipe", "framecrc"]) {
    for (const count of [1, 2]) {
      it(`copies an EXR file containing ${count} image(s) to ${format} at ${fps} fps`, async () => {
        const input = Buffer.concat(Array.from({ length: count }, () => packet));
        const volume = Volume.fromJSON({ "/input.exr": input });
        const args = ["-v", "error", "-f", "exr_pipe", ...(fps === 25 ? [] : ["-framerate", String(fps)]), "-i", source,
          "-c:v", "copy", "-f", format, "pipe:1"];
        assert.equal(evalSyncFfmpeg(input, args,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          () => { assert.fail("EXR input must use the async demuxer"); }), undefined);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); } },
          stdin: (async function* () {
            for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
          })(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        if (format === "image2pipe") assert.deepEqual(output, input);
        else {
          const lines = output.toString().trim().split("\n");
          for (const line of [`#tb 0: 1/${fps}`, "#codec_id 0: exr", "#dimensions 0: 2x2", "#sar 0: 0/1"]) {
            assert.ok(lines.includes(line), output.toString());
          }
          assert.deepEqual(lines.filter(line => !line.startsWith("#")), [
            `0,          0,          0,        1,      ${count * 475}, ${count === 1 ? "0x6107591c" : "0x22bcb238"}`]);
        }
      });
    }
  }
}

for (const scenario of ["header-only", "invalid-header", "wrong-format", "pixel-limit", "frame-limit", "sample-limit"] as const) {
  it(`handles EXR copy ${scenario} without decoding pixels`, async () => {
    // Pixel data and the offset table may be absent: packet copy only reads metadata.
    const input = scenario === "header-only" ? packet.subarray(0, 379)
      : scenario === "invalid-header" ? packet.subarray(0, 30)
      : scenario === "wrong-format" ? Buffer.from("P6\n1 1\n255\nRGB") : packet;
    const volume = Volume.fromJSON({ "/input.exr": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const limits = scenario === "pixel-limit" ? { maxPixelsPerFrame: 3 }
      : scenario === "frame-limit" ? { maxFrames: 0 }
      : scenario === "sample-limit" ? { maxSamplesPerTrack: 0 } : {};
    const result = await createFfmpegCommand({ limits }).execute({
      args: ["-v", "error", "-f", "exr_pipe", "-i", "/input.exr", "-c:v", "copy", "-f", "image2pipe", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (scenario === "header-only") {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), input);
    } else {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).length, 0);
      if (scenario.endsWith("-limit")) assert.ok(stderr.includes(Object.keys(limits)[0]!), stderr);
    }
  });
}
