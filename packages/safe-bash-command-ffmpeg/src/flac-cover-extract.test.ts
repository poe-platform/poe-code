import assert from "node:assert/strict";
import { it } from "node:test";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 16 kHz mono FLAC with a 32x24 PNG attached using
// -map 0:a -map 1:v -c copy -disposition:v:0 attached_pic.
const input = Buffer.from("ZkxhQwAAACIAoACgAAB2AAB2A+gA8AAAAKDU3rdtUCyTcsGb6G8LR6qUBgAAmwAAAAAAAAAJaW1hZ2UvcG5nAAAAAAAAACAAAAAYAAAAGAAAAAAAAAByiVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAJElEQVR4nGP8x0BbwEJj80ctGLVg1IJRC0YtGLVg1IJRC6gEALnoAVxfj/KxAAAAAElFTkSuQmCChAAALAwAAABMYXZmNjMuMS4xMDEBAAAAFAAAAGVuY29kZXI9TGF2ZjYzLjEuMTAx//hlCACfIU4AAALABWsH7QoyDCoNxQ725jFCg1rLMsUh2g12otA+eABETZF3r4+Fw7DscjpszIJhEMRkJmrfer1706FnkrRGw0GwjEYkNW+/j1+/X+2TQkIgkCQJBsaNqiodC1+rwuXdoiMhmIQhoNCbboDcPQ==", "base64");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAJElEQVR4nGP8x0BbwEJj80ctGLVg1IJRC0YtGLVg1IJRC6gEALnoAVxfj/KxAAAAAElFTkSuQmCC", "base64");

it("extracts a native FLAC PICTURE block as a byte-identical PNG", async () => {
  const picture = flacAst().parse(input, { decodeAudio: false }).tracks[1];
  assert.equal(picture?.type, "video");
  assert.equal(picture.codecDescriptions[0]?.codecName, "png");
  assert.equal(picture.width, 32);
  assert.equal(picture.height, 24);
  assert.equal(picture.disposition?.attached_pic, 1);

  const volume = Volume.fromJSON({});
  volume.writeFileSync("/cover.flac", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/cover.flac", "-map", "0:v:0", "-c", "copy", "/extract.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/extract.png"), png);
});
