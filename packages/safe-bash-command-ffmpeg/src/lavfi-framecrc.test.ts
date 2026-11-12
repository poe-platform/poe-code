import assert from "node:assert/strict";
import { it } from "node:test";
import { createFfmpegCommand } from "./index.js";

for (const [duration, frames] of [[0.128, 1024], [0.25, 2000]] as const) for (const frequency of [1000, 0]) {
  it(`checksums generated ${frequency} Hz sine PCM for ${frames} samples with a zero Adler-32 seed`, async () => {
    const outputs = new Map<string, Buffer>();
    for (const format of ["s16le", "framecrc"]) {
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "lavfi", "-i", `sine=r=8000:d=${duration}:f=${frequency}`,
          "-c:a", "pcm_s16le", "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal, fs: {},
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      outputs.set(format, Buffer.concat(chunks));
    }
    const pcm = outputs.get("s16le")!;
    assert.equal(pcm.length, frames * 2);
    assert.equal(pcm.some(byte => byte !== 0), frequency !== 0);
    const expected = [];
    for (let start = 0; start < frames; start += 1024) {
      const packet = pcm.subarray(start * 2, (start + 1024) * 2);
      let a = 0, b = 0;
      for (const byte of packet) { a = (a + byte) % 65521; b = (b + a) % 65521; }
      const checksum = `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
      expected.push(["0", String(start), String(start), String(packet.length / 2), String(packet.length), checksum]);
    }
    const rows = outputs.get("framecrc")!.toString().split("\n")
      .filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()));
    assert.deepEqual(rows, expected);
  });
}
