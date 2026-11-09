import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, body, expectedSrt, expectedVtt] of [
  ...["", "2\n", "\n2\n"].map(separator => [
    `separator ${JSON.stringify(separator)}`,
    `1\n00:00:01,000 --> 00:00:02,000\nalpha\n${separator}00:00:01,500 --> 00:00:03,000\nbeta\n`,
    "1\n00:00:01,000 --> 00:00:02,000\nalpha\n\n2\n00:00:01,500 --> 00:00:03,000\nbeta",
    "WEBVTT\n\n00:01.000 --> 00:02.000\nalpha\n\n00:01.500 --> 00:03.000\nbeta"
  ]),
  ["numeric dialogue", "1\n00:00:01,000 --> 00:00:02,000\nalpha\n2\nwords\n",
    "1\n00:00:01,000 --> 00:00:02,000\nalpha\n2\nwords",
    "WEBVTT\n\n00:01.000 --> 00:02.000\nalpha\n2\nwords"]
]) {
  for (const extension of ["srt", "vtt"]) {
    it(`${extension} output preserves SRT cues: ${name}`, async () => {
      const target = `/out.${extension}`;
      const volume = Volume.fromJSON({ "/in.srt": body!, [target]: "keep" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.srt", ...(extension === "srt" ? ["-c:s", "copy"] : []), target],
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
      assert.equal(volume.readFileSync(target, "utf8").toString().replaceAll("\r\n", "\n").trimEnd(),
        extension === "srt" ? expectedSrt : expectedVtt);
    });
  }
}
