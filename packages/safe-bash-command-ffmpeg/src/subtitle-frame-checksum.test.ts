import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg mov_text encoding of this SRT retains both gap packets and italic style bytes.
const srt = "1\n00:00:00,500 --> 00:00:01,250\nHello <i>World</i>\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n";
for (const filtered of [false, true]) {
  for (const extension of ["srt", "mp4"]) {
    for (const target of ["-", "/out.txt"]) {
      it(`writes copied ${extension} subtitle framecrc packets to ${target}, filtered=${filtered}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync(`/in.${extension}`, extension === "srt" ? srt :
          readFileSync(new URL("./fixtures/subtitle-framecrc.mp4", import.meta.url)));
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", `/in.${extension}`, "-map", "0:s", "-c:s", "copy", ...(filtered ? ["-bsf:s", extension === "srt" ? "null,text2movsub,null" : "null,mov2textsub,null"] : []), "-f", "framecrc", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        const output = target === "-" ? Buffer.concat(stdout).toString() : volume.readFileSync(target, "utf8") as string;
        for (const header of [`#tb 0: 1/${extension === "srt" ? 1000 : 1000000}`, "#media_type 0: subtitle",
          `#codec_id 0: ${extension === "srt" ? "subrip" : "mov_text"}`]) {
          assert.ok(output.split("\n").includes(header), output);
        }
        assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim())), filtered ? (extension === "srt" ? [
            ["0", "500", "500", "750", "20", "0x3c4e0623"],
            ["0", "2000", "2000", "1000", "13", "0x1920042f"]
          ] : [
            ["0", "0", "0", "500000", "0", "0x00000000"],
            ["0", "500000", "500000", "750000", "11", "0x1800041c"],
            ["0", "1250000", "1250000", "750000", "0", "0x00000000"],
            ["0", "2000000", "2000000", "1000000", "11", "0x189c0424"]
          ]) : extension === "srt" ? [
            ["0", "500", "500", "750", "18", "0x3af80611"],
            ["0", "2000", "2000", "1000", "11", "0x189c0424"]
          ] : [
            ["0", "0", "0", "500000", "2", "0x00000000"],
            ["0", "500000", "500000", "750000", "35", "0x9e390a2a"],
            ["0", "1250000", "1250000", "750000", "2", "0x00000000"],
            ["0", "2000000", "2000000", "1000000", "13", "0x1920042f"]
          ]);
      });
    }
  }
}
