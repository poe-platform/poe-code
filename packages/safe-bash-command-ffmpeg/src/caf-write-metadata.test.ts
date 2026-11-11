import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg WAV with title=Song, album=Record, comment=Note and four PCM samples.
const wav = Buffer.from("52494646ffffffff57415645666d74201000000001000100401f0000803e0000020010004c49535430000000494e464f49434d54050000004e6f74650000494e414d05000000536f6e67000049505244070000005265636f7264000064617461ffffffff640038ff2c0170fe", "hex");

for (const inherited of [false, true]) {
  it(`writes CAF album and comment (${inherited ? "inherited" : "explicit"})`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": wav });
    const args = ["-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16be",
      "-map_metadata", inherited ? "0" : "-1",
      ...(!inherited ? ["-metadata", "title=Song", "-metadata", "album=Record", "-metadata", "comment=Note"] : []),
      "-f", "caf", "pipe:1"];
    let output = Buffer.alloc(0);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output = Buffer.concat([output, bytes]); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const tags: Record<string, string> = {};
    let pcm: Buffer | undefined;
    for (let offset = 8; offset < output.length;) {
      const id = output.toString("ascii", offset, offset + 4);
      const start = offset + 12;
      const length = Number(output.readBigInt64BE(offset + 4));
      const end = length === -1 ? output.length : start + length;
      if (id === "info") {
        const strings = output.toString("utf8", start + 4, end).split("\0");
        for (let i = 0; i < output.readUInt32BE(start); i++) tags[strings[i * 2]!] = strings[i * 2 + 1]!;
      }
      if (id === "data") pcm = output.subarray(start + 4, end);
      offset = end;
    }
    delete tags.encoder;
    assert.deepEqual(tags, { title: "Song", album: "Record", comment: "Note" });
    assert.deepEqual(pcm, Buffer.from("0064ff38012cfe70", "hex"));
  });
}
