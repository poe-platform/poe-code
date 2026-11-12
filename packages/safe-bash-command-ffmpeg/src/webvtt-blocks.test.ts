import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const block of ["STYLE", "REGION", "STYLE guide", "REGIONAL", "STYLES", "STYLE1", "NOTEBOOK"]) {
  it(`does not export WebVTT ${block} blocks as captions`, async () => {
    const good = "00:03.000 --> 00:04.000\nGood\n\nregion1\n00:05.000 --> 00:06.000\nCaption\n";
    const volume = Volume.fromJSON({
      "/in.vtt": `WEBVTT\n\n${block}\n00:01.000 --> 00:02.000\nHello\n\n${good}`
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.vtt", "-map", "0:s:0", "-c:s", "copy", "/out.vtt"],
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
    assert.equal(volume.readFileSync("/out.vtt", "utf8"), `WEBVTT\n\n${good}`);
  });
}
