import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/h264-orientation-clean.mp4", import.meta.url));
const document = parseMp4(input);
const width = document.tracks[0]!.width!;
const height = document.tracks[0]!.height!;

function rotatedInput(degrees: number): Buffer {
  return Buffer.from(serializeMp4({ ...document, tracks: document.tracks.map(track => ({
    ...track, matrix: undefined, rotation: degrees
  })) }));
}

async function run(input: Buffer, options: string[] = [], output = "/out.rgb", beforeInput: string[] = []): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.mp4": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...beforeInput, "-i", "/in.mp4", ...options,
      ...(output.endsWith(".rgb") ? ["-pix_fmt", "rgb24", "-f", "rawvideo"] : []), output],
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
  assert.deepEqual(volume.readFileSync("/in.mp4"), input);
  return volume.readFileSync(output) as Buffer;
}

// Independent pixel permutation: container rotation uses clockwise degrees.
function rotateRgb(bytes: Buffer, degrees: number): Buffer {
  const output = Buffer.alloc(bytes.length);
  const outputWidth = degrees === 180 ? width : height;
  const frameSize = width * height * 3;
  for (let start = 0; start < bytes.length; start += frameSize) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = degrees === 90 ? height - 1 - y : degrees === 180 ? width - 1 - x : y;
        const dy = degrees === 90 ? x : degrees === 180 ? height - 1 - y : width - 1 - x;
        bytes.copy(output, start + (dy * outputWidth + dx) * 3, start + (y * width + x) * 3, start + (y * width + x + 1) * 3);
      }
    }
  }
  return output;
}

for (const degrees of [90, 180, 270]) {
  it(`applies ${degrees}-degree QuickTime rotation to every decoded RGB frame`, async () => {
    const plain = await run(input);
    assert.equal(plain.length, width * height * 3 * document.tracks[0]!.samples.length);
    assert.equal((await run(rotatedInput(degrees))).toString("hex"), rotateRgb(plain, degrees).toString("hex"));
  });
}

it("applies display rotation overrides before user filters", async () => {
  const expected = await run(input, ["-vf", "transpose=cclock,crop=10:6:2:4"]);
  const actual = await run(input, ["-vf", "crop=10:6:2:4"], "/out.rgb", ["-display_rotation", "90"]);
  assert.deepEqual(actual, expected);
});

it("encodes rotated geometry and clears the consumed display matrix", async () => {
  const output = await run(rotatedInput(270), ["-c:v", "libx264", "-tune", "zerolatency"], "/out.mp4");
  const track = parseMp4(output).tracks[0]!;
  assert.deepEqual([track.width, track.height], [height, width]);
  assert.deepEqual(track.matrix, document.tracks[0]!.matrix);
  assert.equal(track.samples.length, document.tracks[0]!.samples.length);
});

it("keeps the original encoded packets and display matrix during stream copy", async () => {
  const source = rotatedInput(270);
  const copied = parseMp4(await run(source, ["-c", "copy"], "/out.mp4")).tracks[0]!;
  const original = parseMp4(source).tracks[0]!;
  assert.deepEqual(copied.matrix, original.matrix);
  assert.deepEqual(copied.samples.map(sample => sample.data), original.samples.map(sample => sample.data));
});

it("declines synchronous transcoding when display rotation requires the async filters", () => {
  const volume = Volume.fromJSON({ "/in.mp4": rotatedInput(270) });
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mp4", "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.rgb"], undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.equal(volume.existsSync("/out.rgb"), false);
});

it("uses rotated frames in mapped filter graphs without rotating them twice", async () => {
  const expected = await run(input, ["-vf", "transpose=cclock,crop=10:6:2:4"]);
  const actual = await run(rotatedInput(270), ["-filter_complex", "[0:v]crop=10:6:2:4[out]", "-map", "[out]"]);
  assert.deepEqual(actual, expected);
});

it("allows a zero display rotation override to disable the container rotation", async () => {
  assert.deepEqual(await run(rotatedInput(270), [], "/out.rgb", ["-display_rotation", "0"]), await run(input));
});

for (const [rotation, filter, flip] of [
  [45, "rotate=45*PI/180", undefined],
  [90, "transpose=cclock_flip", "-display_hflip"],
  [270, "transpose=clock_flip", "-display_hflip"],
  [0, "vflip", "-display_vflip"]
] as const) {
  it(`matches the existing transform for display rotation ${rotation} with ${flip ?? "no reflection"}`, async () => {
    const expected = await run(input, ["-vf", filter]);
    const actual = await run(input, [], "/out.rgb", ["-display_rotation", String(-rotation), ...(flip ? [flip] : [])]);
    assert.equal(actual.toString("hex"), expected.toString("hex"));
  });
}
