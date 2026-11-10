import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p", valid = true) {
  const volume = Volume.fromJSON({ "/in.y4m": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  if (valid) assert.equal(result.exitCode, 0, stderr);
  else {
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("fieldorder:"), stderr);
    assert.equal(volume.readFileSync("/out", "utf8"), "KEEP");
  }
  return volume.readFileSync("/out") as Buffer;
}

for (const color of [false, true]) for (const order of ["t", "b", "p"]) {
  for (const target of ["tff", "bff"]) {
    it(`fieldorder ${order} to ${target} preserves ${color ? "color" : "gray"} samples`, async () => {
      const frames = Array.from({ length: 6 }, (_, i) => Buffer.from(
        Array.from({ length: 3 }, (_, p) => Array.from({ length: 4 }, (_, y) =>
          Array<number>(4).fill(p === 0 ? 32 + 24 * i + 3 * y : color ? p === 1 ? 35 + 9 * i + y : 216 - 8 * i - y : 128)).flat()).flat()));
      const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 I${order} A1:1 C444\n`),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
      const identity = order === "p" || (order === "t") === (target === "tff");
      const rows = identity ? [0, 1, 2, 3] : target === "tff" ? [1, 2, 3, 2] : [1, 0, 1, 2];
      const expected = Buffer.concat(frames.flatMap(frame => [0, 1, 2].flatMap(p =>
        rows.map(row => frame.subarray(p * 16 + row * 4, p * 16 + row * 4 + 4)))));
      for (const filter of [`fieldorder=${target}`, `fieldorder=order=${target}`, `fieldorder=${target === "tff" ? 1 : 0}`]) {
        const output = await run(input, filter);
        assert.deepEqual(output, expected);
        if (!color && order !== "p") assert.equal(createHash("sha256").update(output).digest("hex"), identity
          ? "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0"
          : target === "tff" ? "6f0fa9a5c3c9335ddacc96bb73cb2486270a1c52f220cd80d79f687ee4594577"
            : "76c7dfff15c631328306890783b5095f7ffeb371e0c3f984b005eef86096a097");
      }
      const rgb = await run(input, "format=rgba,negate", "rgba");
      const expectedRgb = Buffer.concat(frames.flatMap((_, i) => rows.map(row =>
        rgb.subarray(i * 64 + row * 16, i * 64 + row * 16 + 16))));
      assert.deepEqual(await run(input, `format=rgba,negate,fieldorder=${target}`, "rgba"), expectedRgb);
      const classification = order === "p" ? "PROGRESSIVE" : target === "tff" ? "TOPFIRST" : "BOTTOMFIRST";
      assert.deepEqual(await run(input, `fieldorder=${target},select='eq(interlace_type,${classification})'`), expected);
      assert.deepEqual(await run(input, `fieldorder=${target},fieldorder=${target}`), expected);
      if (target === "tff") assert.deepEqual(await run(input, "fieldorder"), expected);
    });
  }
}

for (const filter of ["fieldorder=bad", "fieldorder=2", "fieldorder=-1", "fieldorder=order=tff:unknown=1", "fieldorder=tff:bff"]) {
  it(`rejects ${filter} without replacing the destination`, async () => {
    const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 It A1:1 C444\nFRAME\n"), Buffer.alloc(48, 128)]);
    await run(input, filter, "yuv444p", false);
  });
}
