import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const frames = [[255, 0, 0, 255], [0, 0, 255, 255]].map(color => ({
  width: 2, height: 2, channels: 4 as const,
  data: Uint8Array.from({ length: 16 }, (_, i) => color[i % 4]!),
  format: "png" as const, space: "srgb" as const, depth: "uchar" as const,
  density: 72, hasAlpha: true
}));
const images = frames.map(frame => encodeImage(frame, { format: "png" }).data);
const stream = Buffer.concat(images);

async function run(args: string[], sync = false) {
  const volume = Volume.fromJSON({ "/stream.bin": stream, "/in.png": Buffer.from(images[0]!) });
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; })
    : await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield stream; })(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
  return { volume, result, stderr };
}

for (const option of ["-c:v", "-vcodec", "-codec:v"]) {
  for (const source of ["/stream.bin", "pipe:0"]) {
    for (const encoder of [undefined, "rawvideo", "copy"]) {
      it(`keeps ${option} png input separate from ${encoder ?? "default"} rawvideo output (${source})`, async () => {
        const { volume, result, stderr } = await run([
          "-y", "-v", "error", "-f", "image2pipe", option, "png", "-i", source,
          ...(encoder ? [option, encoder] : []), "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"
        ]);
        assert.deepEqual(result, { exitCode: 0 }, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), encoder === "copy"
          ? stream : Buffer.concat(frames.map(frame => frame.data.filter((_, i) => i % 4 !== 3))));
      });
    }
  }

  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} chooses the output image encoder independently of ${option} png`, async () => {
      const { volume, result, stderr } = await run([
        "-y", "-v", "error", option, "png", "-i", "/in.png", "/out.bmp"
      ], sync);
      assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
      const bytes = volume.readFileSync("/out.bmp") as Buffer;
      assert.equal(bytes.subarray(0, 2).toString(), "BM");
      const image = decodeImage(bytes);
      assert.equal(image.width, 2);
      assert.equal(image.height, 2);
      assert.deepEqual(image.data, frames[0]!.data);
    });

    for (const decoder of ["not_a_decoder", "copy"]) {
      it(`${sync ? "sync" : "async"} rejects input ${option} ${decoder} even with an output encoder`, async () => {
        const { volume, result, stderr } = await run([
          "-y", option, decoder, "-i", "/in.png", "-c:v", "bmp", "/out.bmp"
        ], sync);
        assert.deepEqual(result, sync ? undefined : { exitCode: 1 }, stderr);
        if (!sync) assert.ok(stderr.includes(`Unknown decoder '${decoder}'`), stderr);
        assert.equal(volume.existsSync("/out.bmp"), false);
      });
    }
  }
}
