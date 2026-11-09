import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("exports native Matroska PCM16 as raw audio and native frame checksums", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.mka", readFileSync(new URL("./fixtures/mkv-integer-pcm.mka", import.meta.url)));
  const wav = parseWav(readFileSync(new URL("./fixtures/mkv-integer-pcm.wav", import.meta.url)));
  const channel = wav.tracks[0]!.decodedAudio!.channelData[0]!;
  const expected = Buffer.alloc(channel.length * 2);
  channel.forEach((value, index) => expected.writeInt16LE(value * 32768, index * 2));
  const reference = readFileSync(new URL("./fixtures/mkv-integer-pcm-framemd5.txt", import.meta.url), "utf8");
  const run = async (args: string[]) => {
    let stderr = "";
    let stdout = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    return stdout;
  };
  const rows = (text: string) => text.split("\n").filter(line => line && !line.startsWith("#"));
  for (const codec of [[], ["-c:a", "copy"]]) {
    assert.deepEqual(rows(await run(["-i", "/input.mka", ...codec, "-f", "framemd5", "-"])), rows(codec.length ? readFileSync(new URL("./fixtures/mkv-integer-pcm-copy-framemd5.txt", import.meta.url), "utf8") : reference));
    await run(["-i", "/input.mka", ...codec, "-f", "s16le", "/out.raw"]);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).length, expected.length);
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  }

  // Exercise PCM32 decoding, narrowing, and explicit selection from a two-track container.
  const pcm32 = Buffer.alloc(48);
  const values = [-2147483648, -1073741824, -65537, -65536, -1, 0, 1, 65535, 65536, 1073741824, 2147418112, 2147483647];
  values.forEach((value, index) => pcm32.writeInt32LE(value, index * 4));
  volume.writeFileSync("/input.raw", pcm32);
  await run(["-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/input.raw", "-map", "0:a", "-map", "0:a", "-c:a", "copy", "/stereo.mka"]);
  assert.equal(parseMkv(volume.readFileSync("/stereo.mka") as Buffer).tracks.length, 2);
  for (const stream of ["0:0", "0:1"]) {
    await run(["-i", "/stereo.mka", "-map", stream, "-c:a", "pcm_s32le", "-f", "s32le", "/out.raw"]);
    assert.deepEqual(volume.readFileSync("/out.raw"), pcm32);
    await run(["-i", "/stereo.mka", "-map", stream, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"]);
    const narrowed = Buffer.alloc(24);
    values.forEach((value, index) => narrowed.writeInt16LE(Math.floor(value / 65536), index * 2));
    assert.deepEqual(volume.readFileSync("/out.raw"), narrowed);
    await run(["-i", "/stereo.mka", "-map", stream, "-c:a", "copy", "/out.wav"]);
    assert.deepEqual(Buffer.concat(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.samples.map(sample => Buffer.from(sample.data))), pcm32);
  }
});
