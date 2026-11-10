import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const payload = Buffer.concat([[50, 30, 212], [120, 180, 60], [80, 140, 190]].flatMap(planes =>
  [Buffer.from("FRAME\n"), ...planes.map(value => Buffer.alloc(8, value))]));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H2 F4:1 Ip A1:1 C444\n"), payload]);

for (const graph of [false, true]) {
  for (const [filter, sar] of [
    ["null", "1:1"], ["setdar=4/3", "2:3"], ["setdar=2", "1:1"],
    ["setdar=dar=4/3", "2:3"], ["setdar=ratio=4/3", "2:3"],
    ["setdar=r=4/3", "2:3"], ["setdar=dar", "1:1"],
    ["setdar=4/3,setdar=dar*2", "4:3"],
    ["setdar=4/3:max=1", "1:2"],
    ["setdar=-1", null], ["setdar=1/0", null],
    ["setdar=unknown=1", null], ["setdar=4/3:max=0", null]
  ] as const) {
    it(`${graph ? "graph" : "simple"} ${filter} changes only aspect metadata`, async () => {
      const volume = Volume.fromJSON({ "/wide.y4m": input, "/o.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/wide.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/o.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      if (sar) {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/o.raw") as Buffer;
        const newline = output.indexOf(10);
        const fields = output.subarray(0, newline).toString().split(" ");
        for (const field of ["W4", "H2", "F4:1", "Ip", `A${sar}`, "C444"]) assert.ok(fields.includes(field), fields.join(" "));
        assert.deepEqual(output.subarray(newline + 1), payload);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/wide.y4m"), input);
    });
  }
}
