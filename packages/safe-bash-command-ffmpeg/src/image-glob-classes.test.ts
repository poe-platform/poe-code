import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const characters = ["1", "9", "a", "F", "g", "Z", " ", "\t", "\n", "!", "_", "]", "-", "é", "\x7f"];
for (const [bracket, selected] of [
  ["[[:digit:]]", "19"],
  ["[[:alpha:]]", "aFgZ"],
  ["[[:alnum:]]", "19aFgZ"],
  ["[[:lower:]]", "ag"],
  ["[[:upper:]]", "FZ"],
  ["[[:xdigit:]]", "19aF"],
  ["[[:blank:]]", " \t"],
  ["[[:space:]]", " \t\n"],
  ["[[:cntrl:]]", "\t\n\x7f"],
  ["[[:print:]]", "19aFgZ !_]-"],
  ["[[:graph:]]", "19aFgZ!_]-"],
  ["[[:punct:]]", "!_]-"],
  ["[![:digit:]]", "aFgZ \t\n!_]-é\x7f"],
  ["[[:digit:]a]", "19a"],
  ["[[:digit:][:upper:]]", "19FZ"],
  ["[a-g[:digit:]]", "19ag"],
  ["[0-9]", "19"],
  ["[][:digit:]]", "19]"],
  ["[[:unknown:]]", ""],
  ["[[:DIGIT:]]", ""]
]) {
  it(`image2 glob selects C-locale classes in ${bracket}`, async () => {
    const volume = new Volume();
    characters.forEach((character, i) => volume.writeFileSync(`/f${character}.png`, encodeImage({
      width: 2, height: 2, channels: 4,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [i + 1, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data));
    const pixels: number[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-f", "image2", "-pattern_type", "glob", "-i", `/f${bracket}.png`, "/out%02d.png"],
      cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) {
          pixels.push(decodeImage(bytes).data[0]!);
          volume.writeFileSync(path, bytes);
        },
        async stat(path: string) { return volume.statSync(path); },
        async readdir(path: string) { return volume.readdirSync(path, { withFileTypes: true }); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, selected!.length ? 0 : 1, Buffer.concat(errors).toString());
    assert.deepEqual(pixels, [...selected!].sort().map(character => characters.indexOf(character) + 1));
  });
}
