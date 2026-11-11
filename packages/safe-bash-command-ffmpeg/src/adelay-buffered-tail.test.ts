import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references: buffering leaves the initial delay PTS unset.
for (const complex of [false, true]) {
  for (const [filter, format, expected] of [
    ["asetnsamples=n=4:p=0,areverse,adelay=3S|5S:enable=0,aselect='lt(t,0)'", "s16le",
      "0000000000000000"],
    ["asetnsamples=n=4:p=0,areverse,adelay=3S|5S:enable=0", "framecrc", [
      "0,0,0,3,12,0x00000000", "0,0,0,3,12,0x247505fd", "0,3,3,4,16,0x404407fc",
      "0,7,7,4,16,0x3fb807fc", "0,11,11,2,8,0x00000000"
    ]],
    ["asetnsamples=n=4:p=0,asetnsamples=n=20:p=0,adelay=3S|5S:enable=0,atrim=start=0.002:end=0.005", "s16le",
      "000000002c01d4fe900170fef4010cfe"],
    ["asetnsamples=n=4:p=0,areverse,adelay=3S|5S,aselect='lt(t,0)'", "s16le", ""]
  ] as const) {
    it(`matches buffered delay tail timing: ${filter} (${complex ? "complex" : "simple"}, ${format})`, async () => {
      const input = Buffer.alloc(11 * 4);
      for (let i = 0; i < 11; i++) {
        input.writeInt16LE((i + 1) * 100, i * 4);
        input.writeInt16LE((i + 1) * -100, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", format, "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      assert.deepEqual(format === "s16le" ? output.toString("hex")
        : output.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()).join(",")), expected);
    });
  }
}
