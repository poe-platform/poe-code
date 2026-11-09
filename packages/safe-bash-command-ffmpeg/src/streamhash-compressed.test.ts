import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/streamhash-input.wav", import.meta.url));

for (const [codec, format, settings] of [
  ["adpcm_ima_wav", "wav", []],
  ["adpcm_ima_wav", "wav", ["-block_size", "256", "-trellis", "0"]],
  ["flac", "flac", []],
  ["flac", "flac", ["-compression_level", "0", "-frame_size", "512"]]
] as const) {
  it(`streamhash hashes ${codec} encoder packets (${settings.join(" ") || "defaults"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", input);
    const run = async (args: string[]) => {
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", codec, ...settings, ...args],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      return stdout;
    };
    await run(["-f", format, "/encoded"]);
    const encoded = fs.readFileSync("/encoded") as Buffer;
    let payload: Uint8Array;
    if (format === "wav") {
      let offset = 12;
      while (encoded.toString("ascii", offset, offset + 4) !== "data") {
        const size = encoded.readUInt32LE(offset + 4);
        offset += 8 + size + size % 2;
        assert.ok(offset + 8 <= encoded.length);
      }
      payload = encoded.subarray(offset + 8, offset + 8 + encoded.readUInt32LE(offset + 4));
    } else {
      let offset = 4;
      for (;;) {
        const last = encoded[offset]! & 128;
        offset += 4 + encoded.readUIntBE(offset + 1, 3);
        if (last) break;
        assert.ok(offset + 4 <= encoded.length);
      }
      payload = encoded.subarray(offset);
    }
    const digest = createHash("sha256").update(payload).digest("hex");
    if (codec === "adpcm_ima_wav" && settings.length === 0) {
      // Native FFmpeg's 1024-byte encoder packet for this input.
      assert.equal(payload.length, 1024);
      assert.equal(digest, "93721ea1124922053d05b77022de1cbd80139e9664e3fe5e6e8979848953c004");
    }
    assert.equal(await run(["-f", "streamhash", "-"]), `0,a,SHA256=${digest}\n`);
    assert.equal(await run(["-map", "0:a", "-map", "0:a", "-f", "streamhash", "-"]),
      `0,a,SHA256=${digest}\n1,a,SHA256=${digest}\n`);
    await run(["-f", "streamhash", "/digest.txt"]);
    assert.equal(fs.readFileSync("/digest.txt", "utf8"), `0,a,SHA256=${digest}\n`);
  });
}
