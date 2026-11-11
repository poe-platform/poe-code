import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [expression, start] of [
    ["-1", -1], ["0", 0], ["2147483647", 2147483647], ["2147483648", 2147483648],
    ["2+2", 4], ["2*(3+1)", 8], ["0-1", -1], ["2147483647+1", 2147483648],
    ["3/2", 1.5], ["1/0", Infinity], ["2+", NaN]
  ] as const) {
    for (const explicitFormat of [false, true]) {
      it(`image2 output start ${expression}, sync=${sync}, explicit format=${explicitFormat}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.png", encodeImage({
          width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(255),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
        const args = ["-i", "/in.png", "-start_number", expression,
          ...(explicitFormat ? ["-f", "image2"] : []), "/out%d.png"];
        const success = Number.isInteger(start) && start >= 0 && start <= 2147483647;
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, success ? "" : undefined);
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
          assert.equal(result.exitCode, success ? 0 : 1, Buffer.concat(errors).toString());
        }
        assert.deepEqual(volume.readdirSync("/"), success ? ["in.png", `out${start}.png`] : ["in.png"]);
      });
    }
  }
}
