import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

async function run(copy: boolean, output: string, options: string[], seeded = false) {
  const volume = new Volume();
  const colors = [32, 64, 96];
  volume.writeFileSync("/frames.raw", Uint8Array.from(colors.flatMap(red =>
    Array.from({ length: 4 }, () => [red, 0, 0]).flat())));
  for (const [index, red] of colors.entries()) {
    volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from(Array.from({ length: 4 }, () => [red, 0, 0, 255]).flat()),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data);
  }
  const original = Buffer.alloc(512, "S");
  if (seeded) volume.writeFileSync(output, original);
  const before = volume.toJSON();
  const writes: string[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(copy ? ["-framerate", "3", "-i", "/f%d.png", "-c:v", "copy"]
      : ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2", "-framerate", "3", "-i", "/frames.raw", "-c:v", "png"]),
      "-f", "image2", "-frame_pts", "1", ...options, output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { writes.push(path); volume.writeFileSync(path, bytes); },
      async rename(from: string, to: string) { volume.renameSync(from, to); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, before, original, writes };
}

for (const copy of [false, true]) {
  for (const seeded of [false, true]) {
    for (const limit of [undefined, 1]) {
      it(`rejects a missing timestamp field before writing: copy=${copy}, seeded=${seeded}, limit=${limit}`, async () => {
        const { result, stderr, volume, before, original, writes } = await run(copy, "/still.png",
          limit === undefined ? [] : ["-frames:v", String(limit)], seeded);
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("Cannot write filename by pts of the frames"), stderr);
        assert.deepEqual(writes, []);
        assert.deepEqual(volume.toJSON(), before);
        if (seeded) assert.deepEqual(volume.readFileSync("/still.png"), original);
      });
    }
  }

  for (const output of ["/still%%d.png", "/still%02x.png"]) {
    it(`rejects invalid timestamp fields without atomic temporary files: copy=${copy}, output=${output}`, async () => {
      const { result, stderr, volume, before, writes } = await run(copy, output,
        ["-atomic_writing", "1", "-frames:v", "1"], true);
      assert.equal(result.exitCode, 234, stderr);
      assert.deepEqual(writes, []);
      assert.deepEqual(volume.toJSON(), before);
    });
  }

  for (const [output, options, names, colors] of [
    ["/f-%02d.png", copy ? ["-frames:v", "1"] : [], copy ? ["/f-00.png"] : ["/f-00.png", "/f-01.png", "/f-02.png"], copy ? [32] : [32, 64, 96]],
    ["/still.png", ["-update", "1"], ["/still.png"], [96]],
    ["/still.png", ["-strftime", "1"], ["/still.png"], [96]],
    ["/still.png", ["-frame_pts", "0", "-frames:v", "1"], ["/still.png"], [32]],
    ["/still.png", ["-f", "image2pipe", "-frames:v", "1"], ["/still.png"], [32]]
  ] as const) {
    it(`preserves timestamp output and override precedence: copy=${copy}, output=${output}, options=${options.join(" ")}`, async () => {
      const { result, stderr, volume } = await run(copy, output, [...options]);
      assert.equal(result.exitCode, 0, stderr);
      for (const [index, name] of names.entries()) {
        assert.equal(decodeImage(volume.readFileSync(name) as Buffer).data[0], colors[index]);
      }
    });
  }
}
