import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [20, 90, 90, 185, 45, 45, 140];
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...luma.map(y => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([y,y,y,y,128,128,128,128,128,128,128,128])]))]);

async function run(filter: string, logLevel = "error") {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  fs.writeFileSync("/in.y4m", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", logLevel, "-y", "-i", "/in.y4m", "-vf", filter,
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

for (const filter of ["thumbnail=0", "thumbnail=-1", "thumbnail=1.5", "thumbnail=2147483648", "thumbnail=n=no", "thumbnail=unknown=3", "thumbnail=3:info:extra"]) {
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

for (const filter of ["null", "thumbnail=5", "thumbnail=5,select=eq(t\\,0.25)"]) {
  it(`preserves native 10-bit YUV420 samples and timestamps through ${filter}`, async () => {
    const planes = [[50, 100, 100], [150, 150, 50], [150, 150, 100], [100, 100, 50], [50, 150, 150]];
    const raw = Buffer.alloc(60);
    let offset = 0;
    for (const [y, u, v] of planes) {
      for (const value of [y, y, y, y, u, v]) {
        raw.writeUInt16LE(value! * 4, offset);
        offset += 2;
      }
    }
    const volume = Volume.fromJSON({ "/in.raw": raw });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "yuv420p10le",
        "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw", "-vf", `${filter},showinfo`,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), filter === "null" ? raw : Buffer.from("58025802580258025802c800", "hex"));
    if (filter !== "null") {
      assert.ok(stderr.includes("frame id #1 (pts_time=0.250000) selected from a set of 5 images"), stderr);
    }
  });
}

for (const [filter, globalLevel, visible] of [
  ["thumbnail=n=3", "info", true],
  ["thumbnail=n=3", "error", false],
  ["thumbnail=n=3:log=quiet", "debug", false],
  ["thumbnail=n=3:log=verbose", "info", false],
  ["thumbnail=n=3:log=verbose", "verbose", true],
  ["thumbnail=3:info", "info", true],
  ["thumbnail=n=3:log=40", "verbose", true],
  ["thumbnail=n=3:log=48", "debug", true],
  ["thumbnail=n=3:log=-9", "debug", true],
  ["thumbnail=n=3:log=-8", "debug", false],
  ["thumbnail=log=info", "info", true],
] as const) {
  it(`honors thumbnail logging for ${filter} at ${globalLevel}`, async () => {
    const result = await run(`${filter},showinfo`, globalLevel);
    const control = await run(filter === "thumbnail=log=info" ? "thumbnail" : "thumbnail=3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, control.output);
    const messages = result.stderr.split("\n").filter(line => line.includes("selected from a set"));
    const expected = filter === "thumbnail=log=info"
      ? ["frame id #1 (pts_time=0.200000) selected from a set of 7 images"]
      : [
        "frame id #1 (pts_time=0.200000) selected from a set of 3 images",
        "frame id #1 (pts_time=0.800000) selected from a set of 3 images",
        "frame id #0 (pts_time=1.200000) selected from a set of 1 images"
      ];
    assert.deepEqual(messages.map(line => line.slice(line.indexOf("frame id"))), visible ? expected : []);
    if (globalLevel === "info") assert.ok(result.stderr.includes("showinfo"));
  });
}

for (const log of ["nonsense", "2147483648", "-2147483649", "1.5"]) {
  it(`rejects invalid thumbnail log ${log} without replacing output`, async () => {
    const result = await run(`thumbnail=n=3:log=${log}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("matches the native rawvideo thumbnail selection records and timestamps", async () => {
  const fs = Volume.fromJSON({ "/in.raw": Buffer.from([40, 40, 100, 160, 200, 200, 240]) });
  let stderr = "";
  const output: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo",
      "-pixel_format", "gray", "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw",
      "-vf", "thumbnail=n=3,showinfo", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(Buffer.concat(output).toString("hex"), "28c8f0");
  assert.deepEqual(stderr.split("\n").filter(line => line.includes("selected from a set")), [
    "[thumbnail] frame id #0 (pts_time=0.000000) selected from a set of 3 images",
    "[thumbnail] frame id #1 (pts_time=1.000000) selected from a set of 3 images",
    "[thumbnail] frame id #0 (pts_time=1.500000) selected from a set of 1 images"
  ]);
  assert.deepEqual([...stderr.matchAll(/\bpts:\s*(\d+)/g)].map(match => Number(match[1])), [0, 4, 6]);
});
