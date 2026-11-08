import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const mode of ["async", "sync"] as const) {
  for (const flag of ["-frames:v", "-vframes"]) {
    for (const limit of [0, 1, 2, undefined]) {
      it(`${mode} ${flag} ${limit ?? "omitted"} writes exactly the requested frames`, async () => {
        const volume = new Volume();
        const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
        colors.forEach((color, i) => {
          volume.writeFileSync(`/f0${i}.png`, encodeImage({
            width: 16, height: 16, channels: 4,
            data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => color[channel % 4]!),
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data);
        });
        const args = ["-i", mode === "sync" ? "/f00.png" : "/f%02d.png",
          ...(limit === undefined ? [] : [flag, String(limit)]), "/o%02d.png"];
        if (mode === "sync") {
          assert.equal(evalSyncFfmpeg(undefined, args,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          const errors: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        }
        const count = Math.min(limit ?? 3, mode === "sync" ? 1 : 3);
        const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("o"));
        assert.deepEqual(outputs, Array.from({ length: count }, (_, i) => `o0${i + 1}.png`));
        outputs.forEach((name, i) => {
          const image = decodeImage(volume.readFileSync(`/${String(name)}`) as Buffer);
          assert.deepEqual([...image.data.slice(0, 4)], colors[i]);
        });
      });
    }
  }
}

for (const mode of ["async", "sync"] as const) {
  it(`${mode} zero frames leaves a single image output absent`, async () => {
    const volume = Volume.fromJSON({});
    const png = encodeImage({
      width: 1, height: 1, channels: 4, data: Uint8Array.of(255, 0, 0, 255),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    volume.writeFileSync("/in.png", png);
    const args = ["-i", "/in.png", "-frames:v", "0", "/out.png"];
    if (mode === "sync") {
      assert.equal(evalSyncFfmpeg(undefined, args,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
      } as never);
      assert.equal(result.exitCode, 0);
    }
    assert.equal(volume.existsSync("/out.png"), false);
  });
}
