import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Expected bytes verified with native FFmpeg 7.0.2.
const source = [32, 52, 72, 92, 112, 132];
const pixels = (values: readonly number[]) => Buffer.concat(values.map(value =>
  Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)])));
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...source.map(value => Buffer.concat([Buffer.from("FRAME\n"), pixels([value])]))
]);

for (const graph of [false, true]) {
  for (const [filter, inputOptions, outputOptions, expected] of [
    ["loop=8:2:3", [], ["-t", "2"], [32, 52, 72, 92, 72, 92, 72, 92]],
    ["loop=4:2:3", [], ["-t", "1"], [32, 52, 72, 92]],
    ["loop=4:2:3", [], ["-to", "2"], [32, 52, 72, 92, 72, 92, 72, 92]],
    ["loop=8:2:3", [], ["-frames:v", "8"], [32, 52, 72, 92, 72, 92, 72, 92]],
    ["null", [], ["-t", "1"], [32, 52, 72, 92]],
    ["null", [], ["-to", "2"], source],
    ["loop=4:2:3", [], ["-t", "0"], []],
    ["loop=4:2:3", [], ["-t", "0.5"], [32, 52]],
    ["loop=4:2:3", [], ["-ss", "1", "-t", "1"], [72, 92, 72, 92]],
    ["loop=4:2:3", [], ["-ss", "1", "-to", "2"], [72, 92, 72, 92]],
    ["loop=4:2:3", [], ["-to", "2", "-t", "1"], [32, 52, 72, 92]],
    ["loop=4:2:3", ["-t", "1"], [], [32, 52, 72, 92, 72, 92, 72, 92, 72, 92, 72, 92]],
    ["loop=4:2:3", ["-t", "1"], ["-t", "2"], [32, 52, 72, 92, 72, 92, 72, 92]],
    ["loop=4:2:3,reverse", [], ["-t", "1"], [132, 112, 92, 72]],
    ["loop=4:2:3,setpts=2*PTS", [], ["-t", "2"], [32, 52, 72, 92]],
    ["", [], ["-ss", "0.5", "-t", "0.5", "-s", "2x2"], [72, 92]]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} input ${inputOptions.join(" ")} output ${outputOptions.join(" ")} cuts the filtered timeline`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...inputOptions, "-i", "/in.y4m",
          ...(filter ? graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter] : []),
          ...outputOptions, "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
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
      assert.deepEqual(volume.readFileSync("/o.raw"), pixels(expected));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
