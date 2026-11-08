import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const clean = readFileSync(new URL("./fixtures/metadata-16.flac", import.meta.url));
const frames = parseAudio(clean).nodes.find(node => node.type === "FRAMES")!.data;
const comments = writeAudioMetadata({ ...parseAudio(clean), tags: {} }, {
  TITLE: "Meeting", CHAPTER001: "00:00:00.125", CHAPTER001NAME: "Intro",
  CHAPTER002: "00:00:00.625", CHAPTER002NAME: "Q and A"
});
const sheet = new Uint8Array(396 + 48 * 2 + 36);
sheet[395] = 3;
for (const [offset, id, sample] of [[396, 1, 0], [444, 2, 4000], [492, 170, 8000]] as const) {
  new DataView(sheet.buffer).setBigUint64(offset, BigInt(sample));
  sheet[offset + 8] = id;
  if (id !== 170) { sheet[offset + 35] = 1; sheet[offset + 44] = 1; }
}
const header = Uint8Array.from(clean.subarray(0, 42));
header[4] = 0;
const cuesheet = writeAudioMetadata(Uint8Array.from([
  ...header, 133, 0, sheet.length >>> 8, sheet.length & 255, ...sheet, ...frames
]), { TITLE: "Meeting" });

for (const [kind, input] of [["comments", comments], ["cuesheet", cuesheet]] as const) {
  for (const explicit of [false, true]) for (const sync of [false, true]) {
    it(`removes physical FLAC ${kind} chapters (${explicit ? "disabled" : "default"}, ${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.flac": Buffer.from(input) });
      const args = ["-v", "error", "-y", "-i", "/in.flac", ...(sync ? [] : ["-map", "0"]), "-c", "copy",
        ...(explicit ? ["-map_chapters", "-1"] : []), "/out.flac"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      else {
        let diagnostic = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { diagnostic += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, diagnostic);
      }
      const output = parseAudio(volume.readFileSync("/out.flac") as Buffer);
      assert.equal(output.tags.title, "Meeting");
      assert.ok(!output.nodes.some(node => node.type === "CUESHEET"));
      const storedComments = output.nodes.filter(node => node.type === "VORBIS_COMMENT")
        .flatMap(node => node.fields?.comments as string[]);
      assert.ok(!storedComments.some(comment => comment.toUpperCase().startsWith("CHAPTER")), storedComments.join("\n"));
      assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data, frames);
    });
  }
}
