import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const base = parseMp4(readFileSync(new URL("./fixtures/rotation-45.mp4", import.meta.url)));
const original = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, matrix: undefined, rotation: 0 })) });
const rotated = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, matrix: undefined, rotation: 90 })) });

for (const rotation of [false, true]) {
  for (const secondInput of [false, true]) {
    it(`decodes unrotated RGB frames with -noautorotate (rotation=${rotation}, secondInput=${secondInput})`, async () => {
      const volume = Volume.fromJSON({ "/plain.mp4": Buffer.from(original), "/in.mp4": Buffer.from(rotation ? rotated : original) });
      const output = ["-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"];
      const control = await execute(volume, ["-i", "/plain.mp4", ...output]);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(control.stdout.length, 32 * 16 * 3 * 2);
      const result = await execute(volume, [...(secondInput ? ["-i", "/plain.mp4"] : []),
        "-noautorotate", "-i", "/in.mp4", "-map", `${secondInput ? 1 : 0}:v:0`, ...output]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, control.stdout);
    });
  }
}

it("resets -noautorotate before the next input", async () => {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(rotated) });
  const output = ["-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"];
  const control = await execute(volume, ["-i", "/in.mp4", ...output]);
  const unrotated = await execute(volume, ["-noautorotate", "-i", "/in.mp4", ...output]);
  const result = await execute(volume, ["-noautorotate", "-i", "/in.mp4", "-i", "/in.mp4", "-map", "1:v:0", ...output]);
  for (const run of [control, unrotated, result]) assert.equal(run.exitCode, 0, run.stderr);
  assert.notDeepEqual(unrotated.stdout, control.stdout);
  assert.deepEqual(result.stdout, control.stdout);
});

for (const sync of [false, true]) {
  const format = sync ? "png" : "tiff";
  it(`preserves ${format} dimensions and pixels with -noautorotate (sync=${sync})`, async () => {
    const data = Uint8Array.from({ length: 8 * 4 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 23) % 256);
    const input = encodeImage({ width: 8, height: 4, data, channels: 4, format, space: "srgb",
      depth: "uchar", density: 72, hasAlpha: false }, { format }).data;
    const volume = Volume.fromJSON({ [`/in.${format}`]: Buffer.from(input) });
    const args = ["-y", "-noautorotate", "-i", `/in.${format}`, "-frames:v", "1", "/out%d.png"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      const result = await execute(volume, args);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const image = decodeImage(volume.readFileSync("/out1.png") as Buffer);
    assert.equal(image.width, 8);
    assert.equal(image.height, 4);
    assert.deepEqual(image.data, data);
  });

  it(`preserves display metadata and compressed packets with -noautorotate stream copy (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(rotated) });
    const args = ["-y", "-noautorotate", "-i", "/in.mp4", "-c:v", "copy", "/out.mp4"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      const result = await execute(volume, args);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const input = parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!;
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.deepEqual(output.matrix, input.matrix);
    assert.deepEqual(output.samples.map(sample => sample.data), input.samples.map(sample => sample.data));
  });

  it(`rejects output placement of -noautorotate without replacing output (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(rotated), "/out.mp4": "existing output" });
    const args = ["-y", "-i", "/in.mp4", "-noautorotate", "-c:v", "copy", "/out.mp4"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    } else {
      const result = await execute(volume, args);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.ok(result.stderr.includes("-noautorotate must precede an input"), result.stderr);
      assert.equal(result.stdout.length, 0);
    }
    assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing output");
  });
}

async function execute(volume: Volume, args: string[]) {
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout: Buffer.concat(stdout), stderr };
}
