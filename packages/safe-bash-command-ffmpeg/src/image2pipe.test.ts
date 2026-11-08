import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const target of ["/out.bin", "/out%02d.png", "pipe:1"]) {
  for (const codec of ["copy", "png"]) {
    for (const count of [1, 2]) {
      it(`writes ${count} concatenated ${codec} image packets to ${target}`, async () => {
        const volume = Volume.fromJSON({});
        const packets = [[255, 0, 0, 255], [0, 0, 255, 255]].map((color, index) => {
          const image = encodeImage({
            width: 1, height: 1, data: Uint8Array.from(color), channels: 4,
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data;
          const packet = Buffer.concat([image, Buffer.from("original packet")]);
          volume.writeFileSync(`/in${index + 1}.png`, packet);
          return codec === "copy" ? packet : image;
        });
        const args = ["-y", "-v", "error", "-i", count === 1 ? "/in1.png" : "/in%d.png", "-c:v", codec,
          "-frames:v", String(count), "-f", "image2pipe", target];
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target),
          Buffer.concat(packets.slice(0, count)));
      });
    }
  }
}
