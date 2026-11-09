import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const positionedCue = "1\n00:00:01,000 --> 00:00:02,000 X1:10 X2:50 Y1:20 Y2:60\nalpha\n";
const savedCue = "1\n00:00:01,000 --> 00:00:02,000  X1:010 X2:050 Y1:020 Y2:060\nalpha";
for (const [name, body, expectedSrt, expectedVtt] of [
  ["single positioned cue", positionedCue, savedCue, "WEBVTT\n\n00:01.000 --> 00:02.000\nalpha"],
  ["position scoped to first cue", positionedCue + "\n2\n00:00:01,500 --> 00:00:03,000\nbeta\n",
    savedCue + "\n\n2\n00:00:01,500 --> 00:00:03,000\nbeta",
    "WEBVTT\n\n00:01.000 --> 00:02.000\nalpha\n\n00:01.500 --> 00:03.000\nbeta"]
]) {
  for (const extension of ["srt", "vtt"]) {
    it(`${extension} output handles SRT positioning: ${name}`, async () => {
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
