import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const reference = {
  palette: { ".": [20, 25, 30], R: [240, 30, 50], B: [30, 80, 250], G: [30, 210, 80] },
  rows: ["........", ".RR.....", "..RR..B.", "...RRBB.", "....RB..", "..GGG...", ".GG.....", "........"]
};

const palette = reference.palette as Record<string, number[]>;
const pixels = (rows: string[]) => Uint8Array.from([...rows.join("")].flatMap(c => [...palette[c]!, 255]));
// RGB PNG of the palette and rows above.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAANklEQVR4nGMQkZTDihiA+IOcERBhkUCTkwv4hZCAywFF0SUgchBRhITcpQAIQrEDTQhFByYCALHNIrFfT/8WAAAAAElFTkSuQmCC", "base64");

async function run(filter: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/art.png", input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/art.png", "-vf", filter, "/out.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

// Native FFmpeg decoded RGB output for scale=16:16:flags=neighbor.
const scaledRows = [
  "................", "................", "..RRRR..........", "..RRRR..........",
  "....RRRR....BB..", "....RRRR....BB..", "......RRRRBBBB..", "......RRRRBBBB..",
  "........RRBB....", "........RRBB....", "....GGGGGG......", "....GGGGGG......",
  "..GGGG..........", "..GGGG..........", "................", "................"
];
for (const filter of ["scale=16:16:flags=neighbor", "null"]) {
  it(`${filter} preserves native dimensions and every decoded RGB pixel`, async () => {
    const { result, volume, error } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    const rows = filter === "null" ? reference.rows : scaledRows;
    assert.equal(output.width, rows[0]!.length);
    assert.equal(output.height, rows.length);
    assert.deepEqual(output.data, pixels(rows));
  });
}
