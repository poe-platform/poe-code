import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = Float64Array.from([100, -200, 300, -400], value => value / 32768);
const input = encodeWav({ sampleRate: 8000, channels: [samples] }, { bitsPerSample: 16 });

// Native FFmpeg 7.0.2 preserves these names in FLAC and exported FFmetadata.
for (const [title, artist] of [["title", "artist"], ["TITLE", "ARTIST"], ["TiTlE", "ArTiSt"]]) {
  for (const sync of [false, true]) it(`preserves encoded FLAC ${title}/${artist} spelling (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({ "/input.wav": Buffer.from(input) });
    const args = ["-v", "error", "-i", "/input.wav", "-c:a", "flac",
      "-metadata", `${title}=Song`, "-metadata", `${artist}=Alice`, "-f", "flac", sync ? "/output.flac" : "pipe:1"];
    let output: Uint8Array;
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      output = volume.readFileSync("/output.flac") as Buffer;
    } else {
      const chunks: Uint8Array[] = [];
      let diagnostic = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, diagnostic);
      output = Buffer.concat(chunks);
    }
    const records = parseAudio(output).nodes.filter(node => node.type === "VORBIS_COMMENT")
      .flatMap(node => node.fields!.comments as string[]);
    assert.deepEqual(records.filter(record => !record.toLowerCase().startsWith("encoder=")),
      [`${title}=Song`, `${artist}=Alice`]);
    assert.deepEqual(flacAst().parse(output).tracks[0]!.decodedAudio!.channelData[0], samples);
  });
}
