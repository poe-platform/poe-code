import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("preserves literal WebVTT dialogue bytes on stream copy", async () => {
  const input = "WEBVTT\n\n00:01.000 --> 00:02.000\n  one  \n two  \n";
  const volume = Volume.fromJSON({ "/in.vtt": input });
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
  assert.equal(volume.readFileSync("/out.vtt", "utf8"), input);
});
