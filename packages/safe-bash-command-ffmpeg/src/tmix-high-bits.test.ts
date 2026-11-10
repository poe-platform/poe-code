import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const oldest = [[12, 80, 200], [12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90]];
const luma = [[12, 80, 200], [66, 80, 200], [175, 160, 100], [150, 100, 50], [85, 40, 250], [70, 60, 90]];
const mixed = [[12, 80, 200], [66, 120, 150], [175, 130, 75], [150, 70, 150], [85, 50, 170], [70, 140, 60]];
const bytes = (samples: number[][]) => Buffer.from(samples.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value))));

// Native FFmpeg 7.0.2 outputs, including the low-bit controls.
for (const [planes, expected] of [
  ["0", oldest], ["1", luma], ["16", oldest], ["17", luma], ["0x11", luma],
  ["2147483648", oldest], ["2147483649", luma], ["4294967295", mixed], ["0xffffffff", mixed],
  ["4294967296", null], ["0x100000000", null]
] as const) {
  for (const graph of [false, true]) {
    it(`tmix numeric plane mask ${planes} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({
        "/in.y4m": Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
          ...frames.flatMap(frame => [Buffer.from("FRAME\n"), bytes([frame])])]),
        "/out.raw": "KEEP"
      });
      let stderr = "";
      const filter = `tmix=frames=2:planes=${planes}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("tmix:"), stderr);
        assert.equal(volume.readFileSync("/out.raw").toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), bytes(expected));
      }
    });
  }
}
