import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: string, format = "nv12", size = "2x4", filter = "null", maxOutputBytes?: number) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-y", "-hide_banner", "-nostats", "-v", filter.includes("showinfo") ? "info" : "error",
      "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", size, "-framerate", "4",
      "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-f", "rawvideo", maxOutputBytes === undefined ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout).toString("hex"), file: volume.readFileSync("/out.raw", "utf8") };
}

for (const [format, expected] of [
  ["nv12", "11589fe62d74bb0249d7901e"],
  ["yuv420p", "11589fe62d74bb024990d71e"]
]) {
  it(`writes native ${format} bytes through null`, async () => {
    const result = await run("11589fe62d74bb024990d71e", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output, expected);
  });
}

it("interleaves odd-sized chroma planes independently for each frame", async () => {
  const result = await run("0102030405060708091011121320212223".repeat(2), "nv12", "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "0102030405060708091020112112221323".repeat(2));
});

it("preserves showinfo frame fields before output conversion", async () => {
  const input = "11589fe62d74bb024990d71e".repeat(2);
  const control = await run(input, "yuv420p", "2x4", "null,showinfo");
  const result = await run(input, "nv12", "2x4", "null,showinfo");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.ok(control.stderr.includes("[showinfo] n:"));
  assert.equal(result.stderr, control.stderr);
  assert.ok(result.stderr.includes("checksum:2080051A plane_checksum:[0EB0034C 012200D9 01CC00F5] mean:[106 109 123] stdev:[77.2 35.5 92.5]"));
  assert.equal(result.output, "11589fe62d74bb0249d7901e".repeat(2));
});

it("checks cumulative NV12 output size before replacing the destination", async () => {
  const result = await run("11589fe62d74bb024990d71e".repeat(2), "nv12", "2x4", "null", 23);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.file, "KEEP");
});
