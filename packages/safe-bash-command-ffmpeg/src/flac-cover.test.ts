import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const audio = readFileSync(new URL("./fixtures/metadata-16.flac", import.meta.url));
const art = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGP8w4AdsOAQH6QSANBkARqrv8JBAAAAAElFTkSuQmCC", "base64");
const input = writeAudioMetadata(audio, { title: "Meeting", artist: "Alice" }, {
  pictures: [{ mime: "image/png", type: 3, description: "Cover", data: art }]
});

for (const sync of [false, true]) for (const [map, output] of [["vn", "/audio.flac"], ["0", "/out.flac"], ["0:v:0", "/out.png"], ["0:a", "/audio.flac"]]) {
  if (sync && map !== "vn") continue; // Explicit maps use the async command.
  it(`copies FLAC cover art with map ${map} (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.flac", input);
    const args = ["-v", "error", "-i", "/in.flac", ...(map === "vn" ? ["-vn"] : ["-map", map!]), "-c", "copy", output!];
    let stderr = "";
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
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
    }
    const bytes = volume.readFileSync(output!) as Buffer;
    if (output === "/out.png") assert.deepEqual(bytes, art);
    else {
      const pictures = parseAudio(bytes).pictures;
      assert.equal(pictures.length, map === "0" ? 1 : 0);
      if (map === "0") {
        assert.deepEqual(Buffer.from(pictures[0]!.data), art);
        assert.equal(pictures[0]!.description, "Cover");
        assert.equal(pictures[0]!.type, 3);
        assert.equal(flacAst().parse(bytes).tracks[1]!.disposition?.attached_pic, 1);
      }
      assert.deepEqual(Buffer.from(parseAudio(bytes).nodes.find(node => node.type === "FRAMES")!.data),
        Buffer.from(parseAudio(input).nodes.find(node => node.type === "FRAMES")!.data));
      assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio,
        flacAst().parse(input).tracks[0]!.decodedAudio);
    }
  });
}
