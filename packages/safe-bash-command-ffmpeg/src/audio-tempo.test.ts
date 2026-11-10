import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 PCM16 references: mono at 8 kHz, -af atempo=1.
for (const [pattern, length, expectedLength, hash] of [
  ["flat", 511, 511, "04cc2892f2761d91a9d22f56442eef4d426de455fe66b147289ec84c4dc6080a"],
  ["flat", 512, 512, "d96d345daef2f91e07a49c99937ea44fd3143a26de5b1edbf656e98042e0984d"],
  ["flat", 513, 512, "d96d345daef2f91e07a49c99937ea44fd3143a26de5b1edbf656e98042e0984d"],
  ["flat", 768, 750, "1663464f8a5d816e0df4450bce4355394c8b7a1c12268cf45b0fe81f587b63be"],
  ["flat", 769, 751, "567f5fa336db43a970d1f8fdc67403619b6ff6eb0c69c9fcadfaf81e528883f6"],
  ["flat", 767, 758, "26564bd174310946ad5cb2264f7057931d68117d5847ce8d9f61969521a0989d"],
  ["flat", 770, 752, "caf10c0ce5339a05dc4d07cdcacc12d159cf07eb2b01ed7be9fed74469addc5b"],
  ["flat", 1024, 1011, "0bd3ff7b0235487b5d2cad9fee575e1df91a801f56d19d8593cd04e6019a9fc4"],
  ["ramp", 511, 511, "8630467addcbe83f4466b333c29ced66b19bcf4894b5c5ecb9ca8edbe5aaeccb"],
  ["ramp", 512, 512, "51047b15858a2822e43371325e44edd67c7663e97a64d34852a0d00ab956503a"],
  ["ramp", 513, 513, "1bc6c4c817c6206f3f4a37fc0d6d054ab1917f3a51bdb351ae26168c371b6131"],
  ["ramp", 768, 768, "bffc37cbd7ae0fcbf6e71e5d26cc1da22374619fe09549f9b5f01e33a01d2265"],
  ["ramp", 769, 769, "645d9a7b3c730567153efff2849f934f9ec6b19e8fce09aa1683becc2b3b1895"]
] as const) {
  it(`matches native unity-tempo tail for ${length} ${pattern} input samples`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) input.writeInt16LE(pattern === "flat" ? 16000 : (i % 32 - 16) * 1000, i * 2);
    await fs.writeFile("/in.raw", input);
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", "atempo=1", "-f", "s16le", "/out.raw"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const output = await fs.readFile("/out.raw");
    assert.equal(output.length / 2, expectedLength);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
