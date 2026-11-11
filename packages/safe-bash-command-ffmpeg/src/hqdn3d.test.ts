import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 3072 }, (_, i) =>
  90 + ((Math.floor(i % 32 / 4) + Math.floor(i % 1024 / 32 / 8) + Math.floor(i / 1024)) % 5) * 3));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function run(filter: string, bytes = input, format = "gray", size = "32x32", maxMemoryBytes?: number) {
  const volume = Volume.fromJSON({ "/in": bytes, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(maxMemoryBytes === undefined ? {} : { limits: { maxMemoryBytes } }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

it("preserves the changing grayscale null control", async () => {
  const result = await run("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, input);
});

// Native FFmpeg 7.0.2, identical raw grayscale sequence and command arguments.
for (const [strength, hashes] of [
  [6, ["44a1d68f9d8e01f4943c13557c0aa9c79dceae95daaa3b395a2c2f0f1acdc005",
    "20bf41de16be118b9621614d15203d01af607f44b64b4e31c9c2551151d22bd8",
    "2679e2ff277817fc02f68d784c6f89d3c03b6061f98319ca7152fc601f46907e"]],
  [24, ["c5ea7dbf20583b5eddfaa98bf8fdc40473fdc00ff8c0851041d9a1c2003fa387",
    "f5c822526bc04ca844a5af1a4db9979d7eaa6d164f2ea48c56c4c3e4f4968419",
    "8f0638da3b3224cdff76052ab52a30494141b4da4b8fe2a18d18ba84de79105f"]]
] as const) {
  it(`matches native hqdn3d temporal strength ${strength} on every frame`, async () => {
    const result = await run(`hqdn3d=4:3:${strength}:4.5`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.deepEqual([0, 1, 2].map(i => hash(result.output.subarray(i * 1024, (i + 1) * 1024))), hashes);
  });
}

for (const [filter, expected] of [
  ["hqdn3d", "45a6dfe21129350a42b5d754249ef070ab5b599e3dba32f661ecfe1a5f7e3a92"],
  ["hqdn3d=0:0:0:0", "45a6dfe21129350a42b5d754249ef070ab5b599e3dba32f661ecfe1a5f7e3a92"],
  ["hqdn3d=8", "e56d5833cb6daa66ced3de103b9055ba2561a7cd78cd8f438a610b05b46d5cf6"],
  ["hqdn3d@denoise=luma_tmp=6*4", "2a733ec7264c1db7f8dfc01fe85d648dd65bb306ffd70f00777b252adc7be1b4"],
  ["hqdn3d=4:3:6:4.5:enable=gte(n\\,1)", "a93e6d9ed17b9217b5bd1c1b823152a1933033a221cbb098bb19d581b9161e57"],
  ["hqdn3d=4:3:6:4.5:enable=eq(n\\,1)", "49bb3e1f1cae6be7e88e941f0a5d0b185d64cf0f2ea8cb2dd313c195be308a93"],
  ["hqdn3d,hqdn3d", "4c9d171473be67eb91853ea512828c53562d45c968133d2e878021474d59ad40"],
  ["hqdn3d,select=eq(t\\,0.5)", "2679e2ff277817fc02f68d784c6f89d3c03b6061f98319ca7152fc601f46907e"]
]) {
  it(`matches native defaults, history and timing for ${filter}`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(hash(result.output), expected);
  });
}

it("resets temporal history for each command execution", async () => {
  await run("hqdn3d", Buffer.alloc(3072, 160));
  const result = await run("hqdn3d", input, "gray8");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(hash(result.output), "45a6dfe21129350a42b5d754249ef070ab5b599e3dba32f661ecfe1a5f7e3a92");
});

it("preserves constant grayscale at black and white boundaries", async () => {
  for (const value of [0, 255]) {
    const bytes = Buffer.alloc(3072, value);
    const result = await run("hqdn3d", bytes);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, bytes);
  }
});

for (const option of ["luma_spatial=-1", "chroma_spatial=-1", "luma_tmp=no", "chroma_tmp=Infinity", "unknown=1", "4:3:6:4.5:2"]) {
  it(`rejects ${option} without replacing existing output`, async () => {
    const result = await run(`hqdn3d=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("hqdn3d"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

it("rejects unsupported color input without replacing existing output", async () => {
  const result = await run("hqdn3d", Buffer.alloc(3072), "rgb24");
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("8-bit grayscale"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});

it("accounts for denoising tables and history before allocating them", async () => {
  const result = await run("hqdn3d", input, "gray", "32x32", 30000);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxMemoryBytes"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});
