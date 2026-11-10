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

for (const copy of [false, true]) {
  for (const partial of [false, true]) {
    it(`preserves RGBA input bytes and alpha (copy=${copy}, partial=${partial})`, async () => {
      const frames = Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0e9123b648db6df08", "hex");
      const bytes = partial ? Buffer.concat([frames, Buffer.from([90, 91])]) : frames;
      const result = await run(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", "2x2", "-r", "1",
        "-i", "/in.raw", "-c:v", copy ? "copy" : "rawvideo", "-f", "rawvideo", "/out.raw"], bytes);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.volume.readFileSync("/out.raw"), copy ? bytes : frames);
    });
  }
}

it("packetizes RGBA input at four bytes per pixel", async () => {
  const bytes = Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0e9123b648db6df08", "hex");
  const result = await run(["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
    "-framerate", "1", "-i", "/in.raw", "-c:v", "copy", "-frames:v", "1", "-f", "rawvideo", "/out.raw"], bytes);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.volume.readFileSync("/out.raw"), bytes.subarray(0, 16));
});

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
      "-i", "/in.raw", "-f", "rawvideo", "/out.raw"], pixels, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.existsSync("/out.raw"), false);
  });
}

// Native FFmpeg 7.0.2 reference bytes, including two 2x2 frames.
const grayPixels = Buffer.from("113a638cb5de0730", "hex");
for (const format of ["gray", "gray8"]) {
  for (const frameLimit of [undefined, "1"]) {
    it(`copies ${format} packets with frame limit ${frameLimit}`, async () => {
      const result = await run(["-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "1",
        "-i", "/in.raw", "-c:v", "copy", ...(frameLimit ? ["-frames:v", frameLimit] : []),
        "-f", "rawvideo", "/out.raw"], grayPixels, { limits: { maxFrames: 0 } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.volume.readFileSync("/out.raw"), frameLimit ? grayPixels.subarray(0, 4) : grayPixels);
    });
  }

  it(`serializes RGB24 as ${format} using full-range luminance`, async () => {
    const result = await run(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "1",
      "-i", "/in.raw", "-vf", "null", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
    Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0", "hex"));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((result.volume.readFileSync("/out.raw") as Buffer).toString("hex"), "32ad28a36b99618f");
  });
}

for (const copy of [false, true]) {
  it(`handles a partial final gray frame (copy=${copy})`, async () => {
    const bytes = Buffer.concat([grayPixels, Buffer.from([0, 255])]);
    const result = await run(["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1",
      "-i", "/in.raw", "-c:v", copy ? "copy" : "rawvideo", "-f", "rawvideo", "/out.raw"], bytes);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.volume.readFileSync("/out.raw"), copy ? bytes : grayPixels);
  });
}

it("decodes full-range gray samples to RGB without changing luminance", async () => {
  const bytes = Buffer.from([0, 16, 235, 255]);
  const result = await run(["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
    "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"], bytes);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.volume.readFileSync("/out.raw"), Buffer.from([...bytes].flatMap(value => [value, value, value])));
});

it("enforces the gray output byte limit before writing", async () => {
  const result = await run(["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
    "-f", "rawvideo", "/out.raw"], grayPixels, { limits: { maxOutputBytes: 7 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.volume.existsSync("/out.raw"), false);
});

// Byte-for-byte FFmpeg 7.0.2 reference outputs, including a short final BGRA packet.
const bgra = Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0e9123b648db6df08", "hex");
for (const [format, input, frameBytes] of [
  ["bgra", bgra, 16],
  ["rgb24", pixels, 12],
  ["yuv420p", pixels, 6]
] as const) {
  for (const frameLimit of [false, true]) {
    it(`copies ${format} packets without decoding (one frame=${frameLimit})`, async () => {
      const result = await run(["-v", "error", "-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "1",
        "-i", "/in.raw", "-c:v", "copy", ...(frameLimit ? ["-frames:v", "1"] : []),
        "-f", "rawvideo", "/out.raw"], input, { limits: { maxFrames: 0 } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.volume.readFileSync("/out.raw"), Buffer.from(frameLimit ? input.subarray(0, frameBytes) : input));
    });
  }
}

it("serializes RGB24 frames as BGRA with opaque alpha", async () => {
  const result = await run(["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "1",
    "-i", "/in.raw", "-vf", "null", "-pix_fmt", "bgra", "-f", "rawvideo", "/out.raw"],
  Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0", "hex"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((result.volume.readFileSync("/out.raw") as Buffer).toString("hex"),
    "633a11ffdeb58cff593007ffd4ab82ff4f26fdffcaa178ff451cf3ffc0976eff");
});

for (const format of ["bgra", "rgba"]) {
  it(`decodes complete BGRA frames to ${format} preserving alpha`, async () => {
    const input = Buffer.concat([bgra.subarray(0, 16), Buffer.from("113a63008cb5deff0730590182abd480", "hex"), bgra.subarray(0, 2)]);
    const result = await run(["-f", "rawvideo", "-pix_fmt", "bgra", "-s", "2x2", "-r", "1",
      "-i", "/in.raw", "-vf", "null", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"], input);
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = format === "bgra" ? input.subarray(0, 32)
      : Buffer.from("633a118c07deb530ab8259d44f26fd78633a1100deb58cff59300701d4ab8280", "hex");
    assert.deepEqual(result.volume.readFileSync("/out.raw"), expected);
  });
}

for (const limits of [{ maxSamplesPerTrack: 1 }, { maxOutputBytes: 15 }]) {
  it(`enforces BGRA stream-copy resource limits ${JSON.stringify(limits)}`, async () => {
    const result = await run(["-f", "rawvideo", "-pix_fmt", "bgra", "-s", "2x2", "-i", "/in.raw",
      "-c:v", "copy", "-f", "rawvideo", "/out.raw"], bgra, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Resource limit exceeded/);
    assert.equal(result.volume.existsSync("/out.raw"), false);
  });
}

it("checks BGRA output size before writing", async () => {
  const result = await run(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-i", "/in.raw",
    "-pix_fmt", "bgra", "-f", "rawvideo", "/out.raw"], pixels.subarray(0, 12), { limits: { maxOutputBytes: 15 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.volume.existsSync("/out.raw"), false);
});
