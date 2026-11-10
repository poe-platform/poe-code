import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.y4m") as Buffer };
}

for (const color of [false, true]) {
  const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
  ]));
  const payload = Buffer.concat(frames.flatMap(frame => [Buffer.from("FRAME\n"), frame]));
  for (const inputOrder of ["p", "t", "b"]) {
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 I${inputOrder} A1:1 C444\n`), payload]);
    for (const [filter, order] of [
      ["null", inputOrder], ["setfield", inputOrder], ["setfield=auto", inputOrder],
      ["setfield=-1", inputOrder], ["setfield=tff", "t"], ["setfield=mode=tff", "t"],
      ["setfield=1", "t"], ["setfield=bff", "b"], ["setfield=mode=bff", "b"],
      ["setfield=0", "b"], ["setfield=prog", "p"], ["setfield=2", "p"]
    ]) {
      it(`${filter} changes only field metadata for ${color ? "color" : "gray"} I${inputOrder}`, async () => {
        const result = await run(input, filter!);
        assert.equal(result.exitCode, 0, result.stderr);
        const end = result.output.indexOf(10);
        assert.deepEqual(result.output.subarray(0, end).toString().split(" ").slice(0, 7),
          ["YUV4MPEG2", "W4", "H4", "F6:1", `I${order}`, "A1:1", "C444"]);
        assert.deepEqual(result.output.subarray(end + 1), payload);
        if (!color) {
          const samples = Buffer.concat(frames.map((_, i) => result.output.subarray(end + 7 + i * 54, end + 55 + i * 54)));
          // Native FFmpeg 7.0.2 reference, excluding stream and frame headers.
          assert.equal(createHash("sha256").update(samples).digest("hex"),
            "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0");
        }
      });
    }
  }

  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"), payload]);
  for (const [mode, classification] of [["tff", "TOPFIRST"], ["bff", "BOTTOMFIRST"], ["prog", "PROGRESSIVE"]]) {
    it(`exposes ${mode} to downstream filters and preserves timestamps (${color})`, async () => {
      const result = await run(input, `setfield=tff,setfield=${mode},select=eq(t\\,1/3)*eq(interlace_type\\,${classification})`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output.subarray(result.output.indexOf(10) + 1), Buffer.concat([Buffer.from("FRAME\n"), frames[2]!]));
    });
  }
  for (const option of ["mode=invalid", "mode=3", "mode=-2", "unknown=tff", "tff:bff", "tff:enable=0"]) {
    it(`rejects setfield=${option} before replacing output (${color})`, async () => {
      const result = await run(input, `setfield=${option}`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("setfield"), result.stderr);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}
