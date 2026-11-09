import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function checksum(filter: string, format = "framecrc") {
  const volume = Volume.fromJSON({
    "/tone.mp3": readFileSync(new URL("./fixtures/filtered-tone.mp3", import.meta.url))
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.mp3", "-af", filter, "-f", format, "/out.txt"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out.txt", "utf8").toString().split("\n")
    .filter(line => !line.startsWith("#software:")).join("\n");
}

it("decodes MP3 before volume filtering and retains gapless PCM packet boundaries", async () => {
  // Native FFmpeg 7.0.2; omit the build-dependent #software line.
  assert.equal(await checksum("volume=0.5"), `#tb 0: 1/8000
#media_type 0: audio
#codec_id 0: pcm_s16le
#sample_rate 0: 8000
#channel_layout_name 0: mono
0,          0,          0,       47,       94, 0x1a5a4748
0,         47,         47,      576,     1152, 0x2fa44ca4
0,        623,        623,      576,     1152, 0x2be850a6
0,       1199,       1199,      576,     1152, 0x401d4bd3
0,       1775,       1775,      576,     1152, 0xb493fb41
0,       2351,       2351,      576,     1152, 0x462b0b2c
0,       2927,       2927,      273,      546, 0x347412ae
`);
});

for (const format of ["framemd5", "framehash"]) {
  it(`preserves trimmed MP3 packet timing through filtering for ${format}`, async () => {
    const rows = (await checksum("volume=0.5", format)).split("\n")
      .filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()).slice(0, 5));
    assert.deepEqual(rows, [
      ["0", "0", "0", "47", "94"],
      ["0", "47", "47", "576", "1152"],
      ["0", "623", "623", "576", "1152"],
      ["0", "1199", "1199", "576", "1152"],
      ["0", "1775", "1775", "576", "1152"],
      ["0", "2351", "2351", "576", "1152"],
      ["0", "2927", "2927", "273", "546"]
    ]);
  });
}
