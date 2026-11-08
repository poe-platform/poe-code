import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const copy of [false, true]) for (const { pattern, flags, tz, expected, tick = 0, invalid = false } of [
  { pattern: "stamp-%%.png", flags: ["-strftime", "1"], tz: "UTC", expected: ["stamp-%.png", "stamp-%.png"] },
  { pattern: "stamp-%Y-%m-%d-%H-%M-%S-%%.png", flags: ["-strftime", "true"], tz: "UTC", expected: ["stamp-2026-11-07-15-04-05-%.png", "stamp-2026-11-07-15-04-05-%.png"] },
  { pattern: "stamp.png", flags: ["-strftime", "1"], tz: "UTC", expected: ["stamp.png", "stamp.png"] },
  { pattern: "stamp-%H-%M-%S.png", flags: ["-strftime", "1"], tz: "America/Chicago", expected: ["stamp-09-04-05.png", "stamp-09-04-06.png"], tick: 1000 },
  { pattern: "stamp-%02d.png", flags: ["-strftime", "0"], tz: "UTC", expected: ["stamp-01.png", "stamp-02.png"] },
  { pattern: "stamp-%Y-%%.png", flags: ["-strftime", "1", "-update", "1"], tz: "UTC", expected: ["stamp-%Y-%%.png", "stamp-%Y-%%.png"] },
  { pattern: "stamp-%%.png", flags: ["-strftime", "invalid"], tz: "UTC", expected: [], invalid: true },
  { pattern: "stamp-%999999999Y.png", flags: ["-strftime", "1"], tz: "UTC", expected: [], invalid: true }
]) {
  it(`expands image2 wall-clock filenames and handles collisions: copy=${copy}, ${pattern}, ${flags.join(" ")}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 7, 15, 4, 5) });
    const volume = Volume.fromJSON({});
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
    for (const [index, color] of colors.entries()) volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data);
    const errors: Uint8Array[] = [];
    const writes: string[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "2", "-i", copy ? "/f0.png" : "/f%d.png", ...(copy ? ["-c:v", "copy"] : []), ...flags, pattern],
      cwd: "/", env: { TZ: tz }, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { writes.push(path); volume.writeFileSync(path, bytes); t.mock.timers.tick(tick); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (invalid) {
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(writes, []);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const outputs = expected.slice(0, copy ? 1 : 2).map(name => `/${name}`);
    assert.deepEqual(writes, outputs);
    const output = outputs.at(-1)!;
    assert.deepEqual([...decodeImage(new Uint8Array(volume.readFileSync(output) as Uint8Array)).data], Array(4).fill(colors[copy ? 0 : 1]).flat());
  });
}

it("defers strftime to async execution without writing from the sync fast path", () => {
  assert.equal(evalSyncFfmpeg(["-i", "/in.png", "-strftime", "1", "/stamp-%%.png"], undefined,
    () => undefined, () => { assert.fail("unexpected sync write"); }), undefined);
});
