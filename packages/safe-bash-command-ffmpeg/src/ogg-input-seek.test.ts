import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { readOgg } from "@poe-code/audio-ast";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: mono 48 kHz Opus; the longer fixture uses -page_duration 250000.
// Input seeks retain the demuxer's page preroll; output seeks discard earlier packets.
for (const [fixture, before, after, first, count] of [
  ["tone-opus.ogg", [], [], 0, 38],
  ["tone-opus.ogg", ["-ss", "0.2"], [], 0, 38],
  ["tone-opus.ogg", [], ["-ss", "0.2"], 11, 27],
  ["opus-seek-pages.ogg", [], [], 0, 138],
  ["opus-seek-pages.ogg", ["-ss", "1.2"], [], 52, 86],
  ["opus-seek-pages.ogg", [], ["-ss", "1.2"], 61, 77],
  ["opus-seek-pages.ogg", ["-ss", "0.253"], [], 0, 138],
  ["opus-seek-pages.ogg", ["-ss", "0.254"], [], 13, 125],
  ["opus-seek-pages.ogg", ["-ss", "1.3"], [], 65, 73],
  ["opus-seek-pages.ogg", ["-ss", "2.75"], [], 117, 21],
  ["opus-seek-pages.ogg", ["-ss", "3"], [], 117, 21],
  ["opus-seek-pages.ogg", ["-ss", "0"], [], 0, 138],
  ["opus-seek-pages.ogg", ["-ss", "1.2", "-t", "0.2"], [], 52, 19],
  ["opus-seek-pages.ogg", ["-ss", "1.2", "-to", "1.4"], [], 52, 19],
  ["opus-seek-pages.ogg", ["-ss", "1.2"], ["-t", "0.2"], 52, 19],
  ["opus-seek-pages.ogg", ["-ss", "1.2"], ["-ss", "0.2"], 71, 67],
] as const) for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} Ogg copy: ${before.join(" ")} -i ${fixture} ${after.join(" ")}`, async () => {
    const input = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
    const source = readOgg(input).packets.slice(2);
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-y", ...before, "-i", "/in.ogg", ...after, "-c", "copy", "/out.mkv"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
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
    }
    const track = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer)).tracks[0]!;
    assert.equal(track.samples.length, count);
    assert.deepEqual(track.samples.map(sample => sample.data), source.slice(first, first + count).map(packet => packet.data));
    assert.equal(track.codecDelayNs, 6_500_000);
    assert.equal(track.samples.at(-1)!.discardPaddingNs, first + count === source.length ? 3_500_000 : undefined);
  });
}
