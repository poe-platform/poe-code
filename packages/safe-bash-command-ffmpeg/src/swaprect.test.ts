import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { swapRect } from "./swaprect.js";

async function run(input: Buffer, format: string, filter: string, size = "4x2", outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-i", "/in.raw", "-vf", filter, "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(output);
}

for (const filter of ["swaprect", "swaprect=2:1:0:0:2:1", "swaprect=w=w/2:h=h/2:x1=0:y1=0:x2=w/2:y2=h/2:"]) {
  it(`accepts ${filter}`, async () => {
    assert.equal((await run(Buffer.from("2f3a45505b66717c", "hex"), "gray", filter)).toString("hex"), "717c45505b662f3a");
  });
}

it("swaps overlapping rows in order", async () => {
  assert.deepEqual(await run(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), "gray", "swaprect=1:3:0:0:0:1", "2x4"),
    Buffer.from([3, 2, 5, 4, 7, 6, 1, 8]));
});

it("clamps coordinates and leaves a clipped rectangle unchanged", async () => {
  const input = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(await run(input, "gray", "swaprect=1:1:-1:-1:100:100"), Buffer.from([8, 2, 3, 4, 5, 6, 7, 1]));
  assert.deepEqual(await run(input, "gray", "swaprect=2:1:0:0:3:1"), input);
});

for (const [format, inputHex, expectedHex] of [
  ["yuv420p", "0102030405060708090a0b0c0d0e0f101112131415161718",
    "0b0c03040f100708090a01020d0e05061412131118161715"],
  ["gray16le", "01010202030304040505060607070808", "07070808030304040505060601010202"],
  ["rgba", "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
    "191a1b1c1d1e1f20090a0b0c0d0e0f1011121314151617180102030405060708"]
] as const) {
  it(`preserves ${format} samples and alpha through rectangle swaps`, async () => {
    const input = Buffer.from(inputHex, "hex");
    const filter = format === "yuv420p" ? "swaprect=2:2:0:0:2:2" : "swaprect=2:1:0:0:2:1";
    const size = format === "yuv420p" ? "4x4" : "4x2";
    assert.equal((await run(input, format, filter, size)).toString("hex"), expectedHex);
    assert.deepEqual(await run(input, format, `${filter},${filter}`, size), input);
  });
}

it("keeps downstream RGB output consistent with swapped native samples", async () => {
  const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a", "hex");
  const actual = await run(input, "yuv444p", "swaprect,format=rgba", "4x2", "rgba");
  const expected = await run(input, "yuv444p", "format=rgba,swaprect", "4x2", "rgba");
  assert.equal(actual.length, expected.length);
  // The raw decoder and swscale differ by up to two levels in RGB rounding.
  for (const [i, value] of actual.entries()) assert.ok(Math.abs(value - expected[i]!) <= 2);
});

it("honors memory limits and cancellation without mutating the source frame", async () => {
  const data = new Uint8Array(32).fill(7);
  const frame = { data, width: 4, height: 2, ptsSeconds: 0, durationSeconds: 1, keyframe: true };
  const options = ["2", "1", "0", "0", "2", "1"];
  await assert.rejects(swapRect(frame, options, 0, 1, new MediaBudgetTracker({ maxMemoryBytes: 1 })),
    (error: Error) => error.message.includes("maxMemoryBytes"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(swapRect(frame, options, 0, 1, new MediaBudgetTracker(), controller.signal),
    (error: Error) => error.name === "AbortError");
  assert.deepEqual(data, new Uint8Array(32).fill(7));
});

// Complete output bytes verified against native Linux FFmpeg 7.0.2.
for (const [format, inputHex, expectedHex] of [
  ["gray", "2f3a45505b66717c", "717c45505b662f3a"],
  ["yuv444p", "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a",
    "717c45505b662f3ac9d49da8b3be87924f5a232e3944df18"]
] as const) {
  const input = Buffer.from(inputHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  const filter = "swaprect=w=2:h=1:x1=0:y1=0:x2=2:y2=1";
  it(`preserves ${format} with the null control`, async () => {
    assert.deepEqual(await run(input, format, "null"), input);
  });
  it(`swaps two ${format} rectangles across rows`, async () => {
    assert.deepEqual(await run(input, format, filter), expected);
  });
  it(`restores ${format} exactly after two swaps`, async () => {
    assert.deepEqual(await run(input, format, `${filter},${filter}`), input);
  });
  it(`swaps every ${format} frame independently`, async () => {
    assert.deepEqual(await run(Buffer.concat([input, expected]), format, filter), Buffer.concat([expected, input]));
  });
}
