import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { fieldmatch } from "./fieldmatch.js";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function fixture(format = "yuv420p", count = 10, color = false) {
  const width = 32, height = 32;
  const frames = Array.from({ length: count }, (_, frame) => Buffer.concat(
    Array.from({ length: 3 }, (_, plane) => {
      const w = plane && format !== "yuv444p" ? width / 2 : width;
      const h = plane && format === "yuv420p" ? height / 2 : height;
      return Buffer.concat(Array.from({ length: h }, (_, row) => Buffer.alloc(w,
        plane === 0 ? 16 + frame * 16 + row % 2 * 16 : color ? 40 + plane * 30 + frame * 8 + row % 2 * 8 : 128)));
    })));
  return { frames, input: Buffer.concat(frames), format };
}

async function run(source: ReturnType<typeof fixture>, filter: string, limits = {}) {
  const volume = Volume.fromJSON({ "/in.yuv": source.input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", source.format,
      "-video_size", "32x32", "-framerate", "10", "-i", "/in.yuv", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", source.format, "-f", "rawvideo", "/out"],
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

// Native FFmpeg 7.0.2: tff selects the previous odd rows after the first frame;
// bff keeps each current pair. Chroma is woven with the same field parity.
for (const format of ["yuv420p", "yuv422p", "yuv444p"]) {
  for (const order of ["tff", "bff"]) {
    it(`matches native ${order} field selection on ${format}`, async () => {
      const source = fixture(format, 10, true);
      const expected = Buffer.concat(source.frames.map((frame, index) => {
        const result = Buffer.from(frame);
        if (order === "bff" || index === 0) return result;
        let offset = 0;
        for (let plane = 0; plane < 3; plane++) {
          const width = plane && format !== "yuv444p" ? 16 : 32;
          const height = plane && format === "yuv420p" ? 16 : 32;
          for (let row = 1; row < height; row += 2) {
            const start = offset + row * width;
            result.set(source.frames[index - 1]!.subarray(start, start + width), start);
          }
          offset += width * height;
        }
        return result;
      }));
      const result = await run(source, `fieldmatch=order=${order}:mode=pc`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected);
    });
  }
}

it("uses top-first matching for progressive input and preserves the final frame", async () => {
  const source = fixture();
  const explicit = await run(source, "fieldmatch=order=tff:mode=pc");
  assert.equal(explicit.exitCode, 0, explicit.stderr);
  const auto = await run(source, "fieldmatch=mode=pc");
  assert.equal(auto.exitCode, 0, auto.stderr);
  assert.deepEqual(auto.output, explicit.output);
  assert.equal(auto.output.length, source.input.length);
});

it("detects bottom-first metadata and allows an explicit override", async () => {
  const source = fixture();
  const auto = await run(source, "setfield=bff,fieldmatch=mode=pc");
  assert.equal(auto.exitCode, 0, auto.stderr);
  assert.deepEqual(auto.output, source.input);
  const override = await run(source, "setfield=bff,fieldmatch=order=tff:mode=pc");
  assert.equal(override.exitCode, 0, override.stderr);
  assert.notDeepEqual(override.output, auto.output);
});

it("preserves a single frame at both stream boundaries", async () => {
  const source = fixture("yuv420p", 1);
  const result = await run(source, "fieldmatch");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, source.input);
});

it("keeps source timestamps for downstream selection", async () => {
  const source = fixture();
  const all = await run(source, "fieldmatch=order=tff:mode=pc");
  assert.equal(all.exitCode, 0, all.stderr);
  const result = await run(source, "fieldmatch=order=tff:mode=pc,select='eq(t,0.3)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, all.output.subarray(3 * 1536, 4 * 1536));
});

for (const option of ["order=sideways", "order=2", "mode=invalid", "field=2", "unknown=1", "ppsrc=1", "blockx=7", "combpel=257"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(fixture(), `fieldmatch=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /fieldmatch/);
    assert.equal(result.output.toString(), "KEEP");
  });
}

function randomFixture(format = "yuv420p") {
  const source = fixture(format);
  let state = 193;
  for (const frame of source.frames) {
    for (let pixel = 0; pixel < frame.length; pixel++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      frame[pixel] = state >>> 24;
    }
  }
  source.input = Buffer.concat(source.frames);
  return source;
}

// SHA-256 payloads captured from FFmpeg 7.0.2 on the deterministic noise clip.
for (const [format, options, hash] of [
  ["yuv420p", "", "f9dbeaf0f580f2a255feb93cc0f658cdfcb891b78d6441f8eb68720c9e5bfe1d"],
  ["yuv420p", "mode=pcn", "10ff9c752aa045d7b44cfe04c579c563fafc58bd194c6bb367e907afe0b60d68"],
  ["yuv420p", "combmatch=full", "fedc15de0a65b34c962acdf855f5171a9cec91dc40944e12a55b31339d6e9cea"],
  ["yuv420p", "mchroma=0", "3bc4334d61f23603ac1e8f8e07ff9985b282815ff8897ceab05510d248134ba5"],
  ["yuv420p", "y0=8:y1=24", "b96c80add7dbe3f0c0e892337eb2c73e0826bbe5156f464900c9af232a8521ef"],
  ["yuv444p", "mode=pcn_ub:y0=8:y1=24", "10273e28635b16e95b9afe723aa4d902c04c9c3536a7b9a3c8c1cb8ab913b52b"]
]) {
  it(`matches native motion and comb decisions for ${format} ${options || "defaults"}`, async () => {
    const result = await run(randomFixture(format), `fieldmatch${options ? `=${options}` : ""}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("honors an explicit matching field independently of field order", async () => {
  const source = fixture();
  const result = await run(source, "fieldmatch=order=bff:field=top:mode=pc");
  assert.equal(result.exitCode, 0, result.stderr);
  // Matching from top with bottom-first order compares current/next odd rows.
  assert.deepEqual(result.output, source.input);
});

it("accepts positional parity and mode, repeated options, and generic scheduling options", async () => {
  const source = randomFixture();
  const expected = await run(source, "fieldmatch");
  assert.equal(expected.exitCode, 0, expected.stderr);
  for (const options of ["auto:pc_n", "order=bff:order=default", "threads=2:thread_type=slice:extra_hw_frames=0"]) {
    const result = await run(source, `fieldmatch=${options}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected.output);
  }
});

it("bounds matching scratch memory and observes cancellation", async () => {
  const data = new Uint8Array(32 * 32 * 4);
  const frame = { width: 32, height: 32, ptsSeconds: 0, durationSeconds: 0.1, keyframe: true, data,
    native: { format: 0, colorspace: 2, fullRange: 0, width: 32, height: 32, pixels: new Uint8Array(1536), rgba: data } };
  await assert.rejects(fieldmatch([frame], "", new MediaBudgetTracker({ maxMemoryBytes: 1 })), /maxMemoryBytes/);
  const controller = new AbortController();
  controller.abort(new Error("cancel fieldmatch"));
  await assert.rejects(fieldmatch([frame], "", new MediaBudgetTracker(), controller.signal), /cancel fieldmatch/);
});
