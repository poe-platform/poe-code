import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function checksum(output: string[]): Promise<{ stdout: string; volume: Volume }> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.raw", Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
      "-framerate", "25", "-i", "/in.raw", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return { stdout, volume };
}

// Complete stdout from native FFmpeg 7.0.2 with -bitexact and gray 2x2 input 00..07.
const headers = "#tb 0: 1/25\n#media_type 0: video\n#codec_id 0: rawvideo\n#dimensions 0: 2x2\n#sar 0: 0/1\n";
for (const [format, algorithm, gray, bgr24, rgb48be] of [
  ["framemd5", "MD5",
    ["37b59afd592725f9305e484a5d7f5168", "a6b8537b97d58b417d3dfdd1030b15d2"],
    ["7c5c25b9631e0e3555f359611e184a63", "062afb6c393a27e1055110872ff7ac4f"],
    ["57bfab9301e7ca08f05388459ba61314", "7621133fe45625c47a775f3a6a67789f"]],
  ["framehash", "SHA256",
    ["054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8", "c6d44cf418f610e3fe9e1d9294ff43def81c6cdcad6cbb1820cff48d3aa4355d"],
    ["3ad56ff16221bc36dd351b6c9ee90fb2c0d03b16101fec72434f12c12532f1f9", "ed7dda3ffcfa126f080028df61ba71e649474487b1643dc54457948a0d803305"],
    ["583061a4f6d74b1021fd95dfb22d543bade2edce30a9420a2771c25dfbe8d2c0", "421178401f5ca77707ac1e15a82b8cd875b1edcd1417917ab8b189081f98ddb1"]],
  ["framecrc", "", ["0x000a0006", "0x00320016"], ["0x00480012", "0x01800042"], ["0x00900012", "0x03000042"]]
] as const) {
  const header = format === "framecrc" ? headers
    : `#format: frame checksums\n#version: 2\n#hash: ${algorithm}\n${headers}#stream#, dts,        pts, duration,     size, hash\n`;
  const original = `${header}0,          0,          0,        1,        4, ${gray[0]}\n0,          1,          1,        1,        4, ${gray[1]}\n`;
  const converted = `${header}0,          0,          0,        1,       12, ${bgr24[0]}\n0,          1,          1,        1,       12, ${bgr24[1]}\n`;
  for (const [pixelFormat, expected] of [
    [undefined, original], ["gray", original], ["bgr24", converted],
    ["rgb48be", `${header}0,          0,          0,        1,       24, ${rgb48be[0]}\n0,          1,          1,        1,       24, ${rgb48be[1]}\n`]
  ] as const) {
    it(`${format} matches native stdout with output pixel format ${pixelFormat ?? "omitted"}`, async () => {
      const { stdout } = await checksum(["-bitexact", ...(pixelFormat ? ["-pix_fmt", pixelFormat] : []), "-f", format, "-"]);
      assert.equal(stdout, expected);
    });
  }
  it(`${format} preserves copied packets despite an output pixel format`, async () => {
    const { stdout } = await checksum(["-bitexact", "-c:v", "copy", "-pix_fmt", "bgr24", "-f", format, "-"]);
    assert.equal(stdout, original);
  });
  it(`${format} resets the pixel format between outputs`, async () => {
    const { stdout, volume } = await checksum(["-bitexact", "-pix_fmt", "bgr24", "-f", format, "/first.txt",
      "-bitexact", "-f", format, "-"]);
    assert.equal(volume.readFileSync("/first.txt", "utf8"), converted);
    assert.equal(stdout, original);
  });
}
