import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-copy.ac3", import.meta.url));
const reference = readFileSync(new URL("./fixtures/ac3-copy-ref.txt", import.meta.url), "utf8")
  .split("\n").filter(line => !line.startsWith("#software:")).join("\n");

for (const [filename, explicit] of [["/a.ac3", false], ["/audio.bin", false], ["/audio.bin", true]] as const) {
  it(`copies native AC-3 frames to framemd5 (${filename}, explicit format: ${explicit})`, async () => {
    const volume = Volume.fromJSON({ [filename]: input });
    let stdout = "", stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...(explicit ? ["-f", "ac3"] : []), "-i", filename, "-c:a", "copy", "-f", "framemd5", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout.split("\n").filter(line => !line.startsWith("#software:")).join("\n"), reference);
  });
}
