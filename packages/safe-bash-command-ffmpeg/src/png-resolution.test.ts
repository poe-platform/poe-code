import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Uint8Array.from({ length: 8 * 4 * 3 }, (_, i) =>
  (Math.floor(i / 3) % 8 * 23 + Math.floor(i / 24) * 41 + i % 3 * 53) % 256);

async function run(options: readonly string[], mode: "pipe" | "file" | "sequence" | "sync") {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input), "/out1.png": "unchanged" });
  volume.writeFileSync("/in.ppm", Buffer.concat([Buffer.from("P6\n8 4\n255\n"), input]));
  const args = ["-y", "-v", "error", ...(mode === "sync" ? ["-i", "/in.ppm"] : ["-f", "rawvideo", "-pixel_format", "rgb24",
    "-video_size", "8x4", "-i", "/in.raw"]), "-frames:v", "1", "-c:v", "png",
    ...options, "-f", mode === "pipe" ? "image2pipe" : "image2", mode === "pipe" ? "pipe:1" : mode === "file" ? "/out1.png" : "/out%d.png"];
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const before = volume.toJSON();
  let success: boolean;
  if (mode === "sync") {
    success = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }) === "";
  } else {
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    success = result.exitCode === 0;
  }
  return { success, stderr, volume, before, bytes: mode === "pipe" ? Buffer.concat(stdout) : volume.readFileSync("/out1.png") as Buffer };
}

for (const mode of ["pipe", "file", "sequence", "sync"] as const) {
  for (const [options, expected] of [
    [[], [0, 1, 0]],
    [["-dpi", "96"], [3779, 3779, 1]],
    [["-dpm", "4000"], [4000, 4000, 1]],
    [["-dpi", "1"], [39, 39, 1]],
    [["-dpi", "65536"], [2580157, 2580157, 1]],
    [["-dpm", "65536"], [65536, 65536, 1]],
    [["-dpi", "0", "-dpm", "0"], [0, 1, 0]],
    [["-dpi", "0", "-dpm", "4000"], [4000, 4000, 1]],
    [["-dpi", "96", "-dpi", "72"], [2834, 2834, 1]],
    [["-vf", "setsar=4/3"], [4, 3, 0]],
    [["-vf", "setsar=1"], [1, 1, 0]],
    [["-vf", "setsar=0"], [0, 1, 0]],
    [["-vf", "setsar=4/3", "-dpi", "96"], [3779, 3779, 1]]
  ] as const) {
    if (mode === "sync" && options.some(option => option === "-vf")) continue;
    it(`writes native PNG pHYs for ${options.join(" ") || "untagged input"} (${mode})`, async () => {
      const { success, stderr, bytes, volume } = await run(options, mode);
      assert.equal(success, true, stderr);
      const physical = [];
      for (let offset = 8; offset < bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
        if (bytes.toString("ascii", offset + 4, offset + 8) === "pHYs") {
          assert.equal(bytes.readUInt32BE(offset), 9);
          physical.push([bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12), bytes[offset + 16]]);
        }
      }
      assert.deepEqual(physical, [expected]);
      const decoded = decodeImage(bytes);
      assert.deepEqual([decoded.width, decoded.height], [8, 4]);
      assert.deepEqual(decoded.data.filter((_, i) => i % 4 !== 3), input);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/in.raw") as Buffer), input);
    });
  }
  for (const options of [
    ["-dpi", "96", "-dpm", "4000"], ["-dpm", "4000", "-dpi", "96"],
    ...["-dpi", "-dpm"].flatMap(option => ["-1", "65537", "NaN", "bad", ""].map(value => [option, value]))
  ]) {
    it(`rejects invalid PNG resolution without writing: ${options.join(" ")} (${mode})`, async () => {
      const { success, volume, before, bytes } = await run(options, mode);
      assert.equal(success, false);
      assert.deepEqual(volume.toJSON(), before);
      if (mode === "pipe") assert.equal(bytes.length, 0);
    });
  }
}

for (const options of [[], ["-dpi", "96"], ["-dpm", "4000"]]) {
  it(`defers synchronous single PNG encoding to the async path: ${options.join(" ")}`, () => {
    const volume = Volume.fromJSON({ "/in.ppm": Buffer.concat([Buffer.from("P6\n8 4\n255\n"), input]) });
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.ppm", "-c:v", "png", ...options, "/out.png"], undefined,
      path => volume.readFileSync(path) as Buffer,
      () => { assert.fail("must not write before fallback"); }), undefined);
  });
}
