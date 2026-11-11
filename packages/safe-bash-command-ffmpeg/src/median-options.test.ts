import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 48 }, (_, i) => {
  const x = i % 8;
  const y = Math.floor(i / 8);
  return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
}));

async function run(options: string, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "8x6", "-framerate", "4", "-i", "/in.raw", "-vf", `median=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout), file: volume.readFileSync("/out.raw") };
}

// FFmpeg 7.0.2 hashes cover all 48 pixels, including the border.
for (const [options, explicit, hash] of [
  ["planes=2:0", "planes=0", "a1af29be760e688d215a6b909e7b6ac93bd9999659039915332b82510b756c8a"],
  ["planes=2:0:1:1", "planes=0:radiusV=1:percentile=1", "a1af29be760e688d215a6b909e7b6ac93bd9999659039915332b82510b756c8a"],
  ["threads=1:1", "threads=1:planes=1", "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99"],
  ["enable=1:0", "enable=1:planes=0", "a1af29be760e688d215a6b909e7b6ac93bd9999659039915332b82510b756c8a"],
  ["radius=1:", "radius=1", "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99"],
  ["radius=2:planes=15:1", "radius=1:planes=15", "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99"],
  ["radius=1:planes=15:2", "radius=2:planes=15", "61da2cdfcc75ad77df800156c64cbe981a8ceb43557b226db7c85d35c1e439d0"],
  ["1:planes=15:2", "radius=2:planes=15", "61da2cdfcc75ad77df800156c64cbe981a8ceb43557b226db7c85d35c1e439d0"],
  ["radius=1:planes=15:radiusV=0:percentile=0.5:2", "radius=2", "61da2cdfcc75ad77df800156c64cbe981a8ceb43557b226db7c85d35c1e439d0"]
]) {
  it(`matches native median=${options} and its explicit counterpart`, async () => {
    const control = await run(explicit!);
    const result = await run(options!);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 48);
    assert.deepEqual(result.output, control.output);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const options of [":", "radius=1::", "radius=1::0", "radius=1: :", "planes=15:radius=2:0", "radius=1:0:0:0.5:1"]) {
  it(`rejects invalid median=${options} before replacing output`, async () => {
    const result = await run(options, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /median/);
    assert.equal(result.output.length, 0);
    assert.equal(result.file.toString(), "KEEP");
  });
}
