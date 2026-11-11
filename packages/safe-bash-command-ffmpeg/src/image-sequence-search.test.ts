import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const cases: { name: string; start: number; options?: string[]; success?: boolean; gap?: boolean }[] = [
  ...[0, 1, 2, 3, 4].map(start => ({ name: `default search finds ${start}`, start })),
  { name: "default search excludes 5", start: 5, success: false },
  { name: "explicit matching start", start: 5, options: ["-start_number", "5"] },
  { name: "search from explicit start", start: 7, options: ["-start_number", "5"] },
  { name: "expression start outside default search", start: 7, options: ["-start_number", "3+4"] },
  { name: "expression expands search range", start: 7, options: ["-start_number_range", "4+4"] },
  ...["-2147483648-1", "2147483647+1", "1/0", "3+", "3/2"].map(value => ({
    name: `reject invalid start expression ${value}`, start: 0, options: ["-start_number", value], success: false
  })),
  { name: "expanded range", start: 5, options: ["-start_number_range", "6"] },
  { name: "range one requires exact start", start: 1, options: ["-start_number_range", "1"], success: false },
  { name: "stop at subsequent gap", start: 4, gap: true },
  ...["0", "-1", "1.5", "nope", "2147483648", "", "1-1", "2147483647+1", "1/0", "4+", "3/2"].map(value => ({
    name: `reject invalid range ${value}`, start: 0, options: ["-start_number_range", value], success: false
  }))
];

for (const { name, start, options = [], success = true, gap = false } of cases) {
  it(name, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255]];
    colors.forEach((color, i) => {
      const image = encodeImage({
        width: 16, height: 16, channels: 4,
        data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => color[channel % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      volume.writeFileSync(`/f${String(start + i * (gap ? 2 : 1)).padStart(2, "0")}.png`, image);
    });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: [...options, "-i", "/f%02d.png", "/o%02d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, success ? 0 : 1, Buffer.concat(errors).toString());
    const outputs = volume.readdirSync("/").filter(name => String(name).startsWith("o"));
    assert.deepEqual(outputs, success ? (gap ? ["o01.png"] : ["o01.png", "o02.png"]) : []);
    outputs.forEach((name, i) => {
      const image = decodeImage(volume.readFileSync(`/${String(name)}`) as Buffer);
      assert.deepEqual([...image.data.slice(0, 4)], colors[i]);
    });
  });
}
