import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { readOgg } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function rows(output: string): string[][] {
  return output.trim().split("\n").filter(line => !line.startsWith("#"))
    .map(line => line.split(",").slice(0, 6).map(field => field.trim()));
}

for (const codec of ["opus", "vorbis"]) {
  const input = readFileSync(new URL(`./fixtures/copy-${codec}.ogg`, import.meta.url));
  const reference = rows(readFileSync(new URL(`./fixtures/copy-${codec}.ogg-copy-ref.txt`, import.meta.url), "utf8"));
  const packets = readOgg(input).packets.slice(codec === "opus" ? 2 : 3);
  for (const format of ["framemd5", "framecrc"]) {
    it(`hashes copied ${codec} media packets with native ${format} sizes and timestamps`, async () => {
      const volume = Volume.fromJSON({ "/in.ogg": input });
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.ogg", "-c:a", "copy", "-f", format, "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      // Native FFmpeg 7.0.2 references; side-data annotations are separate from packet payloads.
      const expected = reference.map((row, index) => {
        if (format === "framemd5") return row;
        // Adler-32 with FFmpeg's zero initial value, calculated from demuxed bytes.
        let a = 0, b = 0;
        for (const byte of packets[index]!.data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
        return [...row.slice(0, 5), `0x${(b * 65536 + a).toString(16).padStart(8, "0")}`];
      });
      assert.equal(expected.length, 21);
      assert.deepEqual(rows(stdout), expected);
    });
  }
}
