import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [20, 90, 90, 185, 45, 45, 140];
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...luma.map(y => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([y,y,y,y,128,128,128,128,128,128,128,128])]))]);

async function run(filter: string) {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  fs.writeFileSync("/in.y4m", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

for (const [filter, length, sha] of [
  ["thumbnail=3", 36, "186db8c79fe514f4d67860d00158402790e2cd26d9677817bfe7edd547a325ad"],
  ["thumbnail=n=3", 36, "186db8c79fe514f4d67860d00158402790e2cd26d9677817bfe7edd547a325ad"],
  ["thumbnail", 12, "45ccdbb6447bf9e38fc1144130d87ccf3c637cf8de7e146e20ed1bc62fd444d8"],
  ["thumbnail=3,tile=2x1", 48, "e02e793873170e2b08d5158fe35e742c5d80c319cb63017682621a3d5ef5056c"],
  ["thumbnail=1", 84, "8e2747c1c2adfc97c7fa00205ccff38ee39a30a3dfd1fb15794db8bac84a45c0"],
  ["null", 84, "8e2747c1c2adfc97c7fa00205ccff38ee39a30a3dfd1fb15794db8bac84a45c0"],
  ["select=eq(n\\,1)+eq(n\\,4)+eq(n\\,6)", 36, "186db8c79fe514f4d67860d00158402790e2cd26d9677817bfe7edd547a325ad"]
] as const) {
  it(`matches native FFmpeg for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), sha);
  });
}

for (const filter of ["thumbnail=0", "thumbnail=-1", "thumbnail=1.5", "thumbnail=2147483648", "thumbnail=n=no", "thumbnail=unknown=3", "thumbnail=3:4"]) {
  it(`rejects ${filter} without replacing the destination`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /thumbnail/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("preserves selected timestamps and chooses the first frame on ties", async () => {
  const result = await run("thumbnail=2,select=eq(t\\,0)+eq(t\\,0.4)+eq(t\\,0.8)+eq(t\\,1.2)");
  const control = await run("select=eq(n\\,0)+eq(n\\,2)+eq(n\\,4)+eq(n\\,6)");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.deepEqual(result.output, control.output);
});

it("selects representative RGB frames after format conversion", async () => {
  const result = await run("format=rgb24,thumbnail=3");
  const control = await run("format=rgb24,select=eq(n\\,1)+eq(n\\,4)+eq(n\\,6)");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.deepEqual(result.output, control.output);
});
