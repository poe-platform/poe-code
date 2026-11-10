import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const color of [false, true]) {
  const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
  ]));
  for (const [filter, selected, rate, hash] of [
    ["null", [0, 1, 2, 3, 4, 5], 6, "9fee2551026c4a095069b733852e41fd575169a053540e53e6cdf1cde85fcdf0"],
    ["tinterlace=drop_even", [0, 2, 4], 3, "16cc8c29435859f8163df8c2f48a8b98df540ab6e45da2302605e81b5ef9fcbc"],
    ["tinterlace=drop_odd", [1, 3, 5], 3, "a8abeed9f834997606db8f5e16f00a69a968847e187324090d56449e080b2421"],
    ["tinterlace=mode=drop_even", [0, 2, 4], 3],
    ["tinterlace=mode=drop_odd", [1, 3, 5], 3],
    ["tinterlace=1", [0, 2, 4], 3],
    ["tinterlace=2", [1, 3, 5], 3],
    ["trim=end_frame=5,tinterlace=drop_even", [0, 2], 3],
    ["trim=end_frame=5,tinterlace=drop_odd", [1, 3], 3],
    ["trim=end_frame=1,tinterlace=drop_even", [], 3],
    ["trim=end_frame=1,tinterlace=drop_odd", [], 3],
    ["trim=end_frame=0,tinterlace=drop_even", [], 3],
    ["trim=end_frame=0,tinterlace=drop_odd", [], 3],
    ["tinterlace=drop_even,select='eq(t,1/3)'", [2], 3],
    ["tinterlace=drop_odd,select='eq(t,1/2)'", [3], 3],
    ["tinterlace=drop_even,select='eq(interlace_type,PROGRESSIVE)'", [0, 2, 4], 3],
    ["tinterlace=drop_odd,select='eq(interlace_type,PROGRESSIVE)'", [1, 3, 5], 3],
    ["tinterlace=drop_even:unknown=1", null, 3],
    ["tinterlace=drop_odd:enable=1", null, 3]
  ] as const) {
    for (const graph of [false, true]) it(`${filter} preserves ${color ? "color" : "gray"} frames (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
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
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
      if (selected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("tinterlace:"), stderr);
        assert.equal(volume.readFileSync("/out.y4m", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.y4m") as Buffer;
      const headerEnd = output.indexOf(10) + 1;
      if (selected.length > 0) assert.equal(output.subarray(0, headerEnd).toString(),
        `YUV4MPEG2 W4 H4 F${rate}:1 Ip A1:1 C444\n`);
      assert.deepEqual(output.subarray(headerEnd), Buffer.concat(
        selected.flatMap(index => [Buffer.from("FRAME\n"), frames[index]!])));
      if (!color && hash) {
        const pixels = Buffer.concat(selected.map((_, index) =>
          output.subarray(headerEnd + index * 54 + 6, headerEnd + (index + 1) * 54)));
        assert.equal(createHash("sha256").update(pixels).digest("hex"), hash);
      }
    });
  }
}
