import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [paragraph, following, exitCode, errors] of [
  ["<P>red</P><P>&nbsp;</P><P>green", "done", 0, 1],
  ["<P>&nbsp;word", "done", 0, 1],
  ["<P>&nbsp;", "&nbsp;", 69, 2],
  ["<P>plain", "done", 0, 0]
] as const) {
  it(`converts SAMI leading markers and reports decoder failures: ${paragraph}, ${following}`, async () => {
    const volume = Volume.fromJSON({ "/in.smi": `<SAMI>\n<BODY>\n<SYNC Start=1000>${paragraph}\n<SYNC Start=3000><P>${following}\n</BODY>\n</SAMI>\n` });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "sami", "-i", "in.smi", "-f", "srt", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode);
    assert.equal(stdout, errors === 2 ? "" : errors === 1
      ? "1\n00:00:03,000 --> 1193:02:50,295\ndone\n\n"
      : "1\n00:00:01,000 --> 00:00:03,000\nplain\n\n2\n00:00:03,000 --> 1193:02:50,295\ndone\n\n");
    assert.equal(stderr, "ffmpeg: Error decoding subtitles: Operation not permitted\n".repeat(errors)
      + (exitCode === 69 ? "ffmpeg: Decode error rate 1 exceeds maximum 0.6666666865348816\n" : ""));
  });
}

for (const marker of ["&nbsp;", "&nbsp;&nbsp;", "&nbsp;hidden"]) {
  it(`falls back to asynchronous decoding for SAMI ${marker} diagnostics`, () => {
    const volume = Volume.fromJSON({ "/in.smi": `<SAMI><BODY><SYNC Start=1000><P>first<SYNC Start=2000><P>${marker}<SYNC Start=3000><P>last</BODY></SAMI>` });
    assert.equal(evalSyncFfmpeg(["-f", "sami", "-i", "/in.smi", "/out.srt"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.existsSync("/out.srt"), false);
  });
}
