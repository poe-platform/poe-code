import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = (value: number) => Buffer.from([...Array<number>(4).fill(value), ...Array<number>(8).fill(128)]);
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].flatMap(value => [Buffer.from("FRAME\n"), frame(value)])]);

// Native FFmpeg 7.0.2 reference frames on the expanded output timeline.
for (const graph of [false, true]) {
  for (const [filter, range, expected] of [
    ["loop=4:2:3", ["-ss", "2"], [72, 92, 72, 92, 112, 132]],
    ["loop=4:2:3", ["-ss", "1"], [72, 92, 72, 92, 72, 92, 72, 92, 112, 132]],
    ["loop=4:2:3", ["-ss", "1", "-t", "0.75"], [72, 92, 72]],
    ["loop=4:2:3", ["-ss", "1", "-to", "1.75"], [72, 92, 72]],
    ["loop=4:2:3", ["-ss", "3.5"], []],
    ["loop=4:2:3", ["-ss", "2", "-frames:v", "2"], [72, 92]],
    ["loop=4:2:3", ["-t", "0.75"], [32, 52, 72]],
    ["loop=4:2:3,reverse", ["-ss", "1", "-t", "0.75"], [92, 72, 92]],
    ["loop=4:2:3,setpts=2*PTS", ["-ss", "2", "-t", "0.75"], [72, 92]],
    ["null", ["-ss", "1"], [112, 132]],
    ["null", ["-ss", "2"], []],
    ["null", ["-ss", "1", "-t", "0.75"], [112, 132]],
    ["", ["-ss", "1"], [112, 132]],
    ["", ["-ss", "2"], []],
    ["", ["-ss", "1", "-t", "0.75"], [112, 132]]
  ] as const) {
    if (!filter && graph) continue;
    it(`${graph ? "graph" : "simple"} ${filter || "-s 2x2"} seeks after filtering with ${range.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(!filter ? ["-s", "2x2"] : graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
          ...range, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(frame)));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
