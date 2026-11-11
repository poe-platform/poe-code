import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("1020406080a0c8eb647d9b82a0648c7782a0795d809b648f", "hex");

async function run(filter: string, source = input, maxOutputBytes = 1024, format = "yuv444p") {
  const volume = Volume.fromJSON({ "/in.raw": source, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo",
      "-pixel_format", format, "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out.raw"],
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

// Complete Y, U, V planes from FFmpeg 7.0.2, with no RGB conversion.
for (const [filter, expected] of [
  ["null", input.toString("hex")],
  ["colorcorrect", input.toString("hex")],
  ["colorcorrect=rl=0.2:bh=-0.3:saturation=0.7", "1020406080a0c8eb6877856d7b4a5e48a2b5957d91a0738d"],
  ["colorcorrect=analyze=average", "1020406080a0c8eb627b99809e628a75809e775b7e99628d"],
  ["colorcorrect=0.2:0:0:-0.3:0.7:manual", "1020406080a0c8eb6877856d7b4a5e48a2b5957d91a0738d"],
  ["colorcorrect=analyze=1:rl=1:bh=-1", "1020406080a0c8eb627b99809e628a75809e775b7e99628d"],
  ["colorcorrect=saturation=0", "1020406080a0c8eb7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f"],
  ["colorcorrect=bl=1:rl=-1", "1020406080a0c8ebffffffffffc3c28a00000000013c2d7b"]
] as const) {
  it(`matches native planes for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("analyzes each frame separately and retains timestamps through selection", async () => {
  const second = Buffer.concat([input.subarray(0, 8), Buffer.alloc(16, 160)]);
  const result = await run("colorcorrect=analyze=average,select=eq(t\\,0.25)", Buffer.concat([input, second]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([input.subarray(0, 8), Buffer.alloc(16, 127)]));
});

for (const filter of ["colorcorrect=rl=2", "colorcorrect=saturation=4", "colorcorrect=analyze=median", "colorcorrect=unknown=1"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("colorcorrect"));
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("enforces output limits before replacing the destination", async () => {
  const result = await run("colorcorrect=analyze=average", input, input.length - 1);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxOutputBytes"));
  assert.equal(result.output.toString(), "KEEP");
});

for (const [format, source, manual, average] of [
  ["yuv422p", "1020406080a0c8eb647d9b8282a0795d", "1020406080a0c8eb68707757a2b08c6f", "1020406080a0c8eb637c9a8183a17a5e"],
  ["yuv420p", "1020406080a0c8eb647d82a0", "1020406080a0c8eb6870a2b0", "1020406080a0c8eb738b708e"]
] as const) {
  for (const [filter, expected] of [
    ["colorcorrect=rl=0.2:bh=-0.3:saturation=0.7", manual],
    ["colorcorrect=analyze=average", average]
  ] as const) {
    it(`matches native ${format} chroma sampling for ${filter}`, async () => {
      const result = await run(filter, Buffer.from(source, "hex"), 1024, format);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.toString("hex"), expected);
    });
  }
}
