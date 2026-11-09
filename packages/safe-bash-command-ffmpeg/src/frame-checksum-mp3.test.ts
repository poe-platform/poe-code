import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framecrc", "framemd5", "framehash"]) {
  it(`${format} keeps the MP3 sample rate separate from its packet clock`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/tone.mp3", readFileSync(new URL("./fixtures/frame-checksum-tone.mp3", import.meta.url)));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/tone.mp3", "-c:a", "copy", "-f", format, "/out.txt"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.txt", "utf8") as string;
    assert.ok(output.includes("#tb 0: 1/14112000\n"));
    assert.ok(output.includes("#sample_rate 0: 8000\n"));
    if (format === "framecrc") {
      // Native FFmpeg 7.0.2 reference for headers, packet durations, sizes and CRCs.
      // Encoder-delay timestamps and skip-sample side data are outside this header regression.
      const expected = readFileSync(new URL("./fixtures/frame-checksum-tone.txt", import.meta.url), "utf8");
      assert.deepEqual(output.split("\n").filter(line => line.startsWith("#")),
        expected.split("\n").filter(line => line.startsWith("#") && !line.startsWith("#software:")));
      const packets = (text: string) => text.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").slice(3, 6).map(field => field.trim()));
      assert.deepEqual(packets(output), packets(expected));
    }
  });
}
