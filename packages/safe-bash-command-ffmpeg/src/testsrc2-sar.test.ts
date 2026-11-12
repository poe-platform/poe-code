import assert from "node:assert/strict";
import { it } from "node:test";
import { createFfmpegCommand } from "./index.js";

for (const [option, ratio] of [[":sar=4/3", "4/3"], [":sar=1/1", "1/1"], ["", "1/1"]] as const) {
  for (const format of ["yuv4mpegpipe", "framecrc"]) {
    it(`preserves testsrc2 ${option || "default SAR"} in ${format}`, async () => {
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=64x48:r=2:d=1${option}`,
          "-pix_fmt", "yuv420p", "-f", format, "pipe:1"],
        cwd: "/", env: {}, fs: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      const output = Buffer.concat(stdout).toString();
      if (format === "yuv4mpegpipe") {
        const header = output.split("\n")[0]!;
        assert.ok(header.split(" ").includes(`A${ratio.replace("/", ":")}`), header);
      } else {
        assert.ok(output.split("\n").includes(`#sar 0: ${ratio}`), output);
      }
    });
  }
}
