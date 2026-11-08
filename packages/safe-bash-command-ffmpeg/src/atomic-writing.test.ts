import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const copy of [false, true]) for (const atomic of [undefined, "0", "1", "true", "false", "invalid"]) {
  it(`publishes image2 frames: copy=${copy}, atomic=${atomic}`, async () => {
    const volume = Volume.fromJSON({});
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
    for (const [index, color] of colors.entries()) volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data);
    const operations: string[] = [];
    const errors: Uint8Array[] = [];
    const args = ["-y", "-v", "error", "-framerate", "2", "-i", copy ? "/f0.png" : "/f%d.png",
      ...(copy ? ["-c:v", "copy"] : []), ...(atomic === undefined ? [] : ["-atomic_writing", atomic]), "/o%d.png"];
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { operations.push(`write ${path}`); volume.writeFileSync(path, bytes); },
        async rename(from: string, to: string) { operations.push(`rename ${from} ${to}`); volume.renameSync(from, to); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (atomic === "invalid") {
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(operations, []);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(operations, (copy ? [1] : [1, 2]).flatMap(index => atomic === "1" || atomic === "true"
      ? [`write /o${index}.png.tmp`, `rename /o${index}.png.tmp /o${index}.png`]
      : [`write /o${index}.png`]));
    assert.deepEqual(volume.readdirSync("/"), ["f0.png", "f1.png", "o1.png", ...(copy ? [] : ["o2.png"])]);
    for (const [index, color] of colors.slice(0, copy ? 1 : 2).entries()) {
      const image = decodeImage(new Uint8Array(volume.readFileSync(`/o${index + 1}.png`) as Uint8Array));
      assert.deepEqual([...image.data], [...color, ...color, ...color, ...color]);
    }
  });
}

it("defers atomic writing to the async command without sync filesystem writes", () => {
  let writes = 0;
  assert.equal(evalSyncFfmpeg(["-i", "/in.png", "-atomic_writing", "1", "/out.png"], undefined,
    () => undefined, () => { writes++; return true; }), undefined);
  assert.equal(writes, 0);
});
