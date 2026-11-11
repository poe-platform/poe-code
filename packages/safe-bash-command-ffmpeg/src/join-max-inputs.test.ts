import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [count, valid] of [
  ["max-2147483645", true],
  ["max-max+2", true],
  ["2147483647-2147483645", true],
  ["min+1", true],
  ["default", true],
  ["max", false],
  ["max+1", false],
  ["max-max", false],
  ["MAX-2147483645", false]
] as const) {
  it(`resolves join inputs=${count} without replacing output on failure`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserve" });
    volume.writeFileSync("/0.raw", Buffer.from("0100fdff4701", "hex"));
    volume.writeFileSync("/1.raw", Buffer.from("4701fdff0100", "hex"));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/0.raw",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/1.raw",
        "-filter_complex", `[0:a][1:a]join=inputs=${count}[o]`,
        "-map", "[o]", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (valid) {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("01004701fdfffdff47010100", "hex"));
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.raw").toString(), "preserve");
    }
  });
}
