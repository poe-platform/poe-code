import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cases = [
  { pattern: "f%02d.png", inputs: ["f00.png", "f01.png"], output: "o%02d.png", outputs: ["o01.png", "o02.png"] },
  { pattern: "f%%-%02d.png", inputs: ["f%-00.png", "f%-01.png"], output: "o%02d.png", outputs: ["o01.png", "o02.png"] },
  { pattern: "f%02d.png", inputs: ["f00.png", "f01.png"], output: "o%%-%02d.png", outputs: ["o%-01.png", "o%-02.png"] },
  { pattern: "f%d.png", inputs: ["f0.png", "f1.png"], output: "o%d-%02d.png", outputs: ["o1-01.png", "o2-02.png"] },
  { pattern: "f%%%02d-%%d.png", inputs: ["f%00-%d.png", "f%01-%d.png"], output: "o%%%02d-%%d.png", outputs: ["o%01-%d.png", "o%02-%d.png"] }
];

for (const { pattern, inputs, output, outputs: expected } of cases) {
  it(`expands the complete image2 pattern ${pattern} -> ${output}`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255]];
    colors.forEach((color, i) => {
      const image = encodeImage({
        width: 16, height: 16, channels: 4,
        data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => color[channel % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      volume.writeFileSync(`/${inputs[i]}`, image);
    });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", `/${pattern}`, `/${output}`],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("o"));
    assert.deepEqual(outputs, expected);
    outputs.forEach((name, i) => {
      const image = decodeImage(volume.readFileSync(`/${String(name)}`) as Buffer);
      assert.deepEqual([...image.data.slice(0, 4)], colors[i]);
    });
    outputs.forEach(name => volume.unlinkSync(`/${String(name)}`));
    assert.equal(evalSyncFfmpeg(undefined, ["-i", `/${inputs[0]}`, `/${output}`],
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("o")), expected.slice(0, 1));
    assert.deepEqual([...decodeImage(volume.readFileSync(`/${expected[0]}`) as Buffer).data.slice(0, 4)], colors[0]);
  });
}

for (const [pattern, names] of [
  ["f%d%d.png", ["f00.png", "f11.png"]],
  ["f%d-%02d.png", ["f0-00.png", "f1-01.png"]]
] as const) {
  for (const mode of [undefined, "sequence", "glob_sequence", "none"]) {
    it(`rejects repeated numbered input fields unless literal: ${mode ?? "default"} ${pattern}`, async () => {
      const volume = new Volume();
      const image = encodeImage({
        width: 2, height: 2, channels: 4,
        data: Uint8Array.from({ length: 16 }, (_, i) => [40, 0, 0, 255][i % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      for (const name of [...names, pattern]) volume.writeFileSync(`/${name}`, image);
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: [...(mode ? ["-f", "image2", "-pattern_type", mode] : []), "-i", `/${pattern}`, "/out%02d.png"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      if (mode === "none") {
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.deepEqual([...decodeImage(volume.readFileSync("/out01.png") as Buffer).data.slice(0, 4)], [40, 0, 0, 255]);
      } else {
        assert.notEqual(result.exitCode, 0);
      }
      assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("out")), mode === "none" ? ["out01.png"] : []);
    });
  }
}
