import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, args: string[] = [], maxOutputBytes = 1024) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.raw", ...args, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const depth of [8, 10, 16]) {
  const format = depth === 8 ? "yuv444p" : `yuv444p${depth}le`;
  const frame = Buffer.from(depth === 8 ? "0a0b0c0d0e0f101112131415"
    : "39008c00df0032018501d8012b027e02d10224037703ca03", "hex");
  const second = Buffer.alloc(frame.length);
  for (let index = 0; index < 12; index++) {
    if (depth === 8) second[index] = 255 - index;
    else second.writeUInt16LE(2 ** depth - 1 - index * 37, index * 2);
  }
  const input = Buffer.concat([frame, second]);
  it(`decodes two ${format} frames without losing low bits or plane order`, async () => {
    const result = await run(input, format, ["-vf", "null"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });
  it(`selects the second ${format} frame at its input timestamp`, async () => {
    const result = await run(input, format, ["-vf", "select=eq(t\\,0.25)"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, second);
  });
  it(`copies a final short ${format} packet`, async () => {
    const partial = input.subarray(0, input.length - 1);
    const result = await run(partial, format, ["-c:v", "copy"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, partial);
  });
  it(`enforces ${format} output limits before replacing the destination`, async () => {
    const result = await run(input, format, ["-vf", "null"], input.length - 1);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /maxOutputBytes/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
