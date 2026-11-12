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

for (const settings of ["position:30%  ", "align:end\t", "position:30%", "line:2\talign:end"]) {
  it(`preserves copied WebVTT settings ${JSON.stringify(settings)} on stdout`, async () => {
    const expected = `WEBVTT\n\ncue-1\n00:01.250 --> 00:03.500 ${settings}\nHi\n`;
    const volume = Volume.fromJSON({ "/in.vtt": expected + "\n" });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.vtt", "-c:s", "copy", "-f", "webvtt", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, expected);
  });
}
