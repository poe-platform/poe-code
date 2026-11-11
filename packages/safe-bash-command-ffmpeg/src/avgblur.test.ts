import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const impulse = Buffer.from(Array.from({ length: 1024 }, (_, i) => i === 0 || i === 528 ? 245 : 20));

async function run(filter: string, input = impulse, format = "gray", size = "32x32", limits?: MediaResourceLimits) {
  const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

it("preserves the raw grayscale control", async () => {
  const result = await run("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, impulse);
});

// FFmpeg 7.0.2 reference hashes include both a corner and center impulse.
for (const [sizes, hash] of [
  ["sizeX=3:sizeY=1", "2a0539d044669d54c181d9557c5655361a5f1193acfbe708f3f85344f41482fe"],
  ["sizeX=1:sizeY=3", "98662f51c08e5e2c802546e070a315f97d409b84879b5e2ae08a626046f94fec"]
]) {
  it(`matches native rectangular avgblur=${sizes}`, async () => {
    const result = await run(`avgblur=${sizes}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 1024);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    assert.equal(result.output[0], 105);
  });
}

it("accepts positional sizeX:planes:sizeY and named instances", async () => {
  const expected = await run("avgblur=sizeX=3:sizeY=1");
  const result = await run("avgblur@wide=3:15:1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
});

it("defaults sizeY to sizeX and defaults both radii to one", async () => {
  for (const [filter, explicit] of [["avgblur", "avgblur=1:15:1"], ["avgblur=3", "avgblur=3:15:3"],
    ["avgblur=sizeX=3:sizeY=0", "avgblur=3:15:3"]]) {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, (await run(explicit!)).output);
  }
});

it("copies unselected planes without changing pixels", async () => {
  const result = await run("avgblur=planes=0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, impulse);
});

it("blurs only the selected native YUV plane", async () => {
  const input = Buffer.concat([impulse, impulse, impulse]);
  const result = await run("avgblur=3:2:1", input, "yuv444p");
  assert.equal(result.exitCode, 0, result.stderr);
  const blurred = (await run("avgblur=3:15:1")).output;
  assert.deepEqual(result.output, Buffer.concat([impulse, blurred, impulse]));
});

it("preserves frame timing while bypassing disabled frames", async () => {
  const input = Buffer.concat([impulse, impulse, impulse]);
  const result = await run("avgblur=3:15:1:enable='eq(t,0.25)'", input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([impulse, (await run("avgblur=3:15:1")).output, impulse]));
});

it("clamps oversized radii independently on a one-row image", async () => {
  const result = await run("avgblur=1024:15:1024", Buffer.from([10, 20, 30, 40]), "gray", "4x1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...result.output], [16, 22, 28, 34]);
});

for (const format of ["gray16le", "gray16be", "yuv444p10le", "yuv444p16le"]) {
  it(`keeps low sample bits when blurring ${format}`, async () => {
    const input = Buffer.alloc(format.startsWith("gray") ? 8 : 24);
    const expected = Buffer.alloc(input.length);
    for (let offset = 0; offset < input.length; offset += 8) {
      for (const [i, value] of [101, 202, 303, 405].entries()) {
        if (format.endsWith("be")) input.writeUInt16BE(value, offset + i * 2);
        else input.writeUInt16LE(value, offset + i * 2);
      }
      // Native FFmpeg 7.0.2 truncates the full rectangular sum once.
      for (const [i, value] of [202, 235, 269, 303].entries()) {
        if (format.endsWith("be")) expected.writeUInt16BE(value, offset + i * 2);
        else expected.writeUInt16LE(value, offset + i * 2);
      }
    }
    const result = await run("avgblur", input, format, "2x2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected);
  });
}

it("clamps radii to subsampled chroma dimensions before filtering luma", async () => {
  const luma = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 10));
  const input = Buffer.concat([luma, Buffer.from([20, 30, 40, 50, 60, 70, 80, 90])]);
  const result = await run("avgblur=3:15:3", input, "yuv420p", "4x4");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...result.output], [16, 23, 33, 40, 43, 50, 60, 66, 83, 90, 100, 106, 110, 116, 126, 133,
    30, 33, 36, 40, 70, 73, 76, 80]);
});

it("accounts for blur output and scratch memory before replacing output", async () => {
  const result = await run("avgblur=3:15:1", impulse, "gray", "32x32", { maxMemoryBytes: 9000 });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /memory/i);
  assert.equal(result.output.toString(), "KEEP");
});

it("rejects unsupported RGB negotiation without replacing output", async () => {
  const result = await run("avgblur", Buffer.alloc(16, 100), "rgba", "2x2");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /grayscale or retained planar YUV/);
  assert.equal(result.output.toString(), "KEEP");
});

for (const option of ["sizeX=0", "sizeX=1025", "sizeY=-1", "sizeY=1025", "sizeX=no", "planes=16", "unknown=1"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(`avgblur=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /avgblur/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
