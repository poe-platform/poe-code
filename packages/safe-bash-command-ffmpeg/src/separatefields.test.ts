import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter = "separatefields", format = "yuv444p", muxer = "rawvideo") {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", muxer, "/out"],
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

for (const color of [false, true]) {
  const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
  ]));
  for (const tag of ["p", "t", "b"]) {
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 I${tag} A1:1 C444\n`),
      ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
    const fields = frames.flatMap(frame => (tag === "t" ? [0, 1] : [1, 0]).map(parity =>
      Buffer.concat(Array.from({ length: 6 }, (_, row) => frame.subarray((row * 2 + parity) * 4, (row * 2 + parity + 1) * 4)))));
    it(`splits ${color ? "color" : "gray"} I${tag} into fields in display order`, async () => {
      const result = await run(input);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, Buffer.concat(fields));
      if (!color) assert.equal(createHash("sha256").update(result.output).digest("hex"), tag === "t"
        ? "33eeb8f651172f7b46b7ecb341ef84e4a6a4cb72b56fe5ac043bdc787dd84317"
        : "bdba906c8f553e73263285d0fac354d0e74071afe0d0e5131c3a2febb399ff94");
    });
    it(`doubles frame rate, halves height and clears I${tag} interlacing (${color})`, async () => {
      const result = await run(input, "separatefields", "yuv444p", "yuv4mpegpipe");
      assert.equal(result.exitCode, 0, result.stderr);
      const headerEnd = result.output.indexOf(10);
      assert.deepEqual(result.output.subarray(0, headerEnd).toString().split(" ").slice(0, 7),
        ["YUV4MPEG2", "W4", "H2", "F12:1", "Ip", "A1:1", "C444"]);
      assert.deepEqual(result.output.subarray(headerEnd + 1),
        Buffer.concat(fields.flatMap(frame => [Buffer.from("FRAME\n"), frame])));
    });
    it(`preserves the null control for I${tag} (${color})`, async () => {
      const result = await run(input, "null");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, Buffer.concat(frames));
      if (!color) assert.equal(createHash("sha256").update(result.output).digest("hex"),
        "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0");
    });
    it(`places the second I${tag} field halfway to the next frame (${color})`, async () => {
      const result = await run(input, "separatefields,select=eq(t\\,1/12)*eq(interlace_type\\,PROGRESSIVE)");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, fields[1]);
    });
    it(`uses the doubled time base in downstream setpts for I${tag} (${color})`, async () => {
      const result = await run(input, "separatefields,setpts=PTS,select=eq(t\\,1/12)");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, fields[1]);
    });
  }
}

for (const option of ["1", "unknown=1", "enable=1"]) {
  it(`rejects separatefields=${option} without replacing the destination`, async () => {
    const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 It A1:1 C444\nFRAME\n"), Buffer.alloc(48, 128)]);
    const result = await run(input, `separatefields=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("separatefields"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

for (const [chroma, format, hsub, vsub, depth] of [
  ["422", "yuv422p", 2, 1, 8],
  ["420jpeg", "yuv420p", 2, 2, 8],
  ["444p10", "yuv444p10le", 1, 1, 10],
  ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  it(`separates ${format} planes without changing samples or rendered colors`, async () => {
    const planes = Array.from({ length: 3 }, (_, p) => {
      const width = p === 0 ? 4 : 4 / hsub;
      const height = p === 0 ? 4 : 4 / vsub;
      const data = Buffer.alloc(width * height * (depth === 8 ? 1 : 2));
      for (let i = 0; i < width * height; i++) {
        const sample = (30 + p * 60 + i) * 2 ** (depth - 8) + (depth === 8 ? 0 : 3);
        if (depth === 8) data[i] = sample;
        else data.writeUInt16LE(sample, i * 2);
      }
      return data;
    });
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 It A1:1 C${chroma}\nFRAME\n`), ...planes]);
    const fields = [0, 1].map(parity => Buffer.concat(planes.map((plane, p) => {
      const height = p === 0 ? 4 : 4 / vsub;
      const stride = plane.length / height;
      return Buffer.concat(Array.from({ length: height / 2 }, (_, row) =>
        plane.subarray((row * 2 + parity) * stride, (row * 2 + parity + 1) * stride)));
    })));
    const result = await run(input, "separatefields", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(fields));
    const separated = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H2 F12:1 Ip A1:1 C${chroma}\n`),
      ...fields.flatMap(field => [Buffer.from("FRAME\n"), field])]);
    const rgb = await run(input, "separatefields,format=rgba", "rgba");
    const control = await run(separated, "scale=iw:ih,format=rgba", "rgba");
    assert.equal(rgb.exitCode, 0, rgb.stderr);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.deepEqual(rgb.output, control.output);
  });
}

it("separates modified RGB rows after native planes are invalidated", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 It A1:1 C444\nFRAME\n"),
    Buffer.from(Array.from({ length: 48 }, (_, i) => 32 + i * 3))]);
  const source = await run(input, "format=rgba,negate", "rgba");
  const result = await run(input, "format=rgba,negate,separatefields", "rgba");
  assert.equal(source.exitCode, 0, source.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([0, 2, 1, 3].map(row =>
    source.output.subarray(row * 16, (row + 1) * 16))));
});

it("rejects odd source heights without replacing the destination", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H3 F6:1 It A1:1 C444\nFRAME\n"), Buffer.alloc(36, 128)]);
  const result = await run(input);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("separatefields: height must be even"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});

it("doubles the time base established by an upstream fps filter", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 It A1:1 C444\n"),
    ...[32, 64].flatMap(value => [Buffer.from("FRAME\n"), Buffer.alloc(48, value)])]);
  const result = await run(input, "fps=12,separatefields", "yuv444p", "yuv4mpegpipe");
  assert.equal(result.exitCode, 0, result.stderr);
  const headerEnd = result.output.indexOf(10);
  assert.ok(result.output.subarray(0, headerEnd).toString().includes(" F24:1 "));
  assert.equal(result.output.subarray(headerEnd + 1).length, 8 * 30);
});
