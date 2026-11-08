import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const pixels = Uint8Array.from({ length: 72 }, (_, i) => (i * 7 + 11) % 256);
async function run(args: string[], bytes = pixels, options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(bytes) });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-y", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, volume };
}

for (const aliases of [false, true]) {
  it(`copies headerless RGB frames to MOV with declared dimensions and rate (aliases=${aliases})`, async () => {
    const result = await run(["-f", "rawvideo", aliases ? "-pix_fmt" : "-pixel_format", "rgb24",
      aliases ? "-s" : "-video_size", "3x2", aliases ? "-r" : "-framerate", "5", "-i", "/in.raw", "-c", "copy", "/out.mov"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const doc = parseMp4(result.volume.readFileSync("/out.mov") as Buffer);
    const track = doc.tracks[0]!;
    assert.equal(track.width, 3);
    assert.equal(track.height, 2);
    assert.equal(track.codecDescriptions[0]!.codecName, "rawvideo");
    assert.equal(track.codecDescriptions[0]!.pixFmt, "rgb24");
    assert.equal(track.samples.length, 4);
    assert.equal(track.samples[0]!.duration / track.timescale, 0.2);
    assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(pixels));
  });
}

for (const copy of [false, true]) {
  it(`handles a partial final raw frame (copy=${copy})`, async () => {
    const bytes = Uint8Array.from([...pixels, 90, 90]);
    const result = await run(["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "3x2",
      "-framerate", "5", "-i", "/in.raw", "-c:v", copy ? "copy" : "rawvideo", "-f", "rawvideo", "/out.raw"], bytes);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.volume.readFileSync("/out.raw"), Buffer.from(copy ? bytes : pixels));
  });
}

for (const size of [undefined, "0x2", "3x-2", "3x2x1", "3.5x2"]) {
  it(`rejects invalid or missing rawvideo dimensions: ${size}`, async () => {
    const result = await run(["-f", "rawvideo", "-pixel_format", "rgb24",
      ...(size ? ["-video_size", size] : []), "-i", "/in.raw", "-c", "copy", "/out.mov"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /video_size/);
    assert.equal(result.volume.existsSync("/out.mov"), false);
  });
}

it("does not inherit rawvideo dimensions or pixel format from an earlier input", async () => {
  for (const secondOptions of [["-pixel_format", "rgb24"], ["-video_size", "3x2"]]) {
    const result = await run(["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "3x2",
      "-i", "/in.raw", "-f", "rawvideo", ...secondOptions, "-i", "/in.raw", "-map", "1:v", "-c", "copy", "/out.mov"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.existsSync("/out.mov"), false);
  }
});

it("keeps input and output pixel formats independent", async () => {
  const result = await run(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "3x2", "-r", "5",
    "-i", "/in.raw", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const expected = Uint8Array.from({ length: 96 }, (_, i) => i % 4 === 3 ? 255 : pixels[Math.floor(i / 4) * 3 + i % 4]!);
  assert.deepEqual(result.volume.readFileSync("/out.raw"), Buffer.from(expected));
});

for (const limits of [{ maxFrames: 3 }, { maxSamplesPerTrack: 3 }, { maxPixelsPerFrame: 5 }, { maxMemoryBytes: 1 }]) {
  it(`enforces rawvideo input resource limits ${JSON.stringify(limits)}`, async () => {
    const result = await run(["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "3x2",
      "-i", "/in.raw", "-c", "copy", "/out.mov"], pixels, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.existsSync("/out.mov"), false);
  });
}
