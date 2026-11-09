import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const priming of [true, false]) {
  for (const format of ["framecrc", "framemd5", "framehash"]) {
    it(`${format} uses complete decoded AAC frames (priming=${priming})`, async () => {
      const fs = Volume.fromJSON({});
      const fixture = readFileSync(new URL("./fixtures/frame-checksum-tone.m4a", import.meta.url));
      const doc = parseMp4(fixture);
      fs.writeFileSync("/tone.m4a", priming ? fixture : Buffer.from(serializeMp4({ ...doc,
        tracks: doc.tracks.map(track => ({ ...track, editList: [] }))
      })));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/tone.m4a", "-c:a", "pcm_s16le", "-f", format, "/out.txt"],
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
      assert.ok(output.includes("#tb 0: 1/8000\n"));
      assert.ok(output.includes("#sample_rate 0: 8000\n"));
      const rows = output.split("\n").filter(line => line.startsWith("0,"));
      assert.equal(rows.length, priming ? 4 : 5);
      assert.deepEqual(rows.map(line => line.split(",").slice(1, 5).map(Number)),
        (priming ? [0, 1024, 2048, 3072] : [0, 1024, 2048, 3072, 4096]).map(pts => [pts, pts, 1024, 2048]));
      if (priming && format === "framecrc") {
        // Native FFmpeg 7.0.2 reference; only the software version is omitted.
        const expected = readFileSync(new URL("./fixtures/frame-checksum-aac.txt", import.meta.url), "utf8");
        assert.equal(output.split("\n").filter(line => !line.startsWith("#software:")).join("\n"), expected.split("\n").filter(line => !line.startsWith("#software:")).join("\n"));
      }
    });
  }
}
