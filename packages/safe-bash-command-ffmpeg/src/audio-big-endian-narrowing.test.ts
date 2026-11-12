import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg PCM16 output, including unfiltered and explicit-format controls.
for (const [format, input] of [
  ["s24be", "ff9bff03e9ff03eaff03ebff"],
  ["s32be", "ff9bffff03e97bff03ea7bff03eb7bff"],
  ["s24le", "ff9bffffe903ffea03ffeb03"]
] as const) {
  for (const [filter, expected] of [
    ["", "9bffe903ea03eb03"],
    ["anull", "9bffe903ea03eb03"],
    ["afade=ns=3", "00004d019c02eb03"],
    ["aformat=sample_fmts=s32,afade=ns=3", "00004d019c02eb03"]
  ] as const) {
    for (const graph of filter ? [false, true] : [false]) {
      it(`narrows ${format} to PCM16 with ${filter || "no filter"} (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.raw", Buffer.from(input, "hex"));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(filter ? graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter] : []),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      });
    }
  }
}
