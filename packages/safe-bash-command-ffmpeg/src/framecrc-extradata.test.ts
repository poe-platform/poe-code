import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function framecrc(inputs: string[], maps: string[], codec: string, target: string): Promise<string> {
  const volume = Volume.fromJSON({});
  for (const input of inputs) {
    volume.writeFileSync(`/${input}`, input === "pcm.wav"
      ? encodeWav({ sampleRate: 8000, channels: [new Float64Array(32)] })
      : readFileSync(new URL(`./fixtures/${input}`, import.meta.url)));
  }
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...inputs.flatMap(input => ["-i", `/${input}`]),
      ...maps.flatMap(map => ["-map", map]), "-c:a", codec, "-f", "framecrc", target],
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
  assert.equal(result.exitCode, 0, stderr);
  return (target === "-" ? stdout : volume.readFileSync(target, "utf8").toString())
    .split("\n").filter(line => !line.startsWith("#software:")).join("\n");
}

for (const target of ["-", "/out.txt"]) {
  it(`emits the native AAC extradata checksum before stream headers to ${target}`, async () => {
    // FFmpeg 7.0.2: -i framecrc.m4a -c:a copy -f framecrc -
    const output = await framecrc(["framecrc.m4a"], [], "copy", target);
    assert.ok(output.startsWith("#extradata 0:        5, 0x055501d8\n#tb 0: 1/8000\n"), output);
    assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").slice(3, 6).map(field => field.trim())), [
      ["1024", "551", "0x9060ee8e"],
      ["1024", "531", "0x96d12222"],
      ["1024", "529", "0xa2c60e43"],
      ["1024", "539", "0xe0b9e71b"],
      ["128", "5", "0x03c001be"]
    ]);
  });
}

it("checksums only FLAC STREAMINFO, excluding container and other metadata", async () => {
  const output = await framecrc(["framecrc.flac"], [], "copy", "-");
  assert.ok(output.startsWith("#extradata 0:       34, 0x938d0b94\n#tb 0: 1/8000\n"), output);
});

it("places all extradata headers first using mapped output stream indices", async () => {
  const output = await framecrc(["framecrc.m4a", "framecrc.flac", "pcm.wav"],
    ["2:a", "1:a", "0:a", "0:a"], "copy", "-");
  assert.deepEqual(output.split("\n").slice(0, 4), [
    "#extradata 1:       34, 0x938d0b94",
    "#extradata 2:        5, 0x055501d8",
    "#extradata 3:        5, 0x055501d8",
    "#tb 0: 1/8000"
  ]);
});

for (const input of ["pcm.wav", "framecrc.flac"]) {
  for (const codec of input === "pcm.wav" ? ["copy", "pcm_s16le"] : ["pcm_s16le"]) {
    it(`omits extradata for ${input} with ${codec} output`, async () => {
      const output = await framecrc([input], [], codec, "-");
      assert.ok(!output.includes("#extradata"), output);
    });
  }
}
