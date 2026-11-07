import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { mp3Ast } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const audio = readFileSync(new URL("./fixtures/copy-mono.mp3", import.meta.url));
const art = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGP8w4AdsOAQH6QSANBkARqrv8JBAAAAAElFTkSuQmCC", "base64");
const input = writeAudioMetadata(audio, { title: "Meeting", artist: "Alice" }, {
  pictures: [{ mime: "image/png", type: 3, description: "Cover", data: art }]
});

for (const [map, output] of [["0", "/out.mp3"], ["0:v:0", "/out.png"], ["0:a", "/audio.mp3"]]) {
  it(`copies MP3 cover art with map ${map}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp3", input);
    const args = ["-v", "error", "-i", "/in.mp3", "-map", map!, "-c", "copy", output!];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = volume.readFileSync(output!) as Buffer;
    if (output === "/out.png") assert.deepEqual(bytes, art);
    else {
      const pictures = parseAudio(bytes).pictures;
      assert.equal(pictures.length, map === "0" ? 1 : 0);
      if (map === "0") {
        assert.deepEqual(Buffer.from(pictures[0]!.data), art);
        assert.equal(pictures[0]!.description, "Cover");
        assert.equal(pictures[0]!.type, 3);
        assert.equal(mp3Ast().parse(bytes).tracks[1]!.disposition?.attached_pic, 1);
      }
      assert.deepEqual(mp3Ast().parse(new Uint8Array(bytes)).tracks[0]!.samples, mp3Ast().parse(input).tracks[0]!.samples);
    }
  });
}
