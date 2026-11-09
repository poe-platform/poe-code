import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/guess-layout.wav", import.meta.url));

async function run(args: string[], wav = input) {
  const volume = Volume.fromJSON({ "/in.wav": wav, "/out.wav": "keep" });
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...args],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), wav);
  return { ...result, stdout, stderr, volume };
}

// Native FFmpeg 7.0.2: the threshold changes layout metadata, never PCM packets.
for (const threshold of [undefined, "-1", "0", "1", "2", "2147483647"]) {
  for (const output of [["-c", "copy"], [], ["-af", "anull"]]) {
    it(`reports the input layout at threshold ${threshold ?? "default"} with ${output.join(" ") || "PCM encoding"}`, async () => {
      const result = await run([
        ...(threshold === undefined ? [] : ["-guess_layout_max", threshold]),
        "-i", "/in.wav", ...output, "-f", "framecrc", "-"
      ]);
      assert.equal(result.exitCode, 0, result.stderr);
      const layout = threshold === undefined || Number(threshold) >= 2 ? "stereo" : "2 channels";
      assert.ok(result.stdout.includes(`#channel_layout_name 0: ${layout}\n`), result.stdout);
      assert.deepEqual(result.stdout.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim())),
      [["0", "0", "0", "24", "96", "0x04082f7f"]]);
    });
  }
}

it("resets the guessing threshold for each input and follows output mapping", async () => {
  const result = await run(["-guess_layout_max", "1", "-i", "/in.wav", "-i", "/in.wav",
    "-map", "1:a", "-map", "0:a", "-c", "copy", "-f", "framecrc", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("#channel_layout_name")),
    ["#channel_layout_name 0: stereo", "#channel_layout_name 1: 2 channels"]);
});

for (const mask of [0, 3]) {
  for (const codec of ["copy", "pcm_s16le"]) {
    it(`preserves an explicit WAV mask ${mask} with ${codec}`, async () => {
      const doc = parseWav(input);
      const wav = Buffer.from(serializeWav({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        decodedAudio: { ...track.decodedAudio!, channelMask: mask }
      })) }, { audioCodec: "pcm_s24le" }));
      const result = await run(["-guess_layout_max", "0", "-i", "/in.wav", "-c", codec, "-f", "framecrc", "-"], wav);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes(`#channel_layout_name 0: ${mask ? "stereo" : "2 channels"}\n`), result.stdout);
    });
  }
}

for (const format of ["framecrc", "framehash", "framemd5"]) {
  it(`${format} uses the filtered channel layout instead of the unknown input layout`, async () => {
    const result = await run(["-guess_layout_max", "0", "-i", "/in.wav",
      "-af", "pan=stereo|c0=FL|c1=FR", "-f", format, "-"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("#channel_layout_name 0: stereo\n"), result.stdout);
  });
}

for (const options of [
  ["-ch_layout", "stereo", "-guess_layout_max", "0"],
  ["-guess_layout_max", "0", "-channel_layout", "stereo"]
]) {
  it(`honors an explicit input layout before guessing: ${options.join(" ")}`, async () => {
    const result = await run([...options, "-i", "/in.wav", "-c", "copy", "-f", "framecrc", "-"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("#channel_layout_name 0: stereo\n"), result.stdout);
  });
}

for (const threshold of [undefined, "1"]) {
  it(`keeps named-channel pan working at threshold ${threshold ?? "default"}`, async () => {
    const result = await run([...(threshold === undefined ? [] : ["-guess_layout_max", threshold]),
      "-i", "/in.wav", "-af", "pan=mono|c0=FR", "/out.wav"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 1);
    assert.deepEqual(audio.channelData[0], parseWav(input).tracks[0]!.decodedAudio!.channelData[1]);
  });
}

for (const value of ["", "bad", "1.5", "2147483648", "-2147483649"]) {
  it(`rejects invalid guessing threshold ${JSON.stringify(value)} without overwriting output`, async () => {
    const result = await run(["-guess_layout_max", value, "-i", "/in.wav", "/out.wav"]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("guess_layout_max"), result.stderr);
    assert.equal(result.volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("rejects an input guessing threshold after the last input", async () => {
  const result = await run(["-i", "/in.wav", "-guess_layout_max", "1", "/out.wav"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.volume.readFileSync("/out.wav", "utf8"), "keep");
});
