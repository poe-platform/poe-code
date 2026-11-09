import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/mp3-rounding.mp3", import.meta.url));
// Native FFmpeg 7.0.2: -i in.mp3 -c:a pcm_s16le -f s16le out.pcm.
const expected = readFileSync(new URL("./fixtures/mp3-rounding.pcm", import.meta.url));

async function convert(codec: string, format: string): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.mp3": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.mp3", "-c:a", codec, "-f", format, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out") as Buffer;
}

it("matches every native PCM16 sample decoded from MP3, including negative half steps", async () => {
  const actual = await convert("pcm_s16le", "s16le");
  assert.equal(actual.length, 1600 * 2);
  assert.equal(actual.readInt16LE(78 * 2), -5080);
  assert.equal(actual.readInt16LE(434 * 2), -2128);
  for (let index = 0; index < 1600; index++) {
    assert.equal(actual.readInt16LE(index * 2), expected.readInt16LE(index * 2), `sample ${index}`);
  }
});

it("hashes the native PCM16 bytes when decoding MP3 to streamhash", async () => {
  assert.equal((await convert("pcm_s16le", "streamhash")).toString(),
    `0,a,SHA256=${createHash("sha256").update(expected).digest("hex")}\n`);
});

it("preserves the compressed MP3 streamhash with codec copy", async () => {
  // Native FFmpeg 7.0.2: -i in.mp3 -c:a copy -f streamhash out.txt.
  assert.equal((await convert("copy", "streamhash")).toString(),
    "0,a,SHA256=8ace4c0752ec6a087a12e02a9a5f61bc79bb8b75817850fb714c9b7928db68c8\n");
});
