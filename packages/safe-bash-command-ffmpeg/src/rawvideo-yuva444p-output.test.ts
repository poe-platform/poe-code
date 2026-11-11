import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: RGBA input followed by full-resolution Y, U, V, A output planes.
const input = "2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a65707b86919ca7b2";
const expected = "40668cb159496e9486868686678686867a7a7a7ad77a7a7a507ca9d52e5a87b3";

async function run(source = input, size = "4x2", format = "yuva444p", filter = "null", maxOutputBytes?: number) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(source, "hex"), "/out.raw": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", size,
      "-i", "/in.raw", "-vf", filter, "-pix_fmt", format, "-f", "rawvideo",
      maxOutputBytes === undefined ? "pipe:1" : "/out.raw"],
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
  return { ...result, stderr, output: Buffer.concat(stdout).toString("hex"), file: volume.readFileSync("/out.raw") };
}

for (const filter of ["null", "format=yuva444p"]) {
  it(`writes exact native YUVA444 planes after ${filter}`, async () => {
    const result = await run(input, "4x2", "yuva444p", filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output, expected);
  });
}

it("keeps the RGBA output control unchanged", async () => {
  const result = await run(input, "4x2", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.output, input);
});

it("writes four full-resolution planes per odd-sized frame", async () => {
  const result = await run("141e2880".repeat(18), "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, ("28".repeat(9) + "86".repeat(9) + "7b".repeat(9) + "81".repeat(9)).repeat(2));
});

for (const limit of [63, 64]) {
  it(`accounts for alpha in cumulative output limits (${limit} bytes)`, async () => {
    const result = await run(input.repeat(2), "4x2", "yuva444p", "null", limit);
    if (limit === 64) {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.file.toString("hex"), expected.repeat(2));
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("maxOutputBytes"), result.stderr);
      assert.equal(result.file.toString(), "KEEP");
    }
    assert.equal(result.output, "");
  });
}
