import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [option, exitCode, diagnostic] of [
  ["enable=1", 176, "timeline is unsupported"],
  ["enable=0", 176, "timeline is unsupported"],
  ["threads=-1", 222, "invalid threads"],
  ["threads=invalid", 234, "invalid"],
  ["threads=2147483648", 222, "invalid threads"],
  ["thread_type=invalid", 234, "invalid"],
  ["extra_hw_frames=-2", 222, "invalid extra_hw_frames"],
  ["1", 234, "unexpected positional argument"],
  ["nosuchkey=1", 8, "unsupported option nosuchkey"],
  ["", 0, ""],
  ["threads=0", 0, ""],
  ["threads=default", 0, ""],
  ["thread_type=slice", 0, ""],
  ["extra_hw_frames=-1", 0, ""],
  ["threads=1", 0, ""]
] as const) {
  it(`volumedetect ${option || "without options"} returns native status ${exitCode}`, async () => {
    const input = Buffer.from("00400000002000100008000400020001", "hex");
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.raw", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1",
        "-i", "in.raw", "-af", `volumedetect${option ? `=${option}` : ""}`, "-f", "s16le", "out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.ok(stderr.includes(diagnostic), stderr);
    if (exitCode === 0) assert.deepEqual(fs.readFileSync("/out.raw"), input);
    else assert.equal(fs.existsSync("/out.raw"), false);
  });
}
